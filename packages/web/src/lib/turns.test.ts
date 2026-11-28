import type { AssistantBlock, ToolCallState, TranscriptItem } from "@argon/shared";
import { describe, expect, it } from "vitest";
import { buildTurn, defaultOpen, flattenCalls, summarize, transcriptRows, turnChanges, turnTiming } from "./turns";

type Assistant = Extract<TranscriptItem, { kind: "assistant" }>;

const call = (id: string, kind: "file_read" | "shell" | "script" = "file_read"): AssistantBlock => ({
	type: "toolCall",
	toolCallId: id,
	name: kind,
	args: {},
	display:
		kind === "file_read"
			? { kind, title: "read", path: `${id}.ts` }
			: kind === "shell"
				? { kind, title: "bash", command: "ls" }
				: { kind, title: "code", language: "js", source: "" },
});
const text = (value: string): AssistantBlock => ({ type: "text", text: value });
const assistant = (id: string, blocks: AssistantBlock[], extra: Partial<Assistant> = {}): Assistant => ({
	kind: "assistant",
	id,
	blocks,
	streaming: false,
	timestamp: 1000,
	...extra,
});
const user: TranscriptItem = { kind: "user", id: "u", text: "hi", imageCount: 0, timestamp: 0 };

describe("buildTurn", () => {
	it("splits the trailing text into the answer and groups consecutive calls", () => {
		const turn = buildTurn(
			[assistant("a1", [text("Looking"), call("1"), call("2")]), assistant("a2", [call("3"), text("Done")])],
			undefined,
			false,
		);
		expect(turn.answer?.blocks).toEqual([text("Done")]);
		expect(turn.process.map((s) => s.type)).toEqual(["text", "tools"]);
		const tools = turn.process[1];
		expect(tools?.type === "tools" && tools.calls.map((c) => c.toolCallId)).toEqual(["1", "2", "3"]);
	});

	it("has no answer while the last item ends with a call, and stays open", () => {
		const turn = buildTurn([assistant("a1", [text("Checking"), call("1")])], undefined, true);
		expect(turn.answer).toBeUndefined();
		expect(defaultOpen(turn)).toBe(true);
	});

	it("a plain reply has no process rows", () => {
		const rows = transcriptRows([user, assistant("a1", [text("Hello")])], false, () => false);
		expect(rows.map((r) => r.kind)).toEqual(["item", "answer"]);
	});
});

describe("summaries", () => {
	it("counts a script's nested calls instead of the script", () => {
		const tools: Record<string, ToolCallState> = {
			s: { toolCallId: "s", name: "code", args: {}, status: "done" },
			"s/1": {
				toolCallId: "s/1",
				name: "read",
				args: {},
				status: "done",
				parentToolCallId: "s",
				display: { kind: "file_read", title: "read", path: "a" },
			},
			"s/2": {
				toolCallId: "s/2",
				name: "bash",
				args: {},
				status: "done",
				parentToolCallId: "s",
				display: { kind: "shell", title: "bash", command: "ls" },
			},
		};
		const script = call("s", "script");
		if (script.type !== "toolCall") throw new Error();
		expect(summarize(flattenCalls([script], tools))).toEqual([
			{ category: "read", title: undefined, count: 1 },
			{ category: "command", title: undefined, count: 1 },
		]);
	});

	it("collects finished diffs and timing", () => {
		const turn = buildTurn(
			[
				assistant("a1", [call("1")], { usage: usage(100), generationMs: 2000, completedAt: 4000 }),
				assistant("a2", [text("ok")], { usage: usage(50), generationMs: 1000, completedAt: 9000 }),
			],
			{ kind: "user", id: "u", text: "", imageCount: 0, timestamp: 1000 },
			false,
		);
		const tools: Record<string, ToolCallState> = {
			"1": { toolCallId: "1", name: "edit", args: {}, status: "done", diffs: [{ path: "a.ts", diff: "+1 x" }] },
		};
		expect(turnChanges(turn, tools)).toEqual([{ path: "a.ts", diff: "+1 x" }]);
		expect(turnTiming(turn)).toEqual({ startedAt: 1000, endedAt: 9000, tokensPerSecond: 50 });
	});
});

function usage(output: number) {
	return { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, costTotal: 0 };
}
