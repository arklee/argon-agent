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
			/** The rule "Always allow" would save, e.g. { tool: "bash", command: "npm test" }. */
			suggestedRule?: PermissionRule;
	  });

export type InteractionResponse =
	| { cancelled: true }
	| { value: string }
	| { confirmed: boolean }
	/** allow_always: also save a rule (`rule`, or the suggestion in the request) to Argon settings. */
	| { decision: "allow" | "allow_session" | "allow_always" | "deny"; reason?: string; rule?: PermissionRule };

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

/** Where a user message sits among its siblings in the session tree (edits create siblings). */
export interface BranchPoint {
	/** 0-based position among the sibling user messages, oldest first. */
	index: number;
	count: number;
}

/** Per-environment project preferences, stored on the backend. */
export interface ProjectPrefs {
	cwd: string;
	pinned?: boolean;
	/** Hidden from the sidebar; its sessions are kept. */
	hidden?: boolean;
	/** Added explicitly (epoch ms): listed even before it has sessions. */
	addedAt?: number;
}

// --- Providers and accounts (backend-wide, shared with the pi CLI through auth.json) ---

export type AuthType = "api_key" | "oauth";

export interface ProviderInfo {
	id: string;
	name: string;
	/** "plugin": a magpie community plugin provider. */
	origin: "builtin" | "plugin";
	/** Whether requests can authenticate, and from where (stored credential, env var, ...). */
	auth: { configured: boolean; source?: string; label?: string };
	/** Stored credential type, when one is stored (logout removes it). */
	stored?: AuthType;
	/** Interactive login methods. Empty: configured through the environment only. */
	methods: { type: AuthType; name: string; label?: string; subscription?: boolean }[];
	modelCount: number;
}

/** A question a login flow waits on. `select` answers with an option id. */
export interface AuthPromptInfo {
	id: string;
	type: "text" | "secret" | "select" | "manual_code";
	message: string;
	placeholder?: string;
	options?: { id: string; label: string; description?: string }[];
}

export type AuthFlowEvent =
	| { type: "info"; message: string; links?: { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| { type: "device_code"; userCode: string; verificationUri: string; expiresInSeconds?: number }
	| { type: "progress"; message: string };

/** A login in progress (or just finished). Owned by the backend: any client can answer it. */
export interface AuthFlow {
	flowId: string;
	providerId: string;
	providerName: string;
	type: AuthType;
	status: "running" | "succeeded" | "failed" | "cancelled";
	prompt?: AuthPromptInfo;
	events: AuthFlowEvent[];
	error?: string;
	startedAt: number;
}

/** magpie community plugins (installed into magpie's own state directory on the backend machine). */
export interface PluginInfo {
	spec: string;
	/** Installed by the plugin manager (removable); false = configured by hand. */
	managed: boolean;
}

// --- Settings ---

/** The agent-relevant subset of pi's settings (global scope, ~/.pi/agent/settings.json). */
export interface PiSettings {
	defaultModel?: ModelRef;
	defaultThinkingLevel?: ThinkingLevel;
	/** Model patterns offered for cycling/selection; undefined = all. */
	enabledModels?: string[];
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	compaction: boolean;
	retry: boolean;
	shellPath?: string;
	shellCommandPrefix?: string;
	imageAutoResize: boolean;
	blockImages: boolean;
	enableSkillCommands: boolean;
	defaultProjectTrust: string;
}

/** Resources a scope loads (read-only view; edit with pi's own commands or the settings files). */
export interface ResourceSettings {
	scope: "global" | "project";
	/** Backend path of the settings file. */
	path: string;
	packages: string[];
	extensions: string[];
	skills: string[];
	prompts: string[];
}

/** A persisted "always allow" rule. `command` (bash only) matches commands equal to it or starting with it plus a space. */
export interface PermissionRule {
	tool: string;
	command?: string;
}

/** Argon's own settings, per backend environment ($ARGON_HOME/settings.json). */
export interface ArgonSettings {
	permissions: { defaultMode: PermissionMode; rules: PermissionRule[] };
}

export interface StatusEntry {
	key: string;
	text: string;
}

export type ProjectTrustStatus = "not_required" | "trusted" | "untrusted" | "undecided";

export interface ProjectTrustInfo {
	status: ProjectTrustStatus;
	/** Folder whose saved decision applies, if any. */
	savedPath?: string;
	/** Parent folder offered as "trust parent". */
	parentPath?: string;
}

export interface SessionDiagnostic {
	id: string;
	level: "warning" | "error";
	source: "resources" | "extension" | "model";
	message: string;
	path?: string;
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
	projectTrust?: ProjectTrustInfo;
	diagnostics: SessionDiagnostic[];
	items: TranscriptItem[];
	tools: Record<string, ToolCallState>;
	pendingInteractions: Interaction[];
	queue: { steering: string[]; followUp: string[] };
	statusEntries: StatusEntry[];
	compacting: boolean;
	retry?: { attempt: number; maxAttempts: number; errorMessage: string };
	lastUsage?: UsageInfo;
	/**
	 * Branch info for the user messages of the current branch, in transcript order (aligned with the
	 * user items, not keyed by id, so live items are covered too). null = no siblings.
	 */
	userBranches?: (BranchPoint | null)[];
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
	| { type: "project_trust_changed"; trust: ProjectTrustInfo }
	| { type: "diagnostics_changed"; diagnostics: SessionDiagnostic[] }
	| { type: "interaction_requested"; interaction: Interaction }
	| { type: "interaction_resolved"; interactionId: string }
	| { type: "status_entry"; key: string; text?: string }
	| { type: "notification"; level: "info" | "warning" | "error"; message: string }
	| { type: "mcp_changed"; mcp: McpStatus }
	| { type: "context_usage_changed"; usage?: ContextUsageInfo }
	| { type: "branches_changed"; userBranches: (BranchPoint | null)[] }
	/** Replace the whole state (used after operations that rebuild history, e.g. compaction). */
	| { type: "reset"; state: SessionState };

export interface SessionEventEnvelope {
	sessionId: string;
	seq: number;
	event: SessionEvent;
}

/** Backend-wide events, not tied to one session. */
export type GlobalEvent =
	| { type: "sessions_changed" }
	| { type: "session_unloaded"; sessionId: string }
	| { type: "projects_changed" }
	/** Providers, their auth state or their models changed (login, logout, plugin changes). */
	| { type: "providers_changed" }
	| { type: "auth_flow"; flow: AuthFlow }
	/**
	 * An extension in `fromSessionId` started or switched to another session (pi's newSession / fork /
	 * switchSession). Clients showing `fromSessionId` should open `sessionPath`.
	 */
	| { type: "session_requested"; fromSessionId: string; sessionPath: string };

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
	/** Delete a session file (unloading it first). Only paths of listed sessions are accepted. */
	"sessions.delete": { params: { sessionPath: string }; result: Record<string, never> };
	/** Show the previous/next sibling of a user message (its latest continuation). Idle sessions only. */
	"sessions.switchBranch": {
		params: { sessionId: string; itemId: string; direction: -1 | 1 };
		result: Record<string, never>;
	};
	/**
	 * New session with the history before a user message (pi's /fork). Returns its path (open it with
	 * sessions.open) and the message text, for the composer.
	 */
	"sessions.fork": { params: { sessionId: string; itemId: string }; result: { sessionPath: string; text: string } };
	/** New session with a copy of the current branch (pi's /clone). */
	"sessions.clone": { params: { sessionId: string }; result: { sessionPath: string } };
	"providers.list": { params: Record<string, never>; result: { providers: ProviderInfo[] } };
	/** Start a login; progress and prompts arrive as `auth_flow` events. */
	"auth.login": { params: { providerId: string; type: AuthType }; result: { flowId: string } };
	/** Running and recently finished flows (for clients that (re)connect mid-login). */
	"auth.flows": { params: Record<string, never>; result: { flows: AuthFlow[] } };
	"auth.respond": { params: { flowId: string; promptId: string; value: string }; result: { accepted: boolean } };
	"auth.cancel": { params: { flowId: string }; result: Record<string, never> };
	"auth.logout": { params: { providerId: string }; result: Record<string, never> };
	"plugins.list": {
		params: Record<string, never>;
		result: { plugins: PluginInfo[]; errors: string[]; available: boolean };
	};
	"plugins.search": {
		params: { query: string };
		result: { results: { name: string; version: string; description?: string }[] };
	};
	/**
	 * Install or remove a community plugin, then restart the plugin host. `confirmed` must be true:
	 * plugins run with the backend user's privileges, so the client has to ask the user first.
	 */
	"plugins.change": {
		params: { action: "install" | "remove"; spec: string; confirmed: boolean };
		result: { message: string };
	};
	"settings.get": {
		params: { cwd?: string };
		result: { pi: PiSettings; resources: ResourceSettings[]; argon: ArgonSettings };
	};
	/** Changes apply to sessions started afterwards (loaded sessions keep their settings until reopened). */
	"settings.update": {
		params: { pi?: Partial<PiSettings>; argon?: Partial<ArgonSettings> };
		result: Record<string, never>;
	};
	"projects.list": { params: Record<string, never>; result: { projects: ProjectPrefs[] } };
	"projects.update": {
		params: ProjectPrefs;
		result: Record<string, never>;
	};
	"projects.setTrust": {
		params: { cwd: string; decision: "trust" | "trust_parent" | "deny" | "trust_session" | "deny_session" };
		result: Record<string, never>;
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
