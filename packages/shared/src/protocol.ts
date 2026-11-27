/**
 * Argon wire protocol (client <-> backend).
 *
 * Rules (see CLAUDE.md):
 * - Everything here must be JSON-serializable. No functions, class instances, Dates, Buffers.
 * - The backend is always treated as remote, even when it runs on localhost.
 * - Paths are opaque strings that belong to the backend's environment; clients never do IO with them.
 */

import type { FileDiff, ToolCallState, ToolDisplay, TranscriptItem, UsageInfo } from "./transcript.ts";

export const PROTOCOL_VERSION = 2;

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
	/** Whether the OS sandbox (decisions D15) works on the backend machine. */
	sandbox: SandboxSupport;
}

/**
 * OS sandbox availability on the backend machine. Only macOS (Seatbelt) is implemented; elsewhere
 * `supported` is false and the "ask" permission mode is unavailable (sessions run in "auto").
 * `supported` true with `reason` set means the platform supports it but initialization failed:
 * shell commands are refused (fail-closed) until it is fixed.
 */
export interface SandboxSupport {
	supported: boolean;
	mechanism?: "seatbelt";
	reason?: string;
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

/**
 * "ask": shell commands run in the OS sandbox without asking; file writes inside the writable roots
 * are allowed; anything that leaves the sandbox (writes elsewhere, unlisted network hosts, running a
 * command unsandboxed, other tools) asks. Only available where `EnvironmentInfo.sandbox.supported`.
 * "auto": no sandbox, nothing asks.
 */
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
	/** Archived sessions are listed apart (Argon preference, per environment). */
	archived?: boolean;
	/** When the session was pinned (epoch ms); pinned sessions are listed apart, newest pin first (D16). */
	pinnedAt?: number;
}

export type SessionStatus = "idle" | "running";

export type InteractionKind = "select" | "confirm" | "input" | "editor" | "tool_approval" | "oauth" | "network_access";

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
			/** Preview of the file change, for file-changing tools (see ToolCallState.diffs). */
			diffs?: FileDiff[];
			/** The rule "Always allow" would save, e.g. { tool: "bash", command: "npm test" }. */
			suggestedRule?: PermissionRule;
			/** The model asked to run this shell command outside the sandbox. */
			unsandboxed?: boolean;
	  })
	/**
	 * A sandboxed command tried to reach a host that is not in `ArgonSettings.sandbox.allowedDomains`.
	 * Answered with a `decision`: allow (this connection), allow_session, allow_always (saved to
	 * settings), deny.
	 */
	| (InteractionBase & { kind: "network_access"; host: string; port?: number; toolCallId?: string });

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

/**
 * "enable" / "disable" apply to this session only (stored in the session, decisions D16); the defaults
 * for new sessions are edited with `mcp.config.*` and `settings.updateArgonProject`.
 */
export type McpAction = "reconnect" | "enable" | "disable" | "signin" | "signout";

// --- MCP configuration (mcp.json files on the backend, decisions D16) ---

/** "global": `$ARGON_HOME/agent/mcp.json`. "project": `<cwd>/.argon/mcp.json` (used only when trusted). */
export type McpConfigScope = "global" | "project";

/** The part of an mcp.json server entry Argon's form edits; other fields of an existing entry are kept. */
export type McpServerForm =
	| { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
	| { transport: "http"; url: string; headers?: Record<string, string> };

export interface McpConfigServer {
	name: string;
	/**
	 * Undefined for a project entry that only overrides `enabled` / `exposure` of the global server
	 * with the same name, and for entries the form cannot represent (shown read-only; edit as JSON).
	 */
	form?: McpServerForm;
	/** A project override of a global server (see `form`). */
	override?: boolean;
	/** The file's `enabled` (default true): the default for new sessions, before project settings. */
	enabled: boolean;
	exposure?: McpExposure;
	/** Uses `auth.provider` (a provider login's token; global file only). */
	authProvider?: string;
}

export interface McpConfigFile {
	scope: McpConfigScope;
	/** Backend path. */
	path: string;
	exists: boolean;
	servers: McpConfigServer[];
	/** The file could not be read or parsed; `servers` is then empty. */
	error?: string;
	/** Project scope: pi ignores the file while the project is not trusted. */
	trusted?: boolean;
}

/** A config location: the global file, or a project's (`cwd` required). */
export type McpConfigTarget = { scope: "global" } | { scope: "project"; cwd: string };

// --- Argon's private per-project settings (decisions D16) ---

/**
 * Per-project choices the repository must not make for itself, kept on the backend machine
 * ($ARGON_HOME/settings.json `projects`, keyed by canonical project path). Unset keys fall back to
 * the global value. They apply to sessions started afterwards.
 */
export interface ArgonProjectSettings {
	permissionMode?: PermissionMode;
	toolPreset?: ToolPresetId;
	/** New sessions: server name → on/off, over the mcp.json `enabled` default. */
	mcpServers?: Record<string, boolean>;
}

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

/** API protocols a custom provider can speak (pi's `api` values; models.json accepts others too). */
export const PROVIDER_APIS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
] as const;

/** A model entry of a provider in models.json: the subset Argon's form edits. */
export interface CustomModelConfig {
	/** Model ID sent to the API. */
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
}

/**
 * A provider entry in pi's models.json (`$ARGON_HOME/agent/models.json`): the subset Argon's form
 * edits. Saving keeps every other field of the entry (compat, cost, modelOverrides, ...) as it was;
 * a managed field left out is removed. On a built-in provider only `baseUrl` and `headers` apply.
 */
export interface CustomProviderConfig {
	name?: string;
	baseUrl?: string;
	/** One of PROVIDER_APIS, or another pi API id. Required for a new (non built-in) provider. */
	api?: string;
	/** Literal key, `$ENV_NAME` interpolation, or `!command` output (resolved by pi at request time). */
	apiKey?: string;
	headers?: Record<string, string>;
	/** Send the key as `Authorization: Bearer`. */
	authHeader?: boolean;
	models?: CustomModelConfig[];
}

export interface ProviderInfo {
	id: string;
	name: string;
	/** "plugin": a magpie community plugin provider. "custom": defined in models.json only. */
	origin: "builtin" | "plugin" | "custom";
	/** What models.json sets for this provider (a custom provider, or overrides of a built-in one). */
	config?: CustomProviderConfig;
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

/** Bun runtime the plugin host needs, on the backend machine. */
export interface PluginRuntimeStatus {
	state: "missing" | "preparing" | "ready" | "failed";
	/** While preparing: bytes received and total (total absent when unknown). */
	received?: number;
	total?: number;
	/** When failed: the error (includes the failed URL). */
	error?: string;
}
export type BunSource = "system" | "managed";
export interface SystemBunInfo {
	path: string;
	version: string;
	compatible: boolean;
}
export interface PluginsStatus {
	/** Installed backend Bun or magpie's managed download. */
	bunSource: BunSource;
	/** First Bun found in PATH, $BUN_INSTALL/bin or ~/.bun/bin. */
	systemBun?: SystemBunInfo;
	/** Minimum compatible installed Bun version. */
	minSystemBunVersion: string;
	/** MAGPIE_PI_BUN overrides the source and mirror. */
	bunPathEnv?: string;
	enabled: boolean;
	/** Bun download source: "github" | "npmmirror" | "npmmirror-cdn" | an HTTPS base URL. */
	bunMirror: string;
	/** Set when ARGON_BUN_MIRROR overrides the stored mirror. */
	bunMirrorEnv?: string;
	/** Version of the managed download. */
	bunVersion: string;
	runtime: PluginRuntimeStatus;
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

/** The pi settings a project may override (everything but backend-wide choices such as project trust). */
export type ProjectPiSettings = Omit<PiSettings, "defaultProjectTrust">;

export interface ProjectSettingsInfo {
	cwd: string;
	/** Backend path of the project settings file. */
	path: string;
	/** Only the keys the project file sets. */
	values: Partial<ProjectPiSettings>;
	/** pi ignores project settings while the project is not trusted. */
	trusted: boolean;
	/** The file exists but could not be parsed. */
	error?: string;
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
	/** GPT-5 and later get `apply_patch` instead of edit / write (decisions D17). Default true. */
	gptApplyPatch: boolean;
	/** Offer the `codex_imagegen` tool (needs a ChatGPT login; uses its quota). Default false. */
	imageGeneration: boolean;
	permissions: { defaultMode: PermissionMode; rules: PermissionRule[] };
	/** OS sandbox policy (decisions D15); used in "ask" mode where the sandbox is supported. */
	sandbox: { allowedDomains: string[] };
	/** Tool preset for new sessions (decisions D13). */
	defaultToolPreset: ToolPresetId;
}

/**
 * A tool preset (decisions D13): which tools the model gets and how they are presented. Ids are open
 * strings so the backend can add presets; frontends label known ids and fall back to `label`.
 * Built-in ids: "classic" (separate tools), "codemode" (codemode alongside them), "codemode_only".
 */
export type ToolPresetId = string;

export interface ToolPresetInfo {
	id: ToolPresetId;
	/** English fallback label. */
	label: string;
	description: string;
}

export interface StatusEntry {
	key: string;
	text: string;
}

export type ProjectTrustStatus = "not_required" | "trusted" | "untrusted" | "undecided";

export type ProjectTrustDecision = "trust" | "trust_parent" | "deny" | "trust_session" | "deny_session";

export interface ProjectTrustInfo {
	status: ProjectTrustStatus;
	/** Set when a user-level extension decided (pi's `project_trust` event). */
	decidedBy?: string;
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
	/** How many times the same problem was reported (repeats are folded into one entry). */
	count?: number;
}

/** A text widget an extension shows next to the composer (pi's setWidget with string lines). */
export interface ExtensionWidget {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
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
	/** The session's tool preset. */
	toolPreset: ToolPresetId;
	/** True while a newly chosen preset waits for the current turn to finish. */
	toolPresetPending?: boolean;
	projectTrust?: ProjectTrustInfo;
	diagnostics: SessionDiagnostic[];
	items: TranscriptItem[];
	tools: Record<string, ToolCallState>;
	pendingInteractions: Interaction[];
	queue: { steering: string[]; followUp: string[] };
	statusEntries: StatusEntry[];
	/** Extension widgets, in the order they were first set. */
	widgets: ExtensionWidget[];
	/** Replaces the generic "working" label while a turn runs (pi's setWorkingMessage). */
	workingMessage?: string;
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
	/**
	 * Notifications emitted while no client was attached (e.g. by an extension that set the session up
	 * before switching to it). Delivered once, to the first client that attaches.
	 */
	notifications?: Extract<SessionEvent, { type: "notification" }>[];
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
	| {
			type: "tool_started";
			toolCallId: string;
			name: string;
			args: unknown;
			/** Nested calls only (see ToolCallState.parentToolCallId). */
			parentToolCallId?: string;
			display?: ToolDisplay;
			source?: string;
	  }
	| { type: "tool_updated"; toolCallId: string; output: string }
	| {
			type: "tool_ended";
			toolCallId: string;
			isError: boolean;
			output: string;
			imageCount: number;
			durationMs?: number;
			/** The actual change, when the tool reports one; otherwise an earlier preview stays. */
			diffs?: FileDiff[];
	  }
	| { type: "tool_diff"; toolCallId: string; diffs: FileDiff[] }
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
	| { type: "tool_preset_changed"; preset: ToolPresetId; pending: boolean }
	| { type: "project_trust_changed"; trust: ProjectTrustInfo }
	| { type: "diagnostics_changed"; diagnostics: SessionDiagnostic[] }
	| { type: "interaction_requested"; interaction: Interaction }
	| { type: "interaction_resolved"; interactionId: string }
	| { type: "status_entry"; key: string; text?: string }
	/** `widget` undefined: removed. */
	| { type: "widget_changed"; key: string; widget?: ExtensionWidget }
	| { type: "working_message_changed"; message?: string }
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
	/** An mcp.json or the MCP defaults changed (re-read with mcp.config.get / settings.get). */
	| { type: "mcp_config_changed" }
	/** Plugins were enabled/disabled, or the Bun runtime's preparation progressed (see plugins.enable). */
	| { type: "plugins_status"; status: PluginsStatus }
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
	/**
	 * With `cwd`, also the models in that project's `enabledModels` scope (pi's model cycling set), in
	 * pattern order. `scoped` is undefined when no scope is configured (every model is in scope).
	 */
	"models.list": {
		params: { cwd?: string };
		result: {
			models: ModelInfo[];
			scoped?: (ModelRef & { thinkingLevel?: ThinkingLevel })[];
			scopeWarnings?: string[];
		};
	};
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
	/** Takes effect at the next turn boundary; changing tools resets the prompt cache once. */
	"sessions.setToolPreset": { params: { sessionId: string; preset: ToolPresetId }; result: Record<string, never> };
	"toolPresets.list": { params: Record<string, never>; result: { presets: ToolPresetInfo[] } };
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
	/** Archive or restore a session (listed sessions only). Archiving does not unload it. */
	/** Archiving also unpins. */
	"sessions.setArchived": { params: { sessionPath: string; archived: boolean }; result: Record<string, never> };
	"sessions.setPinned": { params: { sessionPath: string; pinned: boolean }; result: Record<string, never> };
	/** Drop extension and model diagnostics. Resource problems stay until they are fixed (they are re-reported on reload). */
	"sessions.clearDiagnostics": { params: { sessionId: string }; result: Record<string, never> };
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
	/**
	 * models.json as text, for the raw editor. `version` identifies the content (pass it back to
	 * `models.config.set`); `error` is pi's current problem loading it, if any.
	 */
	"models.config.get": {
		params: Record<string, never>;
		result: { path: string; text: string; version: string; error?: string };
	};
	/**
	 * Replace models.json. Rejected (bad_request) when it is not valid JSON or fails pi's schema, and
	 * (conflict) when the file changed since `version` was read. Reloads models for all sessions.
	 */
	"models.config.set": { params: { text: string; version: string }; result: { version: string } };
	/**
	 * Create (`create: true`, the id must be unused) or update a provider entry in models.json, then
	 * reload. Fields outside CustomProviderConfig in the existing entry are kept.
	 */
	"providers.save": {
		params: { id: string; config: CustomProviderConfig; create: boolean };
		result: Record<string, never>;
	};
	/** Remove the provider's models.json entry (a custom provider disappears; a built-in one loses its overrides). */
	"providers.remove": { params: { id: string }; result: Record<string, never> };
	/**
	 * List the models an OpenAI-compatible endpoint offers (`GET {baseUrl}/models`). Without `apiKey`,
	 * a saved provider's (`providerId`) credentials are used.
	 */
	"providers.discoverModels": {
		params: { baseUrl: string; api: string; apiKey?: string; headers?: Record<string, string>; providerId?: string };
		result: { models: { id: string; name?: string }[] };
	};
	"plugins.list": {
		params: Record<string, never>;
		result: { plugins: PluginInfo[]; status: PluginsStatus; errors: string[]; available: boolean };
	};
	/**
	 * Enable plugins and prepare Bun in the background (downloaded on first enable); progress arrives as
	 * `plugins_status` events. Also retries a failed preparation, optionally with another mirror.
	 * `confirmed` must be true: plugins run with the backend user's privileges.
	 */
	"plugins.enable": {
		params: { bunMirror?: string; bunSource?: BunSource; confirmed: boolean };
		result: { status: PluginsStatus };
	};
	/** Stop the plugin host and unregister its providers. A running Bun download finishes and stays cached. */
	"plugins.disable": { params: Record<string, never>; result: { status: PluginsStatus } };
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
	/** `pi` is the global scope; with `cwd`, `project` holds what the project's settings file sets. */
	"settings.get": {
		params: { cwd?: string };
		result: {
			pi: PiSettings;
			resources: ResourceSettings[];
			argon: ArgonSettings;
			project?: ProjectSettingsInfo;
			/** With `cwd`: the project's private Argon settings (only the keys it sets). */
			argonProject?: ArgonProjectSettings;
		};
	};
	/** Changes apply to sessions started afterwards (loaded sessions keep their settings until reopened). */
	"settings.update": {
		params: { pi?: Partial<PiSettings>; argon?: Partial<ArgonSettings> };
		result: Record<string, never>;
	};
	/**
	 * Set (`set`) or remove (`unset`, falling back to the global value) project-level pi settings in
	 * `<cwd>/.argon/settings.json`. Applies to sessions started afterwards, like `settings.update`.
	 */
	"settings.updateProject": {
		params: { cwd: string; set?: Partial<ProjectPiSettings>; unset?: (keyof ProjectPiSettings)[] };
		result: Record<string, never>;
	};
	/**
	 * Set (`set`) or remove (`unset`, falling back to the global value) the project's private Argon
	 * settings. `set.mcpServers` replaces the whole map. Applies to sessions started afterwards.
	 */
	"settings.updateArgonProject": {
		params: { cwd: string; set?: ArgonProjectSettings; unset?: (keyof ArgonProjectSettings)[] };
		result: Record<string, never>;
	};
	/** The global mcp.json and, with `cwd`, the project's. */
	"mcp.config.get": {
		params: { cwd?: string };
		result: { global: McpConfigFile; project?: McpConfigFile };
	};
	/**
	 * Create (`create: true`; the name must be unused in that file) or update a server, renaming it
	 * when `previousName` differs. Validated with pi's rules (bad_request on failure). Loaded sessions
	 * the file affects are reloaded (running ones after their turn).
	 */
	"mcp.config.saveServer": {
		params: McpConfigTarget & { name: string; previousName?: string; form: McpServerForm; create: boolean };
		result: Record<string, never>;
	};
	"mcp.config.removeServer": { params: McpConfigTarget & { name: string }; result: Record<string, never> };
	/**
	 * Add pasted server entries (`mcpServers` values, as JSON) to a file. Each is validated with pi's
	 * rules; nothing is written when any fails (bad_request listing them). Names already in the file
	 * are a conflict unless `replace`. Reloads affected sessions.
	 */
	"mcp.config.importServers": {
		params: McpConfigTarget & { servers: Record<string, unknown>; replace?: boolean };
		result: { added: string[]; replaced: string[] };
	};
	/** Global default for new sessions (the global mcp.json `enabled`). Loaded sessions are not changed. */
	"mcp.config.setEnabled": { params: { name: string; enabled: boolean }; result: Record<string, never> };
	/** An mcp.json as text, for the raw editor (`text` is "" when the file does not exist). */
	"mcp.config.getText": { params: McpConfigTarget; result: { path: string; text: string; version: string } };
	/**
	 * Replace an mcp.json. Rejected (bad_request) when it is not valid JSON or pi reports an error for
	 * it, and (conflict) when it changed since `version` was read. Reloads affected sessions.
	 */
	"mcp.config.setText": {
		params: McpConfigTarget & { text: string; version: string };
		result: { version: string };
	};
	"projects.list": { params: Record<string, never>; result: { projects: ProjectPrefs[] } };
	"projects.update": {
		params: ProjectPrefs;
		result: Record<string, never>;
	};
	"projects.setTrust": {
		params: { cwd: string; decision: ProjectTrustDecision };
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
