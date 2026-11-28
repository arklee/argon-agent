import { type AssistantBlock, createEmptySessionState, type SessionState, type TranscriptItem } from "@argon/shared";
import { describe, expect, it } from "vitest";
import { partialArgsSummary } from "@/tools/registry";
import { liveActivity, thoughtTitle, turnStartedAt } from "./activity";

const user: TranscriptItem = { kind: "user", id: "u", text: "hi", imageCount: 0, timestamp: 500 };
const assistant = (blocks: AssistantBlock[], streaming: boolean): TranscriptItem => ({
	kind: "assistant",
	id: "a",
	blocks,
	streaming,
	timestamp: 1000,
});
const call: AssistantBlock = { type: "toolCall", toolCallId: "c1", name: "bash", args: undefined, argsText: '{"comm' };

function running(items: TranscriptItem[], extra: Partial<SessionState> = {}): SessionState {
	return { ...createEmptySessionState({ sessionId: "s", cwd: "/" }), status: "running", items, ...extra };
}

describe("liveActivity", () => {
	it("is nothing while idle, and waiting while a prompt is being sent", () => {
		const idle = createEmptySessionState({ sessionId: "s", cwd: "/" });
		expect(liveActivity(idle)).toBeUndefined();
		expect(liveActivity(idle, true)).toEqual({ kind: "waiting" });
	});

	it("keeps waiting through an empty streaming reply (the model has not said anything yet)", () => {
		expect(liveActivity(running([user]))?.kind).toBe("waiting");
		expect(liveActivity(running([user, assistant([], true)]))?.kind).toBe("waiting");
		expect(liveActivity(running([user, assistant([], true)], { thinkingLevel: "high" }))).toEqual({ kind: "thinking" });
		expect(liveActivity(running([user, assistant([{ type: "text", text: " " }], true)]))?.kind).toBe("waiting");
	});

	it("passes an extension's working message through", () => {
		expect(liveActivity(running([user], { workingMessage: "Indexing" }))).toEqual({
			kind: "waiting",
			message: "Indexing",
		});
	});

	it("names thinking, responding and a call being written", () => {
		const thought = assistant([{ type: "thinking", text: "**Reading files**\n\nLooking around" }], true);
		expect(liveActivity(running([user, thought]))).toEqual({ kind: "thinking", title: "Reading files" });
		expect(liveActivity(running([user, assistant([{ type: "text", text: "Sure" }], true)]))?.kind).toBe("responding");
		expect(liveActivity(running([user, assistant([call], true)]))).toEqual({ kind: "preparing", call });
	});

	it("shows the running tool after the reply ended, and waits once tools are done", () => {
		const reply = assistant([call], false);
		const tool = (status: "pending" | "running" | "done") => ({
			c1: { toolCallId: "c1", name: "bash", args: {}, status },
		});
		expect(liveActivity(running([user, reply], { tools: tool("running") }))).toEqual({ kind: "tool", call });
		expect(liveActivity(running([user, reply], { tools: tool("pending") }))?.kind).toBe("tool");
		expect(liveActivity(running([user, reply], { tools: tool("done") }))?.kind).toBe("waiting");
	});

	it("leaves the turn to a retry banner or an interaction card", () => {
		expect(liveActivity(running([user], { retry: { attempt: 1, maxAttempts: 3, errorMessage: "x" } }))).toBeUndefined();
		expect(
			liveActivity(
				running([user], {
					pendingInteractions: [{ id: "i", kind: "tool_approval", toolCallId: "c1", toolName: "bash", args: {} }],
				} as Partial<SessionState>),
			),
		).toBeUndefined();
	});

	it("reports compaction, even while idle", () => {
		const state = { ...createEmptySessionState({ sessionId: "s", cwd: "/" }), compacting: true };
		expect(liveActivity(state)).toEqual({ kind: "compacting" });
	});
});

describe("thoughtTitle", () => {
	it("takes the latest heading line", () => {
		expect(thoughtTitle("**One**\ntext\n\n**Two**\nmore")).toBe("Two");
		expect(thoughtTitle("plain thought with **bold** inline")).toBeUndefined();
		expect(thoughtTitle("")).toBeUndefined();
	});
});

describe("turnStartedAt", () => {
	it("uses the latest user message", () => {
		expect(turnStartedAt(running([user, assistant([], true)]))).toBe(500);
		expect(turnStartedAt(running([]))).toBeUndefined();
	});
});

describe("partialArgsSummary", () => {
	it("reads the telling value out of incomplete JSON", () => {
		expect(partialArgsSummary('{"command":"sleep 2 && ls src","timeout":null')).toBe("sleep 2 && ls src");
		expect(partialArgsSummary('{"comm')).toBe("");
		expect(partialArgsSummary('{"path":"src/a.ts')).toBe("src/a.ts");
		expect(partialArgsSummary('{"command":"echo \\"hi\\" \\')).toBe('echo "hi"');
		expect(partialArgsSummary('{"command":"a\\nb"}')).toBe("a b");
	});
});
