import { describe, expect, it } from "vitest";
import { contentToText, messageToItem, projectHistory, toolResultOutput, toUsage } from "../src/translate.ts";

const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };

describe("pi message translation", () => {
	it("joins user text parts and counts image attachments without retaining image data", () => {
		expect(
			messageToItem(
				{
					role: "user",
					timestamp: 0,
					content: [{ type: "text", text: "First" }, image, { type: "text", text: "Second" }, image],
				},
				"u1",
			),
		).toEqual({ kind: "user", id: "u1", text: "First\nSecond", imageCount: 2, timestamp: 0 });
		expect(contentToText("Plain text")).toEqual({ text: "Plain text", imageCount: 0 });
	});

	it("preserves assistant block order, model metadata, and streaming state", () => {
		expect(
			messageToItem(
				{
					role: "assistant",
					timestamp: 42,
					content: [
						{ type: "thinking", thinking: "Private", redacted: true },
						{ type: "text", text: "Reading the file." },
						{ type: "toolCall", id: "t1", name: "read", arguments: { path: "note.txt" } },
					],
					provider: "example",
					model: "test-model",
					stopReason: "toolUse",
					usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 16, cost: { total: 0.012 } },
				},
				"a1",
				true,
			),
		).toEqual({
			kind: "assistant",
			id: "a1",
			timestamp: 42,
			blocks: [
				{ type: "thinking", text: "Private", redacted: true },
				{ type: "text", text: "Reading the file." },
				{ type: "toolCall", toolCallId: "t1", name: "read", args: { path: "note.txt" } },
			],
			provider: "example",
			model: "test-model",
			stopReason: "toolUse",
			usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 16, costTotal: 0.012 },
			streaming: true,
		});
	});

	it("defaults missing usage counters to zero and leaves absent usage undefined", () => {
		expect(toUsage({ input: 1 })).toEqual({
			input: 1,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			costTotal: 0,
		});
		expect(toUsage(undefined)).toBeUndefined();
	});

	it.each([
		[{ role: "bashExecution", command: "pwd", output: "/project" }, "bash", "$ pwd", "/project"],
		[{ role: "compactionSummary", summary: "Older context" }, "compaction", "Context compacted", "Older context"],
		[{ role: "branchSummary", summary: "Other branch" }, "branchSummary", "Branch summary", "Other branch"],
		[
			{ role: "custom", customType: "extension", content: [{ type: "text", text: "Ready" }] },
			"custom",
			"extension",
			"Ready",
		],
	])("maps %j to a transcript notice", (message, variant, title, text) => {
		expect(messageToItem({ ...message, timestamp: 42 }, "n1")).toEqual({
			kind: "notice",
			id: "n1",
			variant,
			title,
			text,
			timestamp: 42,
		});
	});

	it("extracts tool output separately and omits hidden and unknown messages", () => {
		const result = { role: "toolResult", timestamp: 42, content: [{ type: "text", text: "Output" }, image] };
		expect(toolResultOutput(result)).toEqual({ output: "Output", imageCount: 1 });
		expect(toolResultOutput(undefined)).toEqual({ output: "", imageCount: 0 });
		expect(messageToItem(result, "t1")).toBeUndefined();
		expect(
			messageToItem({ role: "custom", display: false, content: "Hidden", timestamp: 42 }, "hidden"),
		).toBeUndefined();
		expect(messageToItem({ role: "unknown", timestamp: 42 }, "unknown")).toBeUndefined();
	});
});

describe("projectHistory", () => {
	it("keeps pre-compaction messages, emits branch notices, and separates tool results", () => {
		const savedAt = "2025-01-01T00:00:00Z";
		const timestamp = Date.parse(savedAt);
		const history = projectHistory([
			{
				type: "message",
				id: "u1",
				parentId: null,
				timestamp: savedAt,
				message: { role: "user", content: "Read the file", timestamp },
			},
			{
				type: "message",
				id: "r1",
				parentId: "u1",
				timestamp: savedAt,
				message: {
					role: "toolResult",
					toolCallId: "t1",
					toolName: "edit",
					content: [{ type: "text", text: "Edited" }, image],
					details: { diff: "+1 updated" },
					isError: false,
					durationMs: 23,
					timestamp,
				},
			},
			{
				type: "compaction",
				id: "c1",
				parentId: "r1",
				timestamp: savedAt,
				summary: "Earlier work",
				firstKeptEntryId: "r1",
				tokensBefore: 200,
			},
			{
				type: "branch_summary",
				id: "b1",
				parentId: "c1",
				timestamp: savedAt,
				fromId: "r1",
				summary: "Previous branch",
			},
			{
				type: "custom_message",
				id: "n1",
				parentId: "b1",
				timestamp: savedAt,
				customType: "extension",
				display: true,
				content: "Visible",
			},
			{
				type: "custom_message",
				id: "n2",
				parentId: "n1",
				timestamp: savedAt,
				customType: "extension",
				display: false,
				content: "Hidden",
			},
		]);

		expect(history).toEqual({
			items: [
				{ kind: "user", id: "u1", text: "Read the file", imageCount: 0, timestamp },
				{
					kind: "notice",
					id: "c1",
					variant: "compaction",
					title: "Context compacted",
					text: "Earlier work",
					timestamp,
				},
				{
					kind: "notice",
					id: "b1",
					variant: "branchSummary",
					title: "Branch summary",
					text: "Previous branch",
					timestamp,
				},
				{ kind: "notice", id: "n1", variant: "custom", title: "extension", text: "Visible", timestamp },
			],
			nestedToolEvents: [],
			blockedTools: new Map(),
			toolResults: [
				{
					toolCallId: "t1",
					isError: false,
					output: "Edited",
					imageCount: 1,
					durationMs: 23,
					diffs: [{ path: "", diff: "+1 updated" }],
				},
			],
		});
	});

	it.each(["+1 hello", [{ path: "a", diff: "+1 hello" }]])(
		"projects recorded children including legacy/current diffs: %j",
		(storedDiff) => {
			const history = projectHistory(
				[
					{
						type: "message",
						id: "r",
						parentId: null,
						timestamp: "2025-01-01",
						message: {
							role: "toolResult",
							toolCallId: "p",
							toolName: "codemode",
							content: [],
							isError: false,
							timestamp: 0,
							details: { argonNestedDiffs: { "p/1": storedDiff } },
							nestedCalls: {
								complete: false,
								calls: [
									{ id: "p/1", name: "write", arguments: { path: "a" }, status: "ok", durationMs: 4 },
									{ id: "p/2", name: "read", argumentsBytes: 99999, status: "error", error: "missing" },
									{ id: "p/3", name: "read", status: "unfinished" },
								],
							},
						},
					},
				],
				() => "builtin",
			);
			expect(history.items).toEqual([]);
			expect(history.nestedToolEvents).toEqual([
				expect.objectContaining({
					type: "tool_started",
					toolCallId: "p/1",
					parentToolCallId: "p",
					args: { path: "a" },
					source: "builtin",
					display: expect.objectContaining({ kind: "file_change" }),
				}),
				expect.objectContaining({
					type: "tool_ended",
					toolCallId: "p/1",
					isError: false,
					output: "",
					durationMs: 4,
					diffs: [{ path: "a", diff: "+1 hello" }],
				}),
				expect.objectContaining({ type: "tool_started", toolCallId: "p/2", args: undefined }),
				expect.objectContaining({ type: "tool_ended", toolCallId: "p/2", isError: true, output: "missing" }),
				expect.objectContaining({ type: "tool_started", toolCallId: "p/3" }),
				expect.objectContaining({
					type: "tool_ended",
					toolCallId: "p/3",
					isError: true,
					output: "Unfinished: still running when the calling tool finished",
				}),
			]);
		},
	);

	it("collects denied calls from Argon's tool_blocked entries", () => {
		const history = projectHistory([
			{
				type: "custom",
				id: "x1",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				customType: "argon.tool_blocked",
				data: { toolCallId: "t1", reason: "Denied by user: no" },
			},
			{
				type: "custom",
				id: "x2",
				parentId: "x1",
				timestamp: new Date(0).toISOString(),
				customType: "other",
				data: { toolCallId: "t2" },
			},
		]);
		expect(history.blockedTools).toEqual(new Map([["t1", "Denied by user: no"]]));
	});

	it("preserves a persisted notice timestamp at the Unix epoch", () => {
		const { items } = projectHistory([
			{
				type: "custom_message",
				id: "epoch",
				parentId: null,
				timestamp: "1970-01-01T00:00:00.000Z",
				customType: "extension",
				display: true,
				content: "Persisted",
			},
		]);

		expect(items[0]?.timestamp).toBe(0);
	});
});

it.each([undefined, { kind: "ordinary" }, { kind: "pi-codex-remote-compaction" }])(
	"projects compaction details %j consistently for entries and messages",
	(details) => {
		const remote = details?.kind === "pi-codex-remote-compaction";
		const expected = {
			kind: "notice",
			id: "c",
			variant: "compaction",
			title: "Context compacted",
			timestamp: 0,
			...(remote ? { remoteCheckpoint: true } : { text: "summary" }),
		};
		expect(
			projectHistory([
				{
					type: "compaction",
					id: "c",
					parentId: null,
					timestamp: new Date(0).toISOString(),
					summary: "summary",
					firstKeptEntryId: "m",
					tokensBefore: 100,
					details,
				},
			]).items,
		).toEqual([expected]);
		expect(messageToItem({ role: "compactionSummary", summary: "summary", details, timestamp: 0 }, "c")).toEqual(
			expected,
		);
	},
);

it("hides remote checkpoint continuation messages in history and live translation", () => {
	const customType = "codex-compact:continue-v1";
	expect(
		projectHistory([
			{
				type: "custom_message",
				id: "hidden",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				customType,
				content: "continue",
				display: false,
			},
		]).items,
	).toEqual([]);
	expect(messageToItem({ role: "custom", customType, content: "continue", display: false }, "hidden")).toBeUndefined();
});
