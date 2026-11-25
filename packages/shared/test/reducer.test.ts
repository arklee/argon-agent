import { describe, expect, it } from "vitest";
import type { SessionEvent, SessionState } from "../src/protocol.ts";
import { applySessionEvent, createEmptySessionState } from "../src/reducer.ts";

function run(events: SessionEvent[], state?: SessionState): SessionState {
	return events.reduce(applySessionEvent, state ?? createEmptySessionState({ sessionId: "s1", cwd: "/p" }));
}

describe("applySessionEvent", () => {
	it("streams text and tool call deltas into an assistant item", () => {
		const state = run([
			{ type: "run_started" },
			{
				type: "item_added",
				item: { kind: "assistant", id: "a1", blocks: [], streaming: true, timestamp: 0 },
			},
			{ type: "assistant_delta", itemId: "a1", contentIndex: 0, blockType: "text", delta: "Hel" },
			{ type: "assistant_delta", itemId: "a1", contentIndex: 0, blockType: "text", delta: "lo" },
			{
				type: "assistant_delta",
				itemId: "a1",
				contentIndex: 1,
				blockType: "toolCall",
				delta: "",
				toolCall: { toolCallId: "t1", name: "bash" },
			},
			{ type: "assistant_delta", itemId: "a1", contentIndex: 1, blockType: "toolCall", delta: '{"command":' },
		]);
		const item = state.items[0];
		expect(item?.kind).toBe("assistant");
		if (item?.kind !== "assistant") return;
		expect(item.blocks[0]).toEqual({ type: "text", text: "Hello" });
		expect(item.blocks[1]).toMatchObject({ type: "toolCall", toolCallId: "t1", name: "bash", argsText: '{"command":' });
		expect(state.status).toBe("running");
	});

	it("tracks tool lifecycle and keeps blocked status after the error result", () => {
		const state = run([
			{ type: "tool_started", toolCallId: "t1", name: "bash", args: { command: "rm -rf /" } },
			{ type: "tool_blocked", toolCallId: "t1", reason: "Denied by user" },
			{ type: "tool_ended", toolCallId: "t1", isError: true, output: "blocked", imageCount: 0 },
		]);
		expect(state.tools.t1?.status).toBe("blocked");
		expect(state.tools.t1?.name).toBe("bash");
	});

	it("adds and resolves interactions idempotently", () => {
		const interaction = {
			kind: "confirm" as const,
			id: "i1",
			createdAt: 0,
			title: "Sure?",
			message: "",
		};
		let state = run([
			{ type: "interaction_requested", interaction },
			{ type: "interaction_requested", interaction },
		]);
		expect(state.pendingInteractions).toHaveLength(1);
		state = run([{ type: "interaction_resolved", interactionId: "i1" }], state);
		expect(state.pendingInteractions).toHaveLength(0);
	});

	it("run_settled stops streaming items and returns to idle", () => {
		const state = run([
			{ type: "run_started" },
			{ type: "item_added", item: { kind: "assistant", id: "a1", blocks: [], streaming: true, timestamp: 0 } },
			{ type: "tool_started", toolCallId: "t1", name: "bash", args: {} },
			{ type: "run_settled", aborted: true },
		]);
		expect(state.status).toBe("idle");
		expect(state.items[0]).toMatchObject({ streaming: false });
		expect(state.tools.t1?.status).toBe("error");
	});

	it("does not mutate the previous state", () => {
		const before = run([
			{ type: "item_added", item: { kind: "user", id: "u1", text: "hi", imageCount: 0, timestamp: 0 } },
		]);
		const snapshot = JSON.stringify(before);
		run(
			[{ type: "item_replaced", item: { kind: "user", id: "u1", text: "edited", imageCount: 0, timestamp: 0 } }],
			before,
		);
		expect(JSON.stringify(before)).toBe(snapshot);
	});
});
