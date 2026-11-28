/**
 * Turn layout for the transcript. A turn is the run of assistant items after a user message. Its last
 * text that no tool call follows is the answer; everything before it (thinking, commentary, tool
 * calls) is the process, which folds into one line once the answer starts. This is a pure view of
 * SessionState (no state of its own beyond the user's open/closed choices), so it never competes
 * with the shared reducer.
 */

import type { AssistantBlock, FileDiff, ToolCallState, ToolDisplay, TranscriptItem } from "@argon/shared";

export type AssistantItem = Extract<TranscriptItem, { kind: "assistant" }>;
export type UserItem = Extract<TranscriptItem, { kind: "user" }>;
export type ToolCallBlock = Extract<AssistantBlock, { type: "toolCall" }>;

/** One piece of a turn's process, rendered as one transcript row. */
export type ProcessSegment =
	| { type: "text"; key: string; text: string; streaming: boolean }
	| { type: "thinking"; key: string; text: string; streaming: boolean }
	/** Consecutive tool calls (no text between them). */
	| { type: "tools"; key: string; calls: ToolCallBlock[] };

export interface Turn {
	/** The first assistant item's id. */
	id: string;
	user?: UserItem;
	items: AssistantItem[];
	process: ProcessSegment[];
	/** The answer: text blocks of the last item after its last tool call. */
	answer: { item: AssistantItem; blocks: AssistantBlock[] } | undefined;
	/** Some item is still streaming, or the session is running and this is the last turn. */
	live: boolean;
}

export type TranscriptRow =
	| { kind: "item"; key: string; item: TranscriptItem }
	| { kind: "turnHeader"; key: string; turn: Turn; open: boolean }
	| { kind: "segment"; key: string; turn: Turn; segment: ProcessSegment }
	| { kind: "answer"; key: string; turn: Turn };

function isToolCall(block: AssistantBlock): block is ToolCallBlock {
	return block.type === "toolCall";
}

/** Text a block shows; empty text and redacted thinking show nothing. */
function visible(block: AssistantBlock): boolean {
	if (block.type === "toolCall") return true;
	if (block.type === "thinking" && block.redacted) return false;
	return block.text.trim() !== "";
}

export function buildTurn(items: AssistantItem[], user: UserItem | undefined, running: boolean): Turn {
	const last = items.at(-1);
	if (!last) throw new Error("A turn has at least one assistant item");
	const lastTool = last.blocks.findLastIndex(isToolCall);
	// The answer starts at the first text after the last tool call; thinking before it is process.
	const answerStart = last.blocks.findIndex((block, i) => i > lastTool && block.type === "text" && visible(block));
	const answerBlocks = answerStart === -1 ? [] : last.blocks.slice(answerStart).filter((b) => b.type === "text");
	const process: ProcessSegment[] = [];
	for (const item of items) {
		const end = item === last && answerStart !== -1 ? answerStart : item.blocks.length;
		for (let i = 0; i < end; i++) {
			const block = item.blocks[i];
			if (!block || !visible(block)) continue;
			const key = `${item.id}:${i}`;
			const streaming = item.streaming && i === item.blocks.length - 1;
			if (block.type === "toolCall") {
				const previous = process.at(-1);
				if (previous?.type === "tools") previous.calls.push(block);
				else process.push({ type: "tools", key, calls: [block] });
			} else process.push({ type: block.type, key, text: block.text, streaming });
		}
	}
	return {
		id: items[0]?.id ?? last.id,
		user,
		items,
		process,
		answer: answerBlocks.length ? { item: last, blocks: answerBlocks } : undefined,
		live: running || items.some((item) => item.streaming),
	};
}

/** Group the transcript into rows; `isOpen` says whether a turn's process is shown. */
export function transcriptRows(
	items: readonly TranscriptItem[],
	running: boolean,
	isOpen: (turn: Turn) => boolean,
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	let user: UserItem | undefined;
	let index = 0;
	while (index < items.length) {
		const item = items[index];
		if (!item) break;
		if (item.kind !== "assistant") {
			if (item.kind === "user") user = item;
			rows.push({ kind: "item", key: `item-${item.id}`, item });
			index++;
			continue;
		}
		const group: AssistantItem[] = [];
		while (items[index]?.kind === "assistant") group.push(items[index++] as AssistantItem);
		const turn = buildTurn(group, user, running && index === items.length);
		if (turn.process.length > 0) {
			const open = isOpen(turn);
			rows.push({ kind: "turnHeader", key: `head-${turn.id}`, turn, open });
			if (open)
				for (const segment of turn.process) rows.push({ kind: "segment", key: `seg-${segment.key}`, turn, segment });
		}
		rows.push({ kind: "answer", key: `answer-${turn.id}`, turn });
	}
	return rows;
}

/** The process is open unless an answer has started; failures without an answer stay open. */
export function defaultOpen(turn: Turn): boolean {
	return turn.answer === undefined;
}

// ---------------------------------------------------------------------------
// Tool summaries
// ---------------------------------------------------------------------------

export type ToolCategory = "read" | "search" | "command" | "edit" | "other";

export interface CategoryCount {
	category: ToolCategory;
	/** Tool title for "other". */
	title?: string;
	count: number;
}

export interface ToolLike {
	toolCallId: string;
	name: string;
	display?: ToolDisplay;
}

/** Calls to count for a summary: a script (codemode) counts as the calls it made. */
export function flattenCalls(calls: readonly ToolLike[], tools: Record<string, ToolCallState>): ToolLike[] {
	const out: ToolLike[] = [];
	const children = childrenByParent(tools);
	const visit = (call: ToolLike) => {
		const display = call.display ?? tools[call.toolCallId]?.display;
		const nested = children.get(call.toolCallId);
		if (display?.kind === "script" && nested?.length) for (const child of nested) visit(child);
		else out.push({ ...call, display });
	};
	for (const call of calls) visit(call);
	return out;
}

function childrenByParent(tools: Record<string, ToolCallState>): Map<string, ToolCallState[]> {
	const map = new Map<string, ToolCallState[]>();
	for (const tool of Object.values(tools)) {
		if (!tool.parentToolCallId) continue;
		const list = map.get(tool.parentToolCallId);
		if (list) list.push(tool);
		else map.set(tool.parentToolCallId, [tool]);
	}
	for (const list of map.values())
		list.sort((a, b) => a.toolCallId.localeCompare(b.toolCallId, "en", { numeric: true }));
	return map;
}

export function categoryOf(display: ToolDisplay | undefined): ToolCategory {
	switch (display?.kind) {
		case "file_read":
			return "read";
		case "search":
			return "search";
		case "shell":
			return "command";
		case "file_change":
			return "edit";
		default:
			return "other";
	}
}

/** Counts in first-seen order. Edits count files; other tools count calls; "other" splits by title. */
export function summarize(calls: readonly ToolLike[]): CategoryCount[] {
	const counts = new Map<string, CategoryCount>();
	for (const call of calls) {
		const category = categoryOf(call.display);
		const title = category === "other" ? call.display?.title || call.name : undefined;
		const key = title === undefined ? category : `other:${title}`;
		const amount = call.display?.kind === "file_change" ? Math.max(1, call.display.files.length) : 1;
		const existing = counts.get(key);
		if (existing) existing.count += amount;
		else counts.set(key, { category, title, count: amount });
	}
	return [...counts.values()];
}

/** All tool calls of a turn (top level), in order. */
export function turnCalls(turn: Turn): ToolCallBlock[] {
	return turn.items.flatMap((item) => item.blocks.filter(isToolCall));
}

/** Files the turn changed, with the latest diff per path (nested calls included). */
export function turnChanges(turn: Turn, tools: Record<string, ToolCallState>): FileDiff[] {
	const byPath = new Map<string, string[]>();
	const children = childrenByParent(tools);
	const visit = (toolCallId: string) => {
		const tool = tools[toolCallId];
		if (tool?.status === "done")
			for (const diff of tool.diffs ?? []) {
				const list = byPath.get(diff.path);
				if (list) list.push(diff.diff);
				else byPath.set(diff.path, [diff.diff]);
			}
		for (const child of children.get(toolCallId) ?? []) visit(child.toolCallId);
	};
	for (const call of turnCalls(turn)) visit(call.toolCallId);
	return [...byPath].map(([path, diffs]) => ({ path, diff: diffs.join("\n") }));
}

export interface TurnTiming {
	/** Start of the turn: the user message, else the first request. */
	startedAt: number;
	/** End of the last message, when known. */
	endedAt?: number;
	/** Output tokens per second over the messages that report both. */
	tokensPerSecond?: number;
}

export function turnTiming(turn: Turn): TurnTiming {
	const startedAt = turn.user?.timestamp ?? turn.items[0]?.timestamp ?? Date.now();
	const last = turn.items.at(-1);
	let tokens = 0;
	let ms = 0;
	for (const item of turn.items) {
		if (item.generationMs && item.generationMs > 0 && item.usage) {
			tokens += item.usage.output;
			ms += item.generationMs;
		}
	}
	return {
		startedAt,
		endedAt: turn.live ? undefined : last?.completedAt,
		tokensPerSecond: ms > 0 && tokens > 0 ? (tokens / ms) * 1000 : undefined,
	};
}
