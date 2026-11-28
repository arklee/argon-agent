/**
 * What the agent is doing right now, for the one live status line under a running turn. A pure view of
 * SessionState: the line only changes its words while the turn runs, it never comes and goes between
 * model calls (an empty streaming reply, a tool that just ended, a thought that arrived in one burst).
 */

import type { AssistantBlock, SessionState } from "@argon/shared";

type ToolCallBlock = Extract<AssistantBlock, { type: "toolCall" }>;

export type Activity =
	/** Waiting for the model (or between steps); `message` is an extension's working message. */
	| { kind: "waiting"; message?: string }
	/** `title` is the thought's latest heading, when the model writes summaries with headings. */
	| { kind: "thinking"; title?: string }
	| { kind: "responding" }
	/** The model is still writing a tool call's arguments. */
	| { kind: "preparing"; call: ToolCallBlock }
	| { kind: "tool"; call: ToolCallBlock }
	| { kind: "compacting" };

/**
 * The live activity, or undefined when nothing runs or something else already speaks for the turn:
 * a retry banner, or a pending interaction (its card asks the user).
 */
export function liveActivity(state: SessionState, sending = false): Activity | undefined {
	if (state.retry || state.pendingInteractions.length > 0) return undefined;
	if (state.compacting) return { kind: "compacting" };
	if (state.status !== "running") return sending ? { kind: "waiting" } : undefined;
	const waiting: Activity = { kind: "waiting", message: state.workingMessage };
	const last = state.items.at(-1);
	if (last?.kind !== "assistant") return waiting;
	if (last.streaming) {
		const block = last.blocks.at(-1);
		// The reply has begun but says nothing yet: with reasoning on, the model is thinking (many
		// providers only send a summary of the thought at its end, or nothing at all).
		if (!block) return state.thinkingLevel !== "off" ? { kind: "thinking" } : waiting;
		if (block.type === "thinking") return { kind: "thinking", title: thoughtTitle(block.text) };
		if (block.type === "text") return block.text.trim() ? { kind: "responding" } : waiting;
		return { kind: "preparing", call: block };
	}
	// The reply ended: its tool calls run now (the latest running one is the most telling).
	const calls = last.blocks.filter((block): block is ToolCallBlock => block.type === "toolCall");
	const status = (call: ToolCallBlock) => state.tools[call.toolCallId]?.status;
	const active =
		calls.findLast((call) => status(call) === "running") ?? calls.find((call) => status(call) === "pending");
	return active ? { kind: "tool", call: active } : waiting;
}

/** The last `**Heading**` line of a thought (reasoning summaries are written as headed sections). */
export function thoughtTitle(text: string): string | undefined {
	const matches = [...text.matchAll(/^\s*\*\*(.+?)\*\*\s*$/gm)];
	const title = matches.at(-1)?.[1]?.trim();
	return title || undefined;
}

/** When the running turn started: its user message's time, if it has one. */
export function turnStartedAt(state: SessionState): number | undefined {
	return state.items.findLast((item) => item.kind === "user")?.timestamp;
}
