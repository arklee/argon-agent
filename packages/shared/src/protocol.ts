/**
 * Argon wire protocol (client <-> backend).
 *
 * Rules (see CLAUDE.md):
 * - Everything here must be JSON-serializable. No functions, class instances, Dates, Buffers.
 * - The backend is always treated as remote, even when it runs on localhost.
 * - Paths are opaque strings that belong to the backend's environment; clients never do IO with them.
 */

import type { ToolCallState, TranscriptItem, UsageInfo } from "./transcript.ts";

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface EnvironmentInfo {
	/** Stable id of the backend environment (persisted on the backend machine). */
	id: string;
	name: string;
	hostname: string;
	platform: string;
	homeDir: string;
	argonVersion: string;
	piVersion: string;
}

export interface ModelRef {
	provider: string;
	id: string;
}

export interface ModelInfo extends ModelRef {
	name: string;
	reasoning: boolean;
	contextWindow?: number;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | (string & {});

export type PermissionMode = "ask" | "auto";

export interface SessionSummary {
	sessionId: string;
	/** Backend-side path of the session file. Opaque to clients. */
	sessionPath: string;
	cwd: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	createdAt: number;
	modifiedAt: number;
	/** True when the session is currently loaded in the backend. */
	loaded: boolean;
	running: boolean;
}

export type SessionStatus = "idle" | "running";

export type InteractionKind = "select" | "confirm" | "input" | "editor" | "tool_approval" | "oauth";

export interface InteractionBase {
	id: string;
	createdAt: number;
	/** Absolute deadline (ms epoch) after which the backend resolves it with a default. */
	expiresAt?: number;
}

export type Interaction =
	| (InteractionBase & { kind: "select"; title: string; options: string[] })
	| (InteractionBase & { kind: "confirm"; title: string; message: string })
	| (InteractionBase & { kind: "input"; title: string; placeholder?: string })
	| (InteractionBase & { kind: "editor"; title: string; prefill?: string })
	/**
	 * Sign in through a browser. The client opens `url`; the backend usually sees the redirect itself
	 * (and resolves the interaction), otherwise the user pastes the redirect URL back as `value`.
	 */
	| (InteractionBase & { kind: "oauth"; title: string; url: string })
	| (InteractionBase & {
			kind: "tool_approval";
			toolCallId: string;
			toolName: string;
			args: unknown;
			/** Preview of the file change, for edit/write (see ToolCallState.diff). */
			diff?: string;
	  });

export type InteractionResponse =
	| { cancelled: true }
	| { value: string }
	| { confirmed: boolean }
	| { decision: "allow" | "allow_session" | "deny"; reason?: string };

// --- MCP (per session: each session loads its own MCP servers, including the project's mcp.json) ---

export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

/** `needs-auth`: the server wants an OAuth sign-in. `disconnected`: reconnects on the next call. */
export type McpServerState =
	| "disabled"
	| "starting"
	| "connecting"
	| "connected"
	| "needs-auth"
	| "failed"
	| "disconnected"
	| (string & {});

export interface McpServerStatus {
	name: string;
	/** Config file (backend path) or extension that defines the server. */
	source: string;
	scope?: string;
	/** URL or command line. */
	transport: string;
	enabled: boolean;
	exposure: McpExposure;
	state: McpServerState;
	error?: string;
	/** Result of the last action (e.g. a failed sign-in). */
	message?: string;
	oauth: boolean;
	hasResources: boolean;
	tools: { name: string; description?: string }[];
}

export interface McpStatus {
	configErrors: string[];
	overridden: string[];
	servers: McpServerStatus[];
}

export type McpAction = "reconnect" | "enable" | "disable" | "signin" | "signout";

/** A `/command` the session accepts: an extension command, a prompt template, or a skill (`skill:<name>`). */
export interface SlashCommand {
	/** Without the leading slash. */
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	/** Where it comes from, for display (package name, "builtin", "local"). */
	origin: string;
	/** Whether `sessions.completeCommand` can suggest arguments. */
	completesArguments: boolean;
}

export interface CompletionItem {
	/** Replaces the whole argument text. */
	value: string;
	label: string;
	description?: string;
}

export interface ContextUsageInfo {
	/** Estimated tokens in the context, or null when unknown (e.g. right after compaction). */
	tokens: number | null;
	contextWindow: number;
	/** 0-100, or null when `tokens` is unknown. */
	percent: number | null;
}

export interface StatusEntry {
	key: string;
	text: string;
}

/** Full, self-contained state of one loaded session. Clients rebuild from it after (re)connect. */
export interface SessionState {
	sessionId: string;
	sessionPath?: string;
	cwd: string;
	name?: string;
	status: SessionStatus;
	model?: ModelRef;
	thinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
	permissionMode: PermissionMode;
	items: TranscriptItem[];
	tools: Record<string, ToolCallState>;
	pendingInteractions: Interaction[];
	queue: { steering: string[]; followUp: string[] };
	statusEntries: StatusEntry[];
	compacting: boolean;
	retry?: { attempt: number; maxAttempts: number; errorMessage: string };
	lastUsage?: UsageInfo;
	/** How full the model's context window is. Undefined without a model. */
	contextUsage?: ContextUsageInfo;
	/** Undefined until the MCP extension reports (or when it is disabled). */
	mcp?: McpStatus;
}

export interface SessionSnapshot {
	state: SessionState;
	/** Sequence number of the last event already applied to `state`. */
	seq: number;
}

// ---------------------------------------------------------------------------
// Session events (backend -> client). Applied in order by the shared reducer.
// ---------------------------------------------------------------------------

export type SessionEvent =
	| { type: "run_started" }
	| { type: "run_settled"; aborted: boolean }
	| { type: "item_added"; item: TranscriptItem }
	/** Authoritative replacement of an item (e.g. message_end). */
	| { type: "item_replaced"; item: TranscriptItem }
	| {
			type: "assistant_delta";
			itemId: string;
			contentIndex: number;
			blockType: "text" | "thinking" | "toolCall";
			delta: string;
			/** Present on the first delta of a tool call block. */
			toolCall?: { toolCallId: string; name: string };
	  }
	| { type: "tool_started"; toolCallId: string; name: string; args: unknown }
	| { type: "tool_updated"; toolCallId: string; output: string }
	| {
			type: "tool_ended";
			toolCallId: string;
			isError: boolean;
			output: string;
			imageCount: number;
			durationMs?: number;
			/** The actual change, when the tool reports one; otherwise an earlier preview stays. */
			diff?: string;
	  }
	| { type: "tool_diff"; toolCallId: string; diff: string }
	| { type: "tool_blocked"; toolCallId: string; reason: string }
	| { type: "queue_updated"; steering: string[]; followUp: string[] }
	| { type: "compaction_started" }
	| { type: "compaction_ended"; errorMessage?: string }
	| { type: "retry_started"; attempt: number; maxAttempts: number; errorMessage: string }
	| { type: "retry_ended" }
	| { type: "name_changed"; name?: string }
	| { type: "model_changed"; model?: ModelRef }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| { type: "permission_mode_changed"; mode: PermissionMode }
	| { type: "interaction_requested"; interaction: Interaction }
	| { type: "interaction_resolved"; interactionId: string }
	| { type: "status_entry"; key: string; text?: string }
	| { type: "notification"; level: "info" | "warning" | "error"; message: string }
	| { type: "mcp_changed"; mcp: McpStatus }
	| { type: "context_usage_changed"; usage?: ContextUsageInfo }
	/** Replace the whole state (used after operations that rebuild history, e.g. compaction). */
	| { type: "reset"; state: SessionState };

export interface SessionEventEnvelope {
	sessionId: string;
	seq: number;
	event: SessionEvent;
}

/** Backend-wide events, not tied to one session. */
export type GlobalEvent = { type: "sessions_changed" } | { type: "session_unloaded"; sessionId: string };

// ---------------------------------------------------------------------------
// Request/response methods
// ---------------------------------------------------------------------------

/** An image sent inline (base64). Kept out of SessionState; fetched on demand with sessions.getImages. */
export interface ImageData {
	mimeType: string;
	/** Base64, without a data: prefix. */
	data: string;
}

export interface DirEntry {
	name: string;
	path: string;
	isDir: boolean;
}

export interface Methods {
	"environment.info": { params: Record<string, never>; result: EnvironmentInfo };
	"fs.listDir": {
		params: { path?: string; dirsOnly?: boolean };
		result: { path: string; parent?: string; entries: DirEntry[] };
	};
	"models.list": { params: Record<string, never>; result: { models: ModelInfo[] } };
	"sessions.list": { params: { cwd?: string }; result: { sessions: SessionSummary[] } };
	"sessions.create": { params: { cwd: string }; result: SessionSnapshot };
	"sessions.open": { params: { sessionPath: string }; result: SessionSnapshot };
	/**
	 * Start receiving events for a loaded session. With `sinceSeq` the backend replays missed events
	 * when it still has them, otherwise it returns a fresh snapshot.
	 */
	"sessions.attach": {
		params: { sessionId: string; sinceSeq?: number };
		result: { snapshot: SessionSnapshot } | { events: SessionEventEnvelope[] };
	};
	"sessions.detach": { params: { sessionId: string }; result: Record<string, never> };
	"sessions.prompt": {
		params: {
			sessionId: string;
			/** Client-generated id; resending the same id never runs the prompt twice. */
			clientMessageId: string;
			text: string;
			/** pi resizes/normalizes them for the model. */
			images?: ImageData[];
			streamingBehavior?: "steer" | "followUp";
		};
		result: { disposition: "started" | "queued" | "handled" };
	};
	/** Images of a tool result (by toolCallId) or of a user message (by transcript item id). */
	"sessions.getImages": {
		params: { sessionId: string; toolCallId?: string; itemId?: string };
		result: { images: ImageData[] };
	};
	/**
	 * Store a file on the backend machine (browsers cannot pass paths) and return its backend path,
	 * for referencing it in a prompt as @"path".
	 */
	"files.upload": { params: { name: string; data: string }; result: { path: string } };
	/**
	 * Re-send a user message with new text: the conversation branches off before that message (the old
	 * branch stays in the session tree). The client gets a `reset` event with the new history, then the
	 * turn's events. Idempotent per `clientMessageId`, like `sessions.prompt`.
	 */
	"sessions.editMessage": {
		params: { sessionId: string; itemId: string; text: string; clientMessageId: string };
		result: { disposition: "started" | "queued" | "handled" };
	};
	/** Remove every queued steering/follow-up message (pi has no per-message removal) and return them. */
	"sessions.clearQueue": { params: { sessionId: string }; result: { steering: string[]; followUp: string[] } };
	"sessions.abort": { params: { sessionId: string }; result: Record<string, never> };
	"sessions.setModel": { params: { sessionId: string; model: ModelRef }; result: Record<string, never> };
	"sessions.setThinkingLevel": {
		params: { sessionId: string; level: ThinkingLevel };
		result: Record<string, never>;
	};
	"sessions.setPermissionMode": {
		params: { sessionId: string; mode: PermissionMode };
		result: Record<string, never>;
	};
	"sessions.rename": { params: { sessionId: string; name: string }; result: Record<string, never> };
	/** `exposure` is required for the "exposure" action. Resolves when the action finished or started in the background. */
	"sessions.mcpAction": {
		params: { sessionId: string; server: string; action: McpAction | "exposure"; exposure?: McpExposure };
		result: { error?: string };
	};
	/** Starts compaction (aborting a running turn, like pi does) and returns; progress comes as events. */
	"sessions.compact": { params: { sessionId: string; customInstructions?: string }; result: Record<string, never> };
	"sessions.commands": { params: { sessionId: string }; result: { commands: SlashCommand[] } };
	"sessions.completeCommand": {
		params: { sessionId: string; name: string; argumentPrefix: string };
		result: { items: CompletionItem[] };
	};
	/**
	 * `@file` completion for the text before the cursor (pi's editor semantics). `prefix` is the
	 * `@...` text the chosen value replaces; files get a trailing space, directories do not.
	 */
	"sessions.completeFile": {
		params: { sessionId: string; textBeforeCursor: string };
		result: { prefix: string; items: (CompletionItem & { isDirectory: boolean })[] } | null;
	};
	"sessions.unload": { params: { sessionId: string }; result: Record<string, never> };
	"interactions.respond": {
		params: { sessionId: string; interactionId: string; response: InteractionResponse };
		result: { accepted: boolean };
	};
}

export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = Methods[M]["params"];
export type MethodResult<M extends MethodName> = Methods[M]["result"];

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export type ErrorCode =
	| "unauthorized"
	| "protocol_mismatch"
	| "bad_request"
	| "not_found"
	| "conflict"
	| "internal"
	| "disconnected"
	| "timeout";

export interface ProtocolError {
	code: ErrorCode;
	message: string;
}

export type ClientFrame =
	| { kind: "hello"; protocolVersion: number; token: string; clientName: string }
	| { kind: "request"; id: string; method: MethodName; params: unknown };

export type ServerFrame =
	| { kind: "welcome"; protocolVersion: number; environment: EnvironmentInfo }
	| { kind: "response"; id: string; ok: true; result: unknown }
	| { kind: "response"; id: string; ok: false; error: ProtocolError }
	| { kind: "session_event"; envelope: SessionEventEnvelope }
	| { kind: "global_event"; event: GlobalEvent }
	| { kind: "fatal"; error: ProtocolError };
