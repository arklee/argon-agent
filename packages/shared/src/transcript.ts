/**
 * Argon's own transcript model. The backend translates pi messages and events into these
 * types; frontends never see pi types directly, so a pi upgrade only touches the backend adapter.
 */

/** pi display diff for one file (lines start with "+", "-" or " ", then a line number). */
export interface FileDiff {
	/** Path as named by the tool, matching display.files[].path; source path for a move. */
	path: string;
	diff: string;
}

export interface UsageInfo {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
}

/**
 * How a tool call should be shown (decisions D13). The backend describes each call by meaning, not by
 * tool name, so a new tool that fits an existing kind needs no frontend change. Frontends render by
 * `kind`, may override per tool (source + name), and must treat an unknown `kind` like "generic",
 * using `title` / `summary` and the raw args and output.
 */
export type ToolDisplay = ToolDisplayBase &
	(
		| { kind: "shell"; command: string; cwd?: string }
		| { kind: "file_read"; path: string; offset?: number; limit?: number }
		/** One entry per file, so multi-file patches fit. Diffs live in `ToolCallState.diffs`, matched by `files[].path`. */
		| { kind: "file_change"; files: { path: string; op?: "add" | "update" | "delete" | "move"; movePath?: string }[] }
		/** content: grep-like; files: find-like; list: ls-like. */
		| { kind: "search"; mode: "content" | "files" | "list"; pattern?: string; path?: string }
		/** Code that calls other tools (codemode). Its nested calls are shown under it. */
		| { kind: "script"; language: string; source: string }
		| { kind: "generic" }
	);

export interface ToolDisplayBase {
	/** Short label for the card header, usually the tool name. */
	title: string;
	/** One line describing this call, e.g. the command or the path. */
	summary?: string;
}

export type ToolDisplayKind = ToolDisplay["kind"];

export type AssistantBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string; redacted?: boolean }
	| {
			type: "toolCall";
			toolCallId: string;
			name: string;
			args: unknown;
			argsText?: string;
			/** Set once the call is complete (not while its arguments stream). */
			display?: ToolDisplay;
			/** Where the tool comes from (pi's ToolInfo.sourceInfo.source); absent when the tool is gone. */
			source?: string;
	  };

export type ToolStatus = "pending" | "running" | "done" | "error" | "blocked";

export interface ToolCallState {
	toolCallId: string;
	name: string;
	args: unknown;
	status: ToolStatus;
	/** Text output; while running this holds the latest partial output. */
	output?: string;
	/** Number of images in the result (images are not sent inline yet). */
	imageCount?: number;
	durationMs?: number;
	/**
	 * Per-file previews and results in pi's display diff format (lines start with "+", "-" or " ", then a line number).
	 * A preview before the tool runs, replaced by the actual change when it has finished.
	 */
	diffs?: FileDiff[];
	/**
	 * Set for calls another tool made (e.g. a codemode script); ids look like `<parent id>/<n>`. Such
	 * calls have no transcript block, so they carry their own display and source.
	 */
	parentToolCallId?: string;
	display?: ToolDisplay;
	source?: string;
}

export type TranscriptItem =
	| {
			kind: "user";
			id: string;
			text: string;
			imageCount: number;
			timestamp: number;
	  }
	| {
			kind: "assistant";
			id: string;
			blocks: AssistantBlock[];
			provider?: string;
			model?: string;
			stopReason?: string;
			errorMessage?: string;
			usage?: UsageInfo;
			streaming: boolean;
			timestamp: number;
	  }
	| {
			/** Non-chat entries such as compaction summaries, user bash runs, extension messages. */
			kind: "notice";
			id: string;
			variant: "compaction" | "branchSummary" | "bash" | "custom" | "error" | "info";
			title: string;
			text?: string;
			timestamp: number;
	  };

export type TranscriptItemKind = TranscriptItem["kind"];
