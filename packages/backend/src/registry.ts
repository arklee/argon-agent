/**
 * Registry of loaded sessions plus backend-wide pi services (shared ModelRuntime).
 */

import { join } from "node:path";
import type { GlobalEvent, ModelInfo, ModelRef, PermissionMode, SessionSummary } from "@argon/shared";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { log } from "./log.ts";
import { ManagedSession } from "./managed-session.ts";

export interface RegistryOptions {
	agentDir: string;
	defaultPermissionMode: PermissionMode;
}

export class SessionRegistry {
	private readonly sessions = new Map<string, ManagedSession>();
	/** In-flight opens keyed by session path, so concurrent opens share one load. */
	private readonly opening = new Map<string, Promise<ManagedSession>>();
	private readonly globalListeners = new Set<(event: GlobalEvent) => void>();

	private constructor(
		private readonly options: RegistryOptions,
		readonly modelRuntime: ModelRuntime,
	) {}

	static async create(options: RegistryOptions): Promise<SessionRegistry> {
		const modelRuntime = await ModelRuntime.create({
			authPath: join(options.agentDir, "auth.json"),
			modelsPath: join(options.agentDir, "models.json"),
		});
		return new SessionRegistry(options, modelRuntime);
	}

	onGlobalEvent(listener: (event: GlobalEvent) => void): () => void {
		this.globalListeners.add(listener);
		return () => this.globalListeners.delete(listener);
	}

	get(sessionId: string): ManagedSession | undefined {
		return this.sessions.get(sessionId);
	}

	require(sessionId: string): ManagedSession {
		const session = this.sessions.get(sessionId);
		if (!session) throw new NotFoundError(`Session not loaded: ${sessionId}`);
		return session;
	}

	async create(cwd: string): Promise<ManagedSession> {
		const session = await ManagedSession.load({ kind: "new", cwd }, this.deps());
		this.register(session);
		return session;
	}

	async open(sessionPath: string): Promise<ManagedSession> {
		for (const session of this.sessions.values()) {
			if (session.sessionPath === sessionPath) return session;
		}
		const inFlight = this.opening.get(sessionPath);
		if (inFlight) return inFlight;
		const loading = ManagedSession.load({ kind: "open", sessionPath }, this.deps())
			.then((session) => {
				this.register(session);
				return session;
			})
			.finally(() => this.opening.delete(sessionPath));
		this.opening.set(sessionPath, loading);
		return loading;
	}

	async unload(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		this.sessions.delete(sessionId);
		await session.dispose();
		this.broadcast({ type: "session_unloaded", sessionId });
	}

	async list(cwd?: string): Promise<SessionSummary[]> {
		const infos = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
		const byId = new Map<string, SessionSummary>();
		for (const info of infos) {
			const loaded = this.sessions.get(info.id);
			byId.set(info.id, {
				sessionId: info.id,
				sessionPath: info.path,
				cwd: info.cwd,
				name: loaded ? (loaded.snapshot().state.name ?? info.name) : info.name,
				firstMessage: info.firstMessage,
				messageCount: info.messageCount,
				createdAt: info.created.getTime(),
				modifiedAt: info.modified.getTime(),
				loaded: Boolean(loaded),
				running: loaded?.isRunning ?? false,
			});
		}
		// New sessions have no file until their first message; still show them.
		for (const session of this.sessions.values()) {
			if (byId.has(session.sessionId)) continue;
			const state = session.snapshot().state;
			if (cwd && state.cwd !== cwd) continue;
			byId.set(session.sessionId, {
				sessionId: session.sessionId,
				sessionPath: session.sessionPath ?? "",
				cwd: state.cwd,
				name: state.name,
				firstMessage: "",
				messageCount: 0,
				createdAt: Date.now(),
				modifiedAt: Date.now(),
				loaded: true,
				running: session.isRunning,
			});
		}
		return [...byId.values()].sort((a, b) => b.modifiedAt - a.modifiedAt);
	}

	async listModels(): Promise<ModelInfo[]> {
		const models = await this.modelRuntime.getAvailable();
		return models.map((model) => ({
			provider: model.provider,
			id: model.id,
			name: model.name ?? model.id,
			reasoning: Boolean(model.reasoning),
			contextWindow: model.contextWindow,
		}));
	}

	async setModel(sessionId: string, model: ModelRef): Promise<void> {
		await this.require(sessionId).setModel(model, this.modelRuntime);
	}

	async dispose(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((s) => s.dispose()));
		await this.modelRuntime.settleCredentialWrites().catch(() => undefined);
	}

	private deps() {
		return {
			agentDir: this.options.agentDir,
			modelRuntime: this.modelRuntime,
			defaultPermissionMode: this.options.defaultPermissionMode,
		};
	}

	private register(session: ManagedSession): void {
		this.sessions.set(session.sessionId, session);
		// Run state changes affect the session list (running dot, names, message counts).
		session.subscribe((envelope) => {
			const type = envelope.event.type;
			if (type === "run_started" || type === "run_settled" || type === "name_changed") {
				this.broadcast({ type: "sessions_changed" });
			}
		});
		log.info(`session loaded ${session.sessionId} (${session.snapshot().state.cwd})`);
		this.broadcast({ type: "sessions_changed" });
	}

	private broadcast(event: GlobalEvent): void {
		for (const listener of this.globalListeners) listener(event);
	}
}

export class NotFoundError extends Error {
	override name = "NotFoundError";
}
