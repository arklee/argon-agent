/**
 * Registry of loaded sessions plus backend-wide pi services (shared ModelRuntime).
 */

import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	ArgonSettings,
	GlobalEvent,
	MethodParams,
	MethodResult,
	ModelInfo,
	ModelRef,
	PiSettings,
	ProjectPiSettings,
	ProjectPrefs,
	SessionSummary,
} from "@argon/shared";
import {
	type DefaultProjectTrust,
	getAgentDir,
	ModelRuntime,
	ProjectTrustStore,
	resolveModelScopeWithDiagnostics,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AuthFlows } from "./auth-flows.ts";
import { log } from "./log.ts";
import { MagpieHost } from "./magpie-host.ts";
import { type ExtensionSessionHost, ManagedSession, type SessionTarget } from "./managed-session.ts";
import { McpConfigStore } from "./mcp-config.ts";
import { ModelsConfigStore } from "./models-config.ts";
import {
	canonicalProjectPath,
	projectTrustParent,
	resolveProjectTrust,
	resolveProjectTrustWithExtensions,
} from "./project-trust.ts";
import { SessionIndex } from "./session-index.ts";
import { SessionPrefs } from "./session-prefs.ts";
import {
	type ArgonSettingsStore,
	readPiSettings,
	readProjectSettings,
	writePiSettings,
	writeProjectSettings,
} from "./settings.ts";
import { listSessionFiles, UploadsGc } from "./uploads-gc.ts";

/** pi's session directory (bootstrap.ts points PI_CODING_AGENT_SESSION_DIR at Argon's). */
function sessionsDir(): string {
	return process.env.PI_CODING_AGENT_SESSION_DIR || join(getAgentDir(), "sessions");
}

function isInside(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export interface RegistryOptions {
	agentDir: string;
	/** Argon's own state directory (project preferences live here). */
	argonHome: string;
	settings: ArgonSettingsStore;
}

export class SessionRegistry {
	private readonly sessions = new Map<string, ManagedSession>();
	private readonly unloading = new Set<ManagedSession>();
	/** In-flight opens keyed by session path, so concurrent opens share one load. */
	private readonly opening = new Map<string, Promise<ManagedSession>>();
	private readonly globalListeners = new Set<(event: GlobalEvent) => void>();
	private readonly projectTrustStore: ProjectTrustStore;
	private readonly sessionTrustDecisions = new Map<string, boolean>();
	private readonly uploadsGc: UploadsGc;
	private readonly sessionIndex = new SessionIndex(sessionsDir());
	private readonly prefs: SessionPrefs;
	private trustRevision = 0;

	readonly magpie: MagpieHost;
	readonly mcpConfig: McpConfigStore;
	readonly modelsConfig: ModelsConfigStore;
	readonly auth: AuthFlows;

	private constructor(
		private readonly options: RegistryOptions,
		readonly modelRuntime: ModelRuntime,
	) {
		this.projectTrustStore = new ProjectTrustStore(options.agentDir);
		this.prefs = new SessionPrefs(options.argonHome);
		const sessions = this.sessions;
		const unloading = this.unloading;
		this.uploadsGc = new UploadsGc({
			uploadsRoot: join(options.argonHome, "uploads"),
			listSessionFiles: async () => {
				const listed = await this.sessionIndex.list();
				const files = await listSessionFiles(sessionsDir());
				// Sessions pi's listing does not cover: projects with their own `sessionDir`, and session
				// files opened from elsewhere (e.g. by an extension's switchSession).
				for (const dir of await this.projectSessionDirs(listed.map((info) => info.cwd))) {
					files.push(...(await listSessionFiles(dir)));
				}
				await this.prefs.pruneExternalSessions();
				return [...files, ...listed.map((info) => info.path), ...this.prefs.externalSessions()];
			},
			*memoryReferences() {
				for (const session of sessions.values()) yield session.uploadReferenceText();
				for (const session of unloading) yield session.uploadReferenceText();
			},
		});
		this.uploadsGc.start();
		// Before any session loads: a magpie-pi extension from the user's pi packages must stay
		// inactive in this process (magpie runs once, backend-wide; see magpie-host.ts).
		process.env.MAGPIE_PI_EMBEDDED = "1";
		this.magpie = new MagpieHost(
			modelRuntime,
			options.argonHome,
			(status) => this.broadcast({ type: "plugins_status", status }),
			() => this.broadcast({ type: "providers_changed" }),
		);
		this.mcpConfig = new McpConfigStore(
			options.agentDir,
			(cwd) => this.isProjectTrusted(cwd),
			async (target, reload) => {
				this.broadcast({ type: "mcp_config_changed" });
				if (!reload) return;
				const path = target.scope === "project" ? canonicalProjectPath(target.cwd) : undefined;
				await Promise.all(
					[...this.sessions.values()]
						.filter((s) => !path || canonicalProjectPath(s.snapshot().state.cwd) === path)
						.map((s) => s.refreshProjectTrust(true)),
				);
			},
		);
		this.modelsConfig = new ModelsConfigStore(join(options.agentDir, "models.json"), modelRuntime, () =>
			this.broadcast({ type: "providers_changed" }),
		);
		this.auth = new AuthFlows(
			modelRuntime,
			(flow) => this.broadcast({ type: "auth_flow", flow }),
			() => this.broadcast({ type: "providers_changed" }),
			(providerId) => this.magpie.isPluginProvider(providerId),
			this.modelsConfig,
		);
		// Plugin hosts can take a few seconds; sessions do not wait for them.
		void this.magpie.start().catch((error) => log.warn(String(error)));
	}

	readSettings(cwd: string | undefined): MethodResult<"settings.get"> {
		return {
			...readPiSettings(this.options.agentDir, cwd),
			argon: this.options.settings.get(),
			...(cwd
				? {
						argonProject: this.options.settings.getProject(cwd),
						project: readProjectSettings(cwd, this.isProjectTrusted(cwd)),
					}
				: {}),
		};
	}

	async updateSettings(update: { pi?: Partial<PiSettings>; argon?: Partial<ArgonSettings> }): Promise<void> {
		if (update.pi) await writePiSettings(this.options.agentDir, update.pi);
		if (update.argon) await this.options.settings.update(update.argon);
		if (update.argon?.gptApplyPatch !== undefined)
			for (const session of this.sessions.values()) session.refreshToolSet();
	}

	async updateArgonProject({ cwd, set, unset }: MethodParams<"settings.updateArgonProject">) {
		const before = this.options.settings.getProject(cwd).mcpServers;
		await this.options.settings.updateProject(cwd, set, unset);
		if (JSON.stringify(before) !== JSON.stringify(this.options.settings.getProject(cwd).mcpServers))
			this.broadcast({ type: "mcp_config_changed" });
	}
	updateProjectSettings(cwd: string, set?: Partial<ProjectPiSettings>, unset?: (keyof ProjectPiSettings)[]): void {
		writeProjectSettings(cwd, set, unset);
	}

	/** Whether pi would load `cwd`'s project settings now (saved or session decision, else the default). */
	private isProjectTrusted(cwd: string): boolean {
		const defaultTrust = SettingsManager.create(cwd, this.options.agentDir, { projectTrusted: false });
		return this.resolveTrust(cwd, defaultTrust.getDefaultProjectTrust()).trusted;
	}

	private resolveTrust(cwd: string, defaultTrust: DefaultProjectTrust) {
		return resolveProjectTrust(cwd, this.projectTrustStore, this.sessionTrustDecisions, defaultTrust);
	}

	/** `sessionDir` settings of known projects (pi lists only its default session directory). */
	private async projectSessionDirs(sessionCwds: string[]): Promise<string[]> {
		const cwds = new Set([...(await this.listProjects()).map((p) => p.cwd), ...sessionCwds]);
		const dirs = new Set<string>();
		for (const cwd of cwds) {
			if (!existsSync(cwd)) continue;
			const projectTrusted = this.isProjectTrusted(cwd);
			let settings: SettingsManager;
			try {
				settings = SettingsManager.create(cwd, this.options.agentDir, { projectTrusted });
			} catch {
				// Unreadable settings: nothing extra to scan for this project.
				continue;
			}
			const dir = settings.getSessionDir();
			if (dir) dirs.add(resolve(cwd, dir));
		}
		const defaultDir = resolve(sessionsDir());
		return [...dirs].filter((dir) => !isInside(defaultDir, dir));
	}

	/** Restart magpie after plugin changes; providers appear/disappear for all sessions. */
	async changePlugin(action: "install" | "remove", spec: string): Promise<string> {
		return this.magpie.change(action, spec);
	}

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

	async create(
		cwd: string,
		options: Omit<Extract<SessionTarget, { kind: "new" }>, "kind" | "cwd"> = {},
	): Promise<ManagedSession> {
		return this.load({ kind: "new", cwd, ...options });
	}

	async open(sessionPath: string): Promise<ManagedSession> {
		for (const session of this.sessions.values()) {
			if (session.sessionPath === sessionPath) return session;
		}
		// pi would silently start a new session at a missing path (with the backend's cwd).
		if (!existsSync(sessionPath)) throw new NotFoundError(`Session file not found: ${sessionPath}`);
		const inFlight = this.opening.get(sessionPath);
		if (inFlight) return inFlight;
		const loading = this.load({ kind: "open", sessionPath }).finally(() => this.opening.delete(sessionPath));
		this.opening.set(sessionPath, loading);
		return loading;
	}

	private async requireKnownSession(sessionPath: string) {
		const known =
			[...this.sessions.values()].some((s) => s.sessionPath === sessionPath) ||
			(await this.sessionIndex.list()).some((info) => info.path === sessionPath);
		if (!known) throw new NotFoundError(`Not a known session: ${sessionPath}`);
	}
	async setPinned(sessionPath: string, pinned: boolean) {
		await this.requireKnownSession(sessionPath);
		await this.prefs.setPinned(sessionPath, pinned);
		this.broadcast({ type: "sessions_changed" });
	}
	async setArchived(sessionPath: string, archived: boolean) {
		await this.requireKnownSession(sessionPath);
		await this.prefs.setArchived(sessionPath, archived);
		this.broadcast({ type: "sessions_changed" });
	}

	async unload(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		this.sessions.delete(sessionId);
		this.unloading.add(session);
		try {
			await session.dispose();
		} finally {
			this.unloading.delete(session);
			this.uploadsGc.sessionUnloaded();
		}
		this.broadcast({ type: "session_unloaded", sessionId });
	}

	/** Delete a session file. Only files pi lists as sessions are accepted, so clients cannot delete anything else. */
	async delete(sessionPath: string): Promise<void> {
		// A new session has no file until its first reply: deleting it only unloads it.
		const unsaved = [...this.sessions.values()].find((s) => s.sessionPath === sessionPath && !existsSync(sessionPath));
		if (unsaved) {
			await this.unload(unsaved.sessionId);
			this.broadcast({ type: "sessions_changed" });
			return;
		}
		const known = (await this.sessionIndex.list()).some((info) => info.path === sessionPath);
		if (!known) throw new NotFoundError(`Not a known session: ${sessionPath}`);
		for (const session of [...this.sessions.values()]) {
			if (session.sessionPath === sessionPath) {
				if (session.isRunning) await session.abort();
				await this.unload(session.sessionId);
			}
		}
		const uploadKeys = await this.uploadsGc.readDeletedSession(sessionPath);
		await unlink(sessionPath);
		this.sessionIndex.invalidate();
		await this.prefs.forget(sessionPath);
		void this.uploadsGc.cleanDeletedSession(uploadKeys);
		this.broadcast({ type: "sessions_changed" });
	}

	/** New session with the history before a user message; returns its path and the message text. */
	async fork(sessionId: string, itemId: string): Promise<{ sessionPath: string; text: string }> {
		const source = this.require(sessionId);
		const { leafId, text } = source.forkPoint(itemId);
		const path = source.branchToNewFile(leafId);
		const target = path ? await this.open(path) : await this.emptyCopyOf(source);
		return { sessionPath: target.sessionPath ?? "", text };
	}

	/** New session with a copy of the current branch. */
	async clone(sessionId: string): Promise<{ sessionPath: string }> {
		const source = this.require(sessionId);
		const path = source.branchToNewFile(source.leafId);
		const target = path ? await this.open(path) : await this.emptyCopyOf(source);
		return { sessionPath: target.sessionPath ?? "" };
	}

	/** A fork/clone with no history: a new session in the same project, keeping the source's model. */
	private async emptyCopyOf(source: ManagedSession): Promise<ManagedSession> {
		const { cwd, model } = source.snapshot().state;
		const target = await this.create(cwd, { parentSession: source.sessionPath });
		if (model) await target.setModel(model, this.modelRuntime).catch(() => undefined);
		return target;
	}

	// -------------------------------------------------------------------------
	// Project preferences ($ARGON_HOME/projects.json, per backend environment)
	// -------------------------------------------------------------------------

	private get projectsPath(): string {
		return join(this.options.argonHome, "projects.json");
	}

	async listProjects(): Promise<ProjectPrefs[]> {
		try {
			const data = JSON.parse(await readFile(this.projectsPath, "utf8")) as { projects?: ProjectPrefs[] };
			return Array.isArray(data.projects) ? data.projects : [];
		} catch {
			return [];
		}
	}

	async updateProject(update: ProjectPrefs): Promise<void> {
		const projects = (await this.listProjects()).filter((p) => p.cwd !== update.cwd);
		const previous = (await this.listProjects()).find((p) => p.cwd === update.cwd);
		const next: ProjectPrefs = { ...previous, ...update };
		if (next.pinned || next.hidden || next.addedAt) projects.push(next);
		await writeFile(this.projectsPath, `${JSON.stringify({ projects }, null, 2)}\n`, { mode: 0o600 });
		this.broadcast({ type: "projects_changed" });
	}

	async setProjectTrust({ cwd, decision }: MethodParams<"projects.setTrust">): Promise<void> {
		const path = canonicalProjectPath(cwd);
		let affectedPath = path;
		switch (decision) {
			case "trust_session":
			case "deny_session":
				this.sessionTrustDecisions.set(path, decision === "trust_session");
				break;
			case "trust_parent": {
				const parent = projectTrustParent(path);
				if (parent === undefined) throw new Error("The project folder has no parent");
				this.projectTrustStore.setMany([
					{ path: parent, decision: true },
					{ path, decision: null },
				]);
				this.sessionTrustDecisions.delete(path);
				affectedPath = parent;
				break;
			}
			case "trust":
			case "deny":
				this.projectTrustStore.set(path, decision === "trust");
				this.sessionTrustDecisions.delete(path);
				break;
		}
		this.trustRevision++;

		const updates = [...this.sessions.values()]
			.filter((session) => {
				const child = relative(affectedPath, canonicalProjectPath(session.snapshot().state.cwd));
				return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
			})
			.map((session) => session.refreshProjectTrust());
		const results = await Promise.allSettled(updates);
		this.broadcast({ type: "projects_changed" });
		for (const result of results) {
			if (result.status === "rejected") throw result.reason;
		}
	}

	async list(cwd?: string): Promise<SessionSummary[]> {
		const all = await this.sessionIndex.list();
		const infos = cwd ? all.filter((info) => info.cwd === cwd) : all;
		const byId = new Map<string, SessionSummary>();
		for (const info of infos) {
			const loaded = this.sessions.get(info.id);
			byId.set(info.id, {
				sessionId: info.id,
				sessionPath: info.path,
				cwd: info.cwd,
				name: loaded ? (loaded.snapshot().state.name ?? info.name) : info.name,
				// For loaded sessions, the current branch's first message (it changes when an edit branches).
				firstMessage: (loaded && firstUserText(loaded)) || info.firstMessage,
				messageCount: info.messageCount,
				createdAt: info.created.getTime(),
				modifiedAt: info.modified.getTime(),
				loaded: Boolean(loaded),
				running: loaded?.isRunning ?? false,
				pinnedAt: this.prefs.pinnedAt(info.path),
				...(this.prefs.isArchived(info.path) ? { archived: true } : {}),
			});
		}
		// New sessions have no file until their first reply; show them once something happened in them
		// (a blank, idle session is not a conversation yet and stays out of the list).
		for (const session of this.sessions.values()) {
			if (byId.has(session.sessionId)) continue;
			const state = session.snapshot().state;
			if (cwd && state.cwd !== cwd) continue;
			if (state.items.length === 0 && !session.isRunning) continue;
			byId.set(session.sessionId, {
				sessionId: session.sessionId,
				sessionPath: session.sessionPath ?? "",
				cwd: state.cwd,
				name: state.name,
				firstMessage: firstUserText(session) ?? "",
				messageCount: 0,
				createdAt: session.createdAt,
				modifiedAt: session.createdAt,
				loaded: true,
				running: session.isRunning,
				pinnedAt: session.sessionPath ? this.prefs.pinnedAt(session.sessionPath) : undefined,
				...(session.sessionPath && this.prefs.isArchived(session.sessionPath) ? { archived: true } : {}),
			});
		}
		return [...byId.values()].sort((a, b) => b.modifiedAt - a.modifiedAt);
	}

	async listModels(cwd?: string): Promise<MethodResult<"models.list">> {
		const available = await this.modelRuntime.getAvailable();
		const models: ModelInfo[] = available.map((model) => ({
			provider: model.provider,
			id: model.id,
			name: model.name ?? model.id,
			reasoning: Boolean(model.reasoning),
			contextWindow: model.contextWindow,
		}));
		if (!cwd) return { models };
		const settings = SettingsManager.create(cwd, this.options.agentDir, {
			projectTrusted: existsSync(cwd) && this.isProjectTrusted(cwd),
		});
		const patterns = settings.getEnabledModels();
		if (!patterns?.length) return { models };
		const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(patterns, this.modelRuntime);
		const usable = new Set(models.map((m) => `${m.provider}/${m.id}`));
		const seen = new Set<string>();
		const scoped: NonNullable<MethodResult<"models.list">["scoped"]> = [];
		for (const { model, thinkingLevel } of scopedModels) {
			const key = `${model.provider}/${model.id}`;
			if (!usable.has(key) || seen.has(key)) continue;
			seen.add(key);
			scoped.push({ provider: model.provider, id: model.id, ...(thinkingLevel ? { thinkingLevel } : {}) });
		}
		return { models, scoped, scopeWarnings: diagnostics.map((d) => d.message) };
	}

	async setModel(sessionId: string, model: ModelRef): Promise<void> {
		await this.require(sessionId).setModel(model, this.modelRuntime);
	}

	async dispose(): Promise<void> {
		await this.uploadsGc.dispose();
		await this.prefs.flush();
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((s) => s.dispose()));
		this.auth.dispose();
		await this.magpie.dispose().catch(() => undefined);
		await this.modelRuntime.settleCredentialWrites().catch(() => undefined);
	}

	private async load(target: SessionTarget): Promise<ManagedSession> {
		let revision = this.trustRevision;
		const session = await ManagedSession.load(target, {
			agentDir: this.options.agentDir,
			modelRuntime: this.modelRuntime,
			settings: this.options.settings,
			sessionHost: this.sessionHost,
			resolveProjectTrust: (cwd, defaultTrust, extensions, onError) =>
				resolveProjectTrustWithExtensions(
					cwd,
					this.projectTrustStore,
					this.sessionTrustDecisions,
					defaultTrust,
					extensions,
					onError,
				),
		});
		try {
			// A trust request can land while this session is loading and still absent from the registry.
			while (revision !== this.trustRevision) {
				revision = this.trustRevision;
				await session.refreshProjectTrust();
			}
		} catch (error) {
			await session.dispose();
			throw error;
		}
		this.register(session);
		return session;
	}

	private readonly sessionHost: ExtensionSessionHost = {
		createSession: (cwd, options) => this.create(cwd, options),
		openSession: (sessionPath) => this.open(sessionPath),
		announce: (from, to) => {
			if (to.sessionPath) {
				this.broadcast({ type: "session_requested", fromSessionId: from.sessionId, sessionPath: to.sessionPath });
			}
		},
		// An extension's ctx.shutdown(): the CLI exits; Argon only unloads that session (others keep running).
		shutdown: (session) => {
			if (this.sessions.get(session.sessionId) !== session) return false;
			log.info(`session ${session.sessionId} requested shutdown`);
			void this.unload(session.sessionId).catch((error) => log.error("shutdown unload failed", error));
			return true;
		},
	};

	private register(session: ManagedSession): void {
		this.sessions.set(session.sessionId, session);
		const path = session.sessionPath;
		if (path && !isInside(resolve(sessionsDir()), resolve(path))) void this.prefs.addExternalSession(resolve(path));
		// Run state changes affect the session list (running dot, names, message counts).
		session.subscribe((envelope) => {
			const type = envelope.event.type;
			if (type === "run_started" || type === "run_settled" || type === "name_changed") {
				this.broadcast({ type: "sessions_changed" });
			}
		});
		log.info(`session loaded ${session.sessionId} (${session.snapshot().state.cwd})`);
		this.broadcast({ type: "sessions_changed" });
		session.resumeAfterRegister();
	}

	private broadcast(event: GlobalEvent): void {
		for (const listener of this.globalListeners) listener(event);
	}
}

function firstUserText(session: ManagedSession): string | undefined {
	const first = session.snapshot().state.items.find((item) => item.kind === "user");
	return first?.kind === "user" ? first.text : undefined;
}

export class NotFoundError extends Error {
	override name = "NotFoundError";
}
