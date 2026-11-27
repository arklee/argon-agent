import { t } from "@/i18n";
/**
 * App store. Holds UI-facing state only; session state comes from the shared SessionMirror,
 * which owns ordering, gap detection and resync. Nothing here does IO except through AgentClient.
 */

import {
	type AgentClient,
	type ConnectionState,
	type EnvironmentInfo,
	type ImageData,
	type InteractionResponse,
	type McpAction,
	type McpExposure,
	type ModelInfo,
	type ModelRef,
	type PermissionMode,
	type ProjectPrefs,
	type ProjectTrustDecision,
	SessionMirror,
	type SessionState,
	type SessionSummary,
	type ThinkingLevel,
	type ToolPresetId,
	type ToolPresetInfo,
	WebSocketAgentClient,
} from "@argon/shared";
import { toast } from "sonner";
import { create } from "zustand";
import { type ConnectionConfig, clearConnectionConfig } from "@/lib/connection";
import { groupByProject, visibleProjects } from "@/lib/session-order";
import { useSettings } from "@/stores/settings";

interface AppState {
	addProjectOpen: boolean;
	setAddProjectOpen(open: boolean): void;
	/** Add a project folder (backend path) and start a session in it. */
	addProject(cwd: string): Promise<void>;
	/** New session in `cwd`, else the current project; with no project yet, asks for one. */
	newSession(cwd?: string): Promise<void>;
	connection: ConnectionState | undefined;
	environment: EnvironmentInfo | undefined;
	sessions: SessionSummary[];
	sessionStates: Record<string, SessionState>;
	activeSessionId: string | undefined;
	projects: ProjectPrefs[];
	search: string;
	showHidden: boolean;
	showArchived: boolean;
	unloadedSessions: Record<string, true>;
	modelScopes: Record<string, { scoped: (ModelRef & { thinkingLevel?: ThinkingLevel })[]; warnings: string[] } | null>;
	refreshModelScope(cwd: string): Promise<void>;
	/** Archiving shows a toast with an undo action. */
	setArchived(summary: SessionSummary, archived: boolean): Promise<void>;
	setPinned(summary: SessionSummary, pinned: boolean): Promise<void>;
	clearDiagnostics(): Promise<void>;
	composerDrafts: Record<string, string>;
	refreshProjects(): Promise<void>;
	updateProject(prefs: ProjectPrefs): Promise<void>;
	duplicateSession(summary: SessionSummary): Promise<void>;
	deleteSession(summary: SessionSummary): Promise<void>;
	forkMessage(sessionId: string, itemId: string): Promise<void>;
	switchBranch(sessionId: string, itemId: string, direction: -1 | 1): Promise<void>;
	models: ModelInfo[];
	toolPresets: ToolPresetInfo[];
	openingSession: boolean;
	mcpPanelOpen: boolean;

	connect(config: ConnectionConfig): void;
	disconnect(): void;
	refreshSessions(): Promise<void>;
	refreshModels(): Promise<void>;
	refreshToolPresets(): Promise<void>;
	openSession(summary: SessionSummary): Promise<void>;
	createSession(cwd: string): Promise<void>;
	clearActiveSession(): void;
	setMcpPanelOpen(open: boolean): void;
	compact(customInstructions?: string): Promise<void>;
	/** Clears the queue and returns the removed messages, oldest first. */
	clearQueue(): Promise<string[]>;
	editMessage(itemId: string, text: string): Promise<void>;
	renameSession(name: string, summary?: SessionSummary): Promise<void>;
	sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", images?: ImageData[]): Promise<void>;
	abort(): Promise<void>;
	respond(interactionId: string, response: InteractionResponse): Promise<void>;
	setModel(model: ModelRef): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	setPermissionMode(mode: PermissionMode): Promise<void>;
	setToolPreset(preset: ToolPresetId): Promise<void>;
	mcpAction(server: string, action: McpAction | "exposure", exposure?: McpExposure): Promise<void>;
	setProjectTrust(cwd: string, decision: ProjectTrustDecision): Promise<void>;
}

let client: AgentClient | undefined;
let mirror: SessionMirror | undefined;
let disposers: Array<() => void> = [];

export function getClient(): AgentClient {
	if (!client) throw new Error(t("notifications.notConnected"));
	return client;
}

const LAST_SESSION_KEY = (envId: string) => `argon.lastSession.${envId}`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function activeLoadedSessionId(rethrow = false): Promise<string | undefined> {
	const id = useApp.getState().activeSessionId;
	const m = mirror;
	if (!id || !m) return undefined;
	if (!m.isUnloaded(id)) return id;
	try {
		const state = await m.reopen(id);
		if (m !== mirror || useApp.getState().activeSessionId !== id) return undefined;
		return state.sessionId;
	} catch (error) {
		if (rethrow) throw error;
		toast.error(t("notifications.openSession", { error: errorMessage(error) }));
		return undefined;
	}
}

function refreshActiveModelScope(): void {
	const state = useApp.getState();
	const cwd = state.activeSessionId ? state.sessionStates[state.activeSessionId]?.cwd : undefined;
	if (cwd) void state.refreshModelScope(cwd);
}

async function loadedId(summary: SessionSummary) {
	if (summary.loaded || !summary.sessionPath) return summary.sessionId;
	if (!mirror) throw new Error(t("notifications.notConnected"));
	return (await mirror.open(summary.sessionPath)).sessionId;
}

async function activatePath(path: string, draft?: string, fromSessionId?: string) {
	const m = mirror;
	if (!m) throw new Error(t("notifications.notConnected"));
	const state = await m.open(path);
	if (m !== mirror || (fromSessionId && useApp.getState().activeSessionId !== fromSessionId)) return;
	useApp.setState((s) => ({
		activeSessionId: state.sessionId,
		composerDrafts: draft === undefined ? s.composerDrafts : { ...s.composerDrafts, [state.sessionId]: draft },
	}));
	const env = useApp.getState().environment;
	if (env) localStorage.setItem(LAST_SESSION_KEY(env.id), path);
	if (fromSessionId) toast(t("notifications.switchedSession"));
}

export const useApp = create<AppState>((set, get) => ({
	addProjectOpen: false,
	setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
	async addProject(cwd) {
		await getClient().request("projects.update", { cwd, addedAt: Date.now(), hidden: false });
		await get().refreshProjects();
		await get().createSession(cwd);
	},
	async newSession(cwd) {
		const s = get();
		if (s.openingSession) return;
		const target = cwd ?? currentProject();
		const active = s.activeSessionId ? s.sessionStates[s.activeSessionId] : undefined;
		// Already on an empty session there: reuse it instead of piling up blank ones.
		if (target && active?.cwd === target && active.items.length === 0 && active.status === "idle") {
			document.querySelector<HTMLTextAreaElement>("#argon-composer")?.focus();
			return;
		}
		// A blank session left there earlier is not listed in the sidebar; go back to it rather than make another.
		const blank = Object.values(s.sessionStates).find(
			(state) =>
				state.cwd === target &&
				state.items.length === 0 &&
				state.status === "idle" &&
				!mirror?.isUnloaded(state.sessionId),
		);
		if (target && blank && mirror) {
			const state = await mirror.attach(blank.sessionId).catch(() => undefined);
			if (state) {
				set({ activeSessionId: state.sessionId });
				return;
			}
		}
		if (target) await s.createSession(target).catch(() => undefined);
		else s.setAddProjectOpen(true);
	},
	connection: undefined,
	environment: undefined,
	sessions: [],
	projects: [],
	search: "",
	showHidden: false,
	showArchived: false,
	unloadedSessions: {},
	modelScopes: {},
	composerDrafts: {},
	sessionStates: {},
	activeSessionId: undefined,
	models: [],
	toolPresets: [],
	openingSession: false,
	mcpPanelOpen: false,

	connect(config) {
		get().disconnect();
		client = new WebSocketAgentClient({ url: config.url, token: config.token, clientName: "argon-web" });
		mirror = new SessionMirror(client);
		const c = client;
		const m = mirror;

		disposers.push(
			m.subscribe((sessionId, state) => {
				set((s) => {
					const next = { ...s.sessionStates };
					const unloadedSessions = { ...s.unloadedSessions };
					if (m.isUnloaded(sessionId)) unloadedSessions[sessionId] = true;
					else delete unloadedSessions[sessionId];
					if (state) next[sessionId] = state;
					else delete next[sessionId];
					const activeGone = !state && s.activeSessionId === sessionId;
					return { unloadedSessions, sessionStates: next, activeSessionId: activeGone ? undefined : s.activeSessionId };
				});
			}),
			m.onNotification((_sessionId, event) => {
				const show = event.level === "error" ? toast.error : event.level === "warning" ? toast.warning : toast;
				show(event.message);
			}),
			c.onGlobalEvent((event) => {
				useSettings.getState().onGlobalEvent(event);
				if (event.type === "providers_changed") {
					void get().refreshModels();
					refreshActiveModelScope();
				}
				if (event.type === "projects_changed") void get().refreshProjects();
				if (event.type === "session_requested" && get().activeSessionId === event.fromSessionId)
					void activatePath(event.sessionPath, undefined, event.fromSessionId).catch((e) =>
						toast.error(errorMessage(e)),
					);
				if (event.type === "sessions_changed" || event.type === "session_unloaded") void get().refreshSessions();
			}),
			c.onConnectionChange((connection) => {
				set({ connection });
				if (connection.status === "connected") {
					set({ environment: connection.environment });
					void get().refreshSessions();
					void get().refreshModels();
					refreshActiveModelScope();
					void get().refreshToolPresets();
					void get().refreshProjects();
					void restoreLastSession(connection.environment.id);
				}
				if (connection.status === "failed" && connection.error.code === "unauthorized") {
					clearConnectionConfig();
				}
			}),
		);
		set({ connection: c.connection });

		const restoreLastSession = async (envId: string) => {
			if (get().activeSessionId) return;
			const sessionPath = localStorage.getItem(LAST_SESSION_KEY(envId));
			if (!sessionPath) return;
			try {
				const state = await m.open(sessionPath);
				set({ activeSessionId: state.sessionId });
			} catch {
				localStorage.removeItem(LAST_SESSION_KEY(envId));
			}
		};
	},

	disconnect() {
		for (const dispose of disposers) dispose();
		disposers = [];
		mirror?.dispose();
		client?.close();
		useSettings.getState().reset();
		client = undefined;
		mirror = undefined;
		set({
			connection: undefined,
			environment: undefined,
			addProjectOpen: false,
			sessionStates: {},
			activeSessionId: undefined,
			sessions: [],
			projects: [],
			search: "",
			showHidden: false,
			showArchived: false,
			unloadedSessions: {},
			modelScopes: {},
			composerDrafts: {},
		});
	},

	async refreshSessions() {
		if (!client) return;
		try {
			const c = client;
			const { sessions } = await c.request("sessions.list", {});
			if (client !== c) return;
			set({ sessions });
			const { activeSessionId, sessionStates, environment } = get();
			const path = activeSessionId ? sessionStates[activeSessionId]?.sessionPath : undefined;
			if (
				activeSessionId &&
				mirror?.isUnloaded(activeSessionId) &&
				path &&
				!sessions.some((session) => session.sessionPath === path)
			) {
				get().clearActiveSession();
				if (environment && localStorage.getItem(LAST_SESSION_KEY(environment.id)) === path)
					localStorage.removeItem(LAST_SESSION_KEY(environment.id));
			}
		} catch (error) {
			console.warn("sessions.list failed", error);
		}
	},

	async refreshToolPresets() {
		if (!client) return;
		try {
			const { presets } = await client.request("toolPresets.list", {});
			set({ toolPresets: presets });
		} catch (error) {
			// An older backend has no presets; the picker stays hidden.
			console.warn("toolPresets.list failed", error);
		}
	},

	async refreshModelScope(cwd) {
		const c = client;
		if (!c) return;
		try {
			const { scoped, scopeWarnings } = await c.request("models.list", { cwd });
			if (client === c)
				set((s) => ({
					modelScopes: {
						...s.modelScopes,
						[cwd]: scoped === undefined ? null : { scoped, warnings: scopeWarnings ?? [] },
					},
				}));
		} catch (error) {
			toast.error(t("notifications.loadModels", { error: errorMessage(error) }));
		}
	},
	async setArchived(summary, archived) {
		try {
			await getClient().request("sessions.setArchived", { sessionPath: summary.sessionPath, archived });
			await get().refreshSessions();
		} catch (error) {
			toast.error(errorMessage(error));
			return;
		}
		if (archived)
			toast(t("sessionMenu.archivedToast"), {
				action: { label: t("common.undo"), onClick: () => void get().setArchived(summary, false) },
			});
	},
	async setPinned(summary, pinned) {
		try {
			await getClient().request("sessions.setPinned", { sessionPath: summary.sessionPath, pinned });
			await get().refreshSessions();
		} catch (error) {
			toast.error(errorMessage(error));
		}
	},
	async clearDiagnostics() {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client.request("sessions.clearDiagnostics", { sessionId }).catch((error) => toast.error(errorMessage(error)));
	},

	async refreshModels() {
		if (!client) return;
		try {
			const { models } = await client.request("models.list", {});
			set({ models });
		} catch (error) {
			toast.error(t("notifications.loadModels", { error: errorMessage(error) }));
		}
	},

	async openSession(summary) {
		if (!mirror) return;
		set({ openingSession: true });
		try {
			const state =
				mirror.isUnloaded(summary.sessionId) || summary.loaded || !summary.sessionPath
					? await mirror.attach(summary.sessionId)
					: await mirror.open(summary.sessionPath);
			set({ activeSessionId: state.sessionId });
			const envId = get().environment?.id;
			if (envId && state.sessionPath) localStorage.setItem(LAST_SESSION_KEY(envId), state.sessionPath);
		} catch (error) {
			toast.error(t("notifications.openSession", { error: errorMessage(error) }));
		} finally {
			set({ openingSession: false });
		}
	},

	async createSession(cwd) {
		if (!mirror) return;
		set({ openingSession: true });
		try {
			const state = await mirror.create(cwd);
			set({ activeSessionId: state.sessionId });
			const envId = get().environment?.id;
			if (envId && state.sessionPath) localStorage.setItem(LAST_SESSION_KEY(envId), state.sessionPath);
			void get().refreshSessions();
		} catch (error) {
			toast.error(t("notifications.createSession", { error: errorMessage(error) }));
			throw error;
		} finally {
			set({ openingSession: false });
		}
	},

	clearActiveSession() {
		set({ activeSessionId: undefined });
	},

	setMcpPanelOpen(open) {
		set({ mcpPanelOpen: open });
	},

	async compact(customInstructions) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client
			.request("sessions.compact", { sessionId, customInstructions })
			.catch((e) => toast.error(errorMessage(e)));
	},

	async clearQueue() {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return [];
		try {
			const { steering, followUp } = await client.request("sessions.clearQueue", { sessionId });
			return [...steering, ...followUp];
		} catch (error) {
			toast.error(errorMessage(error));
			return [];
		}
	},

	async editMessage(itemId, text) {
		try {
			const sessionId = await activeLoadedSessionId(true);
			if (client?.connection.status !== "connected" || !sessionId) throw new Error(t("notifications.connectToSend"));
			const clientMessageId = crypto.randomUUID();
			await client.request("sessions.editMessage", { sessionId, itemId, text, clientMessageId });
		} catch (error) {
			toast.error(errorMessage(error));
			throw error;
		}
	},

	async refreshProjects() {
		const c = client;
		if (!c) return;
		try {
			const { projects } = await c.request("projects.list", {});
			if (client === c) set({ projects });
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async updateProject(prefs) {
		await getClient()
			.request("projects.update", prefs)
			.catch((e) => toast.error(errorMessage(e)));
	},
	async renameSession(name, summary) {
		try {
			const sessionId = summary ? await loadedId(summary) : await activeLoadedSessionId();
			if (sessionId) await getClient().request("sessions.rename", { sessionId, name });
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async duplicateSession(summary) {
		try {
			const { sessionPath } = await getClient().request("sessions.clone", { sessionId: await loadedId(summary) });
			await activatePath(sessionPath);
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async deleteSession(summary) {
		const env = get().environment;
		try {
			await getClient().request("sessions.delete", { sessionPath: summary.sessionPath });
			if (get().activeSessionId === summary.sessionId) get().clearActiveSession();
			if (env && localStorage.getItem(LAST_SESSION_KEY(env.id)) === summary.sessionPath)
				localStorage.removeItem(LAST_SESSION_KEY(env.id));
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async forkMessage(sessionId, itemId) {
		try {
			if (sessionId === get().activeSessionId) {
				const loaded = await activeLoadedSessionId();
				if (!loaded) return;
				sessionId = loaded;
			}
			const { sessionPath, text } = await getClient().request("sessions.fork", { sessionId, itemId });
			await activatePath(sessionPath, text);
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async switchBranch(sessionId, itemId, direction) {
		if (sessionId === get().activeSessionId) {
			const loaded = await activeLoadedSessionId();
			if (!loaded) return;
			sessionId = loaded;
		}
		await getClient()
			.request("sessions.switchBranch", { sessionId, itemId, direction })
			.catch((e) => toast.error(errorMessage(e)));
	},
	async sendPrompt(text, streamingBehavior, images) {
		try {
			const sessionId = await activeLoadedSessionId(true);
			if (client?.connection.status !== "connected" || !sessionId) throw new Error(t("notifications.connectToSend"));
			const clientMessageId = crypto.randomUUID();
			await client.request("sessions.prompt", {
				sessionId,
				clientMessageId,
				text,
				streamingBehavior,
				images: images?.length ? images : undefined,
			});
		} catch (error) {
			toast.error(errorMessage(error));
			throw error;
		}
	},

	async abort() {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId || mirror?.isUnloaded(sessionId)) return;
		await client.request("sessions.abort", { sessionId }).catch((e) => toast.error(errorMessage(e)));
	},

	async respond(interactionId, response) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId || mirror?.isUnloaded(sessionId)) return;
		try {
			const { accepted } = await client.request("interactions.respond", { sessionId, interactionId, response });
			if (!accepted) toast.warning(t("notifications.answered"));
		} catch (error) {
			toast.error(errorMessage(error));
		}
	},

	async setModel(model) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client.request("sessions.setModel", { sessionId, model }).catch((e) => toast.error(errorMessage(e)));
	},

	async setThinkingLevel(level) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client.request("sessions.setThinkingLevel", { sessionId, level }).catch((e) => toast.error(errorMessage(e)));
	},

	async setToolPreset(preset) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client.request("sessions.setToolPreset", { sessionId, preset }).catch((e) => toast.error(errorMessage(e)));
	},

	async setPermissionMode(mode) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		await client.request("sessions.setPermissionMode", { sessionId, mode }).catch((e) => toast.error(errorMessage(e)));
	},

	async mcpAction(server, action, exposure) {
		const sessionId = await activeLoadedSessionId();
		if (!client || !sessionId) return;
		try {
			const { error } = await client.request("sessions.mcpAction", { sessionId, server, action, exposure });
			if (error) toast.error(error);
		} catch (error) {
			toast.error(errorMessage(error));
		}
	},

	async setProjectTrust(cwd, decision) {
		if (!client) return;
		await client.request("projects.setTrust", { cwd, decision }).catch((e) => toast.error(errorMessage(e)));
	},
}));

/** The active session's project, else the top project in the sidebar. */
function currentProject(): string | undefined {
	const s = useApp.getState();
	const active = s.activeSessionId ? s.sessionStates[s.activeSessionId] : undefined;
	if (active?.cwd) return active.cwd;
	return visibleProjects(groupByProject(s.sessions, s.projects, ""), false)[0]?.cwd;
}

export function useActiveSession(): SessionState | undefined {
	return useApp((s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId] : undefined));
}

// Track cwd rather than session identity: sessions in the same project share a scope.
useApp.subscribe((state, previous) => {
	const cwd = state.activeSessionId ? state.sessionStates[state.activeSessionId]?.cwd : undefined;
	const previousCwd = previous.activeSessionId ? previous.sessionStates[previous.activeSessionId]?.cwd : undefined;
	if (cwd && cwd !== previousCwd) void state.refreshModelScope(cwd);
});

export function useModelScope(cwd: string | undefined) {
	return useApp((state) => (cwd === undefined ? undefined : state.modelScopes[cwd]));
}
