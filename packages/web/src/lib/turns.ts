/**
 * Turn layout for the transcript. A turn is the run of assistant items after a user message. Its last
 * text that no tool call follows is the answer; everything before it (thinking, commentary, tool
 * calls) is the process, which folds into one line by the user's preference (see `defaultOpen`). This is a pure view of
 * SessionState (no state of its own beyond the user's open/closed choices), so it never competes
 * with the shared reducer.
 */

import type { AssistantBlock, FileDiff, ToolCallState, ToolDisplay, TranscriptItem } from "@argon/shared";
import type { ProcessFold } from "@/lib/process-fold";

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
	/**
	 * The fold line over a group of process segments: the whole process, or with `splitAtText` the
	 * thinking and tool calls between two texts. `first` is the turn's first group.
	 */
	| {
			kind: "turnHeader";
			key: string;
			turn: Turn;
			groupId: string;
			group: ProcessSegment[];
			first: boolean;
			live: boolean;
			open: boolean;
	  }
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

export interface ProcessGroup {
	/** The turn id for the whole process; else the first segment's key. */
	id: string;
	segments: ProcessSegment[];
	/** The turn's last group while it runs. */
	live: boolean;
}

/** Decides whether a group is shown; `last` is the turn's last group. */
export type IsOpen = (turn: Turn, group: ProcessGroup, last: boolean) => boolean;

/**
 * Group the transcript into rows. With `splitAtText`, texts in the process stay visible and split it
 * into several folds (thinking and tool calls between texts); otherwise the whole process is one fold.
 */
export function transcriptRows(
	items: readonly TranscriptItem[],
	running: boolean,
	isOpen: IsOpen,
	splitAtText = false,
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
		if (splitAtText) pushSplit(rows, turn, isOpen);
		else if (turn.process.length > 0)
			pushGroup(rows, turn, { id: turn.id, segments: turn.process, live: turn.live }, true, true, isOpen);
		rows.push({ kind: "answer", key: `answer-${turn.id}`, turn });
	}
	return rows;
}

function pushGroup(
	rows: TranscriptRow[],
	turn: Turn,
	group: ProcessGroup,
	first: boolean,
	last: boolean,
	isOpen: IsOpen,
): void {
	const open = isOpen(turn, group, last);
	rows.push({
		kind: "turnHeader",
		key: `head-${group.id}`,
		turn,
		groupId: group.id,
		group: group.segments,
		first,
		live: group.live,
		open,
	});
	if (open)
		for (const segment of group.segments) rows.push({ kind: "segment", key: `seg-${segment.key}`, turn, segment });
}

function pushSplit(rows: TranscriptRow[], turn: Turn, isOpen: IsOpen): void {
	// Runs of thinking / tools, with the texts between them.
	const parts: (ProcessSegment[] | ProcessSegment)[] = [];
	for (const segment of turn.process) {
		const previous = parts.at(-1);
		if (segment.type === "text") parts.push(segment);
		else if (Array.isArray(previous)) previous.push(segment);
		else parts.push([segment]);
	}
	const lastGroup = parts.findLastIndex(Array.isArray);
	let first = true;
	parts.forEach((part, i) => {
		if (!Array.isArray(part)) {
			rows.push({ kind: "segment", key: `seg-${part.key}`, turn, segment: part });
			return;
		}
		const last = i === lastGroup;
		// Still running: the last group, unless the answer (or a text) has started after it.
		const live = turn.live && i === parts.length - 1 && !turn.answer;
		const only = part[0];
		// A lone finished thought needs no fold of its own: its block already folds.
		if (part.length === 1 && only?.type === "thinking" && !live) {
			rows.push({ kind: "segment", key: `seg-${only.key}`, turn, segment: only });
			return;
		}
		pushGroup(rows, turn, { id: only?.key ?? turn.id, segments: part, live }, first, last, isOpen);
		first = false;
	});
}

/**
 * Whether a turn's process is shown before the user toggles it. While a turn runs, text after the last
 * tool call may still be commentary (the next call is not known yet), so "auto" keeps the process open
 * until the turn ends. A finished turn without an answer (a failure, a stop) stays open in every mode.
 */
export function defaultOpen(turn: Turn, fold: ProcessFold = "auto"): boolean {
	if (fold === "expanded") return true;
	if (!turn.live) return turn.answer === undefined;
	return fold === "auto";
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
