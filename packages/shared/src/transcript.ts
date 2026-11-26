/**
 * Argon's own transcript model. The backend translates pi messages and events into these
 * types; frontends never see pi types directly, so a pi upgrade only touches the backend adapter.
 */

export interface UsageInfo {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
}

export type AssistantBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string; redacted?: boolean }
	| { type: "toolCall"; toolCallId: string; name: string; args: unknown; argsText?: string };

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
	 * For file-changing tools: pi's display diff (lines start with "+", "-" or " ", then a line number).
	 * A preview before the tool runs, replaced by the actual change when it has finished.
	 */
	diff?: string;
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
