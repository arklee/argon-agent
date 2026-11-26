/**
 * One loaded pi session. Owns the AgentSessionRuntime, translates pi events to Argon events,
 * keeps the authoritative SessionState (via the shared reducer), numbers events, and keeps a
 * replay buffer so reconnecting clients can catch up without a full snapshot.
 *
 * The agent's lifecycle is independent of clients: runs continue and interactions stay pending
 * while no client is attached.
 */

import {
	applySessionEvent,
	type CompletionItem,
	type ContextUsageInfo,
	createEmptySessionState,
	type ImageData,
	type Interaction,
	type InteractionResponse,
	type McpAction,
	type McpExposure,
	type ModelRef,
	type PermissionMode,
	type SessionEvent,
	type SessionEventEnvelope,
	type SessionSnapshot,
	type SessionState,
	type SlashCommand,
	type ThinkingLevel,
} from "@argon/shared";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createBuiltinExtensions } from "./builtin-extensions.ts";
import { previewDiff, resultDiff } from "./diff-preview.ts";
import { completeFile, type FileCompletion } from "./file-completion.ts";
import { InteractionBroker } from "./interactions.ts";
import { log } from "./log.ts";
import { createMcpBridge, type McpBridge, type McpSignInUi } from "./mcp-bridge.ts";
import {
	createPermissionExtension,
	READ_ONLY_TOOLS,
	type ToolCallCheck,
	type ToolCallDecision,
} from "./permissions.ts";
import { messageToItem, projectHistory, toolResultOutput } from "./translate.ts";
import { createUIBridge } from "./ui-bridge.ts";

const REPLAY_BUFFER_SIZE = 5000;
const IDEMPOTENCY_CACHE_SIZE = 200;

export interface ManagedSessionDeps {
	agentDir: string;
	modelRuntime: ModelRuntime;
	defaultPermissionMode: PermissionMode;
}

export type PromptDisposition = "started" | "queued" | "handled";

export class ManagedSession {
	private state: SessionState;
	private seq = 0;
	private readonly buffer: SessionEventEnvelope[] = [];
	private readonly listeners = new Set<(envelope: SessionEventEnvelope) => void>();
	private readonly broker: InteractionBroker;
	private readonly promptResults = new Map<string, Promise<PromptDisposition>>();
	private readonly sessionAllowedTools = new Set<string>();
	private unsubscribe: (() => void) | undefined;
	private liveItemCounter = 0;
	private currentAssistantItemId: string | undefined;
	private disposed = false;

	private constructor(
		private readonly runtime: AgentSessionRuntime,
		private readonly mcp: McpBridge,
		private readonly agentDir: string,
		permissionMode: PermissionMode,
	) {
		const session = runtime.session;
		this.state = createEmptySessionState({
			sessionId: session.sessionId,
			cwd: runtime.cwd,
			sessionPath: session.sessionFile,
		});
		this.state.permissionMode = permissionMode;
		this.state.mcp = mcp.status;
		this.broker = new InteractionBroker({
			onRequested: (interaction) => this.emit({ type: "interaction_requested", interaction }),
			onResolved: (interactionId) => this.emit({ type: "interaction_resolved", interactionId }),
		});
	}

	/** Create a new session in `cwd`, or open an existing session file. */
	static async load(
		target: { kind: "new"; cwd: string } | { kind: "open"; sessionPath: string },
		deps: ManagedSessionDeps,
	): Promise<ManagedSession> {
		// The permission extension is created before the ManagedSession exists; it calls through this ref.
		let self: ManagedSession | undefined;
		const permissionExtension = createPermissionExtension({
			checkToolCall: (check) =>
				self ? self.checkToolCall(check) : Promise.resolve({ allow: false, reason: "Session not ready" }),
		});
		const mcp = createMcpBridge();

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			agentDir,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime: deps.modelRuntime,
				// The permission gate goes first so its tool_call handler runs before any other extension's.
				resourceLoaderOptions: {
					extensionFactories: [permissionExtension, ...createBuiltinExtensions(), mcp.extension],
				},
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const sessionManager =
			target.kind === "new" ? SessionManager.create(target.cwd) : SessionManager.open(target.sessionPath);
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir: deps.agentDir,
			sessionManager,
		});
		const managed = new ManagedSession(runtime, mcp, deps.agentDir, deps.defaultPermissionMode);
		self = managed;
		await managed.bind();
		// After binding: session_start handlers (e.g. MCP config loading) can add diagnostics.
		managed.reportDiagnostics();
		return managed;
	}

	get sessionId(): string {
		return this.state.sessionId;
	}

	get sessionPath(): string | undefined {
		return this.state.sessionPath;
	}

	get isRunning(): boolean {
		return this.state.status === "running";
	}

	private get session(): AgentSession {
		return this.runtime.session;
	}

	snapshot(): SessionSnapshot {
		return { state: this.state, seq: this.seq };
	}

	/** Events after `sinceSeq`, or undefined when the buffer no longer covers that range. */
	eventsSince(sinceSeq: number): SessionEventEnvelope[] | undefined {
		if (sinceSeq > this.seq) return undefined;
		if (sinceSeq === this.seq) return [];
		const first = this.buffer[0];
		if (!first || first.seq > sinceSeq + 1) return undefined;
		return this.buffer.slice(sinceSeq + 1 - first.seq);
	}

	subscribe(listener: (envelope: SessionEventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// -------------------------------------------------------------------------
	// Commands
	// -------------------------------------------------------------------------

	prompt(params: {
		clientMessageId: string;
		text: string;
		images?: ImageData[];
		streamingBehavior?: "steer" | "followUp";
	}): Promise<PromptDisposition> {
		const existing = this.promptResults.get(params.clientMessageId);
		if (existing) return existing;

		const result = new Promise<PromptDisposition>((resolve, reject) => {
			let answered = false;
			const streamingBehavior = this.session.isStreaming ? (params.streamingBehavior ?? "followUp") : undefined;
			this.session
				.prompt(params.text, {
					source: "rpc",
					images: params.images?.map((image) => ({
						type: "image" as const,
						data: image.data,
						mimeType: image.mimeType,
					})),
					streamingBehavior,
					preflightResult: (disposition) => {
						answered = true;
						resolve(disposition);
					},
				})
				.then(() => {
					if (!answered) resolve("handled");
				})
				.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					if (!answered) reject(error);
					else this.emit({ type: "notification", level: "error", message });
				});
		});
		this.promptResults.set(params.clientMessageId, result);
		if (this.promptResults.size > IDEMPOTENCY_CACHE_SIZE) {
			const oldest = this.promptResults.keys().next().value;
			if (oldest !== undefined) this.promptResults.delete(oldest);
		}
		// A rejected prompt may be retried with the same id.
		result.catch(() => this.promptResults.delete(params.clientMessageId));
		return result;
	}

	async editMessage(params: { itemId: string; text: string; clientMessageId: string }): Promise<PromptDisposition> {
		// A retried request must not branch a second time.
		const existing = this.promptResults.get(params.clientMessageId);
		if (existing) return existing;
		if (this.isRunning || this.session.isStreaming) throw new Error("Wait for the current turn to finish");
		const entryId = this.userEntryIdFor(params.itemId);
		if (!entryId) throw new Error("That message is no longer in this branch");
		const result = await this.session.navigateTree(entryId, {});
		if (result.cancelled) throw new Error("Editing was cancelled by an extension");
		this.resetFromSession();
		this.emit({ type: "reset", state: this.state });
		return this.prompt({ clientMessageId: params.clientMessageId, text: params.text });
	}

	/**
	 * Session entry id of a user item. History items already use entry ids; live items ("live-N") are
	 * matched by position, since the transcript's user items follow the branch's user messages 1:1.
	 */
	private userEntryIdFor(itemId: string): string | undefined {
		const userEntries = this.session.sessionManager
			.getBranch()
			.filter((entry) => entry.type === "message" && (entry.message as { role?: string }).role === "user");
		if (userEntries.some((entry) => entry.id === itemId)) return itemId;
		const index = this.state.items.filter((item) => item.kind === "user").findIndex((item) => item.id === itemId);
		return index === -1 ? undefined : userEntries[index]?.id;
	}

	getImages(ref: { toolCallId?: string; itemId?: string }): ImageData[] {
		const branch = this.session.sessionManager.getBranch();
		let content: unknown;
		if (ref.toolCallId) {
			const entry = branch.find(
				(e) =>
					e.type === "message" &&
					(e.message as { role?: string; toolCallId?: string }).role === "toolResult" &&
					(e.message as { toolCallId?: string }).toolCallId === ref.toolCallId,
			);
			content = entry?.type === "message" ? (entry.message as { content?: unknown }).content : undefined;
		} else if (ref.itemId) {
			const entryId = this.userEntryIdFor(ref.itemId);
			const entry = entryId ? branch.find((e) => e.id === entryId) : undefined;
			content = entry?.type === "message" ? (entry.message as { content?: unknown }).content : undefined;
		}
		if (!Array.isArray(content)) return [];
		return content.flatMap((part: { type?: string; data?: unknown; mimeType?: unknown }) =>
			part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string"
				? [{ mimeType: part.mimeType, data: part.data }]
				: [],
		);
	}

	clearQueue(): { steering: string[]; followUp: string[] } {
		// pi emits queue_update, which reaches clients as queue_updated.
		const { steering, followUp } = this.session.clearQueue();
		return { steering: [...steering], followUp: [...followUp] };
	}

	async abort(): Promise<void> {
		this.broker.cancelAll();
		await this.session.abort();
	}

	async setModel(ref: ModelRef, modelRuntime: ModelRuntime): Promise<void> {
		const model = modelRuntime.getModel(ref.provider, ref.id);
		if (!model) throw new Error(`Model not found: ${ref.provider}/${ref.id}`);
		await this.session.setModel(model);
		this.emit({ type: "model_changed", model: ref });
		this.emitThinkingState();
		this.emitContextUsage();
	}

	compact(customInstructions?: string): void {
		if (this.state.compacting) throw new Error("Already compacting");
		// Runs in the background: summarizing can take longer than a request. pi reports progress and
		// failures (compaction_end with errorMessage) as events, then rethrows; the rethrow is only logged.
		void this.session.compact(customInstructions?.trim() || undefined).catch((error: unknown) => {
			log.debug(`compaction ended with error: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.session.setThinkingLevel(level as Parameters<AgentSession["setThinkingLevel"]>[0]);
		this.emitThinkingState();
	}

	setPermissionMode(mode: PermissionMode): void {
		this.emit({ type: "permission_mode_changed", mode });
	}

	rename(name: string): void {
		this.session.setSessionName(name);
	}

	/** Same set pi's RPC `get_commands` returns. */
	listCommands(): SlashCommand[] {
		const session = this.session;
		const commands: SlashCommand[] = [];
		for (const command of session.extensionRunner.getRegisteredCommands()) {
			commands.push({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				origin: originLabel(command.sourceInfo.source),
				completesArguments: Boolean(command.getArgumentCompletions),
			});
		}
		for (const template of session.promptTemplates) {
			commands.push({
				name: template.name,
				description: template.description,
				source: "prompt",
				origin: originLabel(template.sourceInfo.source),
				completesArguments: false,
			});
		}
		for (const skill of session.resourceLoader.getSkills().skills) {
			commands.push({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				origin: originLabel(skill.sourceInfo.source),
				completesArguments: false,
			});
		}
		return commands;
	}

	async completeCommand(name: string, argumentPrefix: string): Promise<CompletionItem[]> {
		const command = this.session.extensionRunner
			.getRegisteredCommands()
			.find((candidate) => candidate.invocationName === name);
		if (!command?.getArgumentCompletions) return [];
		try {
			const items = (await command.getArgumentCompletions(argumentPrefix)) ?? [];
			return items.map((item) => ({ value: item.value, label: item.label, description: item.description }));
		} catch (error) {
			log.warn(`argument completion for /${name} failed`, error);
			return [];
		}
	}

	completeFile(textBeforeCursor: string): Promise<FileCompletion | undefined> {
		// Bounded: a slow fd on a huge tree must not hold the request.
		return completeFile(textBeforeCursor, this.state.cwd, this.agentDir, AbortSignal.timeout(5000)).catch(
			() => undefined,
		);
	}

	/** Returns an error message, or undefined on success. */
	mcpAction(params: {
		server: string;
		action: McpAction | "exposure";
		exposure?: McpExposure;
	}): Promise<string | undefined> {
		const statusKey = `mcp-signin:${params.server}`;
		const ui: McpSignInUi = {
			status: (title, message) => this.emit({ type: "status_entry", key: statusKey, text: `${title}: ${message}` }),
			redirectUrl: async (title, url, signal) => {
				const response = await this.broker.request(
					{ kind: "oauth", title, url },
					{ signal, fallback: { cancelled: true } },
				);
				return "value" in response ? response.value : undefined;
			},
		};
		const running = this.mcp.run({ ...params, ui }).finally(() => {
			if (this.state.statusEntries.some((entry) => entry.key === statusKey)) {
				this.emit({ type: "status_entry", key: statusKey, text: undefined });
			}
		});
		if (params.action !== "signin") return running;
		// A sign-in waits for the browser and can outlast a request, so it runs on its own; its pending
		// `oauth` interaction lives in the session like any other, and the outcome comes as a notification.
		void running.then((error) =>
			this.emit(
				error
					? { type: "notification", level: error === "Sign-in cancelled." ? "info" : "error", message: error }
					: { type: "notification", level: "info", message: `Signed in to MCP server "${params.server}"` },
			),
		);
		return Promise.resolve(undefined);
	}

	respond(interactionId: string, response: InteractionResponse): boolean {
		return this.broker.respond(interactionId, response);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.broker.cancelAll();
		this.unsubscribe?.();
		// AgentSessionRuntime.dispose() emits session_shutdown (needed by MCP to close child processes).
		await this.runtime.dispose();
		this.listeners.clear();
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private async bind(): Promise<void> {
		const session = this.session;
		// Subscribe before binding so events from session_start handlers are not lost.
		this.unsubscribe = session.subscribe((event) => this.handlePiEvent(event));
		this.mcp.onStatus((mcp) => this.emit({ type: "mcp_changed", mcp }));
		this.resetFromSession();
		await session.bindExtensions({
			uiContext: createUIBridge(this.broker, (event) => this.emit(event)),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async () => {
					this.emit({
						type: "notification",
						level: "warning",
						message: "Starting a new session from an extension is not supported yet",
					});
					return { cancelled: true };
				},
				fork: async () => ({ cancelled: true }),
				navigateTree: async () => ({ cancelled: true }),
				switchSession: async () => ({ cancelled: true }),
				reload: async () => {
					await session.reload();
					this.reportDiagnostics();
				},
			},
			onError: (error) => {
				log.warn(`[extension] ${error.extensionPath} (${error.event}): ${error.error}`);
				this.emit({
					type: "notification",
					level: "error",
					message: `Extension error in ${error.extensionPath}: ${error.error}`,
				});
			},
		});
	}

	private reportDiagnostics(): void {
		for (const diagnostic of this.runtime.takeUnreportedDiagnostics()) {
			log.warn(`[pi] ${diagnostic.type}: ${diagnostic.message}`);
		}
	}

	/** Rebuild the full state from the session tree (on load). */
	private resetFromSession(): void {
		const session = this.session;
		const history = projectHistory(session.sessionManager.getBranch());
		const next: SessionState = {
			...this.state,
			sessionId: session.sessionId,
			sessionPath: session.sessionFile,
			name: session.sessionName,
			status: session.isStreaming ? "running" : "idle",
			model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
			thinkingLevel: session.thinkingLevel,
			availableThinkingLevels: session.getAvailableThinkingLevels(),
			items: [],
			tools: {},
			pendingInteractions: this.broker.list(),
		};
		let state = next;
		for (const item of history.items) state = applySessionEvent(state, { type: "item_added", item });
		for (const result of history.toolResults) {
			state = applySessionEvent(state, { type: "tool_ended", ...result });
		}
		this.state = { ...state, contextUsage: this.readContextUsage() };
	}

	private readContextUsage(): ContextUsageInfo | undefined {
		const usage = this.session.getContextUsage();
		return usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : undefined;
	}

	private emitContextUsage(): void {
		const usage = this.readContextUsage();
		const current = this.state.contextUsage;
		if (
			usage?.tokens === current?.tokens &&
			usage?.contextWindow === current?.contextWindow &&
			usage?.percent === current?.percent
		) {
			return;
		}
		this.emit({ type: "context_usage_changed", usage });
	}

	private emitThinkingState(): void {
		this.state = {
			...this.state,
			availableThinkingLevels: this.session.getAvailableThinkingLevels(),
		};
		this.emit({ type: "thinking_level_changed", level: this.session.thinkingLevel });
	}

	private emit(event: SessionEvent): void {
		this.state = applySessionEvent(this.state, event);
		const envelope: SessionEventEnvelope = { sessionId: this.state.sessionId, seq: ++this.seq, event };
		this.buffer.push(envelope);
		if (this.buffer.length > REPLAY_BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - REPLAY_BUFFER_SIZE);
		for (const listener of this.listeners) {
			try {
				listener(envelope);
			} catch (error) {
				log.error("session listener failed", error);
			}
		}
	}

	private nextItemId(): string {
		return `live-${++this.liveItemCounter}`;
	}

	private async checkToolCall(check: ToolCallCheck): Promise<ToolCallDecision> {
		// Preview file changes first, in every mode: the tool card shows them while the tool runs.
		const diff = await previewDiff(check.toolName, check.input, this.state.cwd).catch(() => undefined);
		if (diff) this.emit({ type: "tool_diff", toolCallId: check.toolCallId, diff });
		if (this.state.permissionMode === "auto") return { allow: true };
		if (READ_ONLY_TOOLS.has(check.toolName) || this.sessionAllowedTools.has(check.toolName)) return { allow: true };
		const response = await this.broker.request(
			{ kind: "tool_approval", toolCallId: check.toolCallId, toolName: check.toolName, args: check.input, diff },
			{ signal: check.signal, fallback: { decision: "deny", reason: "Cancelled" } },
		);
		const decision = "decision" in response ? response.decision : "deny";
		if (decision === "allow_session") this.sessionAllowedTools.add(check.toolName);
		if (decision === "allow" || decision === "allow_session") return { allow: true };
		const reason = "decision" in response && response.reason ? `Denied by user: ${response.reason}` : "Denied by user";
		this.emit({ type: "tool_blocked", toolCallId: check.toolCallId, reason });
		return { allow: false, reason };
	}

	private handlePiEvent(event: AgentSessionEvent): void {
		try {
			this.translate(event);
		} catch (error) {
			log.error(`failed to translate pi event ${event.type}`, error);
		}
	}

	private translate(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				if (this.state.status !== "running") this.emit({ type: "run_started" });
				return;
			case "agent_settled":
				this.currentAssistantItemId = undefined;
				this.emit({ type: "run_settled", aborted: event.aborted });
				this.emitContextUsage();
				return;
			case "message_start": {
				const message = event.message as { role: string };
				if (message.role === "toolResult") return;
				const id = this.nextItemId();
				const item = messageToItem(message, id, message.role === "assistant");
				if (!item) return;
				if (message.role === "assistant") this.currentAssistantItemId = id;
				this.emit({ type: "item_added", item });
				return;
			}
			case "message_update": {
				const itemId = this.currentAssistantItemId;
				if (!itemId) return;
				const update = event.assistantMessageEvent;
				switch (update.type) {
					case "text_delta":
						this.emit({
							type: "assistant_delta",
							itemId,
							contentIndex: update.contentIndex,
							blockType: "text",
							delta: update.delta,
						});
						return;
					case "thinking_delta":
						this.emit({
							type: "assistant_delta",
							itemId,
							contentIndex: update.contentIndex,
							blockType: "thinking",
							delta: update.delta,
						});
						return;
					case "toolcall_start": {
						const block = update.partial.content[update.contentIndex];
						if (block?.type !== "toolCall") return;
						this.emit({
							type: "assistant_delta",
							itemId,
							contentIndex: update.contentIndex,
							blockType: "toolCall",
							delta: "",
							toolCall: { toolCallId: block.id, name: block.name },
						});
						return;
					}
					case "toolcall_delta":
						this.emit({
							type: "assistant_delta",
							itemId,
							contentIndex: update.contentIndex,
							blockType: "toolCall",
							delta: update.delta,
						});
						return;
					default:
						return;
				}
			}
			case "message_end": {
				const message = event.message as { role: string };
				if (message.role === "toolResult") return;
				const id = message.role === "assistant" ? this.currentAssistantItemId : this.lastItemIdOfRole(message.role);
				if (!id) return;
				const item = messageToItem(message, id, false);
				if (item) this.emit({ type: "item_replaced", item });
				if (message.role === "assistant") {
					this.currentAssistantItemId = undefined;
					this.emitContextUsage();
				}
				return;
			}
			case "tool_execution_start":
				if (event.parentToolCallId) return;
				this.emit({ type: "tool_started", toolCallId: event.toolCallId, name: event.toolName, args: event.args });
				return;
			case "tool_execution_update": {
				if (event.parentToolCallId) return;
				const { output } = toolResultOutput(event.partialResult);
				this.emit({ type: "tool_updated", toolCallId: event.toolCallId, output });
				return;
			}
			case "tool_execution_end": {
				if (event.parentToolCallId) return;
				const { output, imageCount } = toolResultOutput(event.result);
				this.emit({
					type: "tool_ended",
					toolCallId: event.toolCallId,
					isError: event.isError,
					output,
					imageCount,
					durationMs: event.durationMs,
					diff: resultDiff(event.result),
				});
				return;
			}
			case "queue_update":
				this.emit({ type: "queue_updated", steering: [...event.steering], followUp: [...event.followUp] });
				return;
			case "compaction_start":
				this.emit({ type: "compaction_started" });
				return;
			case "compaction_end":
				this.emit({ type: "compaction_ended", errorMessage: event.errorMessage });
				if (event.errorMessage && !event.aborted) {
					this.emit({ type: "notification", level: "error", message: event.errorMessage });
				}
				this.emitContextUsage();
				return;
			case "entry_appended": {
				const entry = event.entry;
				if (entry.type === "compaction" || entry.type === "branch_summary") {
					const { items } = projectHistory([entry]);
					for (const item of items) this.emit({ type: "item_added", item });
				}
				return;
			}
			case "auto_retry_start":
				this.emit({
					type: "retry_started",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					errorMessage: event.errorMessage,
				});
				return;
			case "auto_retry_end":
				this.emit({ type: "retry_ended" });
				return;
			case "session_info_changed":
				this.emit({ type: "name_changed", name: event.name });
				return;
			case "thinking_level_changed":
				this.emit({ type: "thinking_level_changed", level: event.level });
				return;
			default:
				return;
		}
	}

	private lastItemIdOfRole(role: string): string | undefined {
		const kind = role === "user" ? "user" : role === "assistant" ? "assistant" : "notice";
		for (let i = this.state.items.length - 1; i >= 0; i--) {
			const item = this.state.items[i]!;
			if (item.kind === kind && item.id.startsWith("live-")) return item.id;
		}
		return undefined;
	}
}

/** "npm:@scope/pkg" -> "@scope/pkg", "auto" -> "local". */
function originLabel(source: string): string {
	if (source === "auto") return "local";
	return source.replace(/^npm:/, "").replace(/^extension:/, "");
}

export type { Interaction };
