/**
 * App store. Holds UI-facing state only; session state comes from the shared SessionMirror,
 * which owns ordering, gap detection and resync. Nothing here does IO except through AgentClient.
 */

import {
	type AgentClient,
	type ConnectionState,
	type EnvironmentInfo,
	type InteractionResponse,
	type McpAction,
	type McpExposure,
	type ModelInfo,
	type ModelRef,
	type PermissionMode,
	SessionMirror,
	type SessionState,
	type SessionSummary,
	type ThinkingLevel,
	WebSocketAgentClient,
} from "@argon/shared";
import { toast } from "sonner";
import { create } from "zustand";
import { type ConnectionConfig, clearConnectionConfig } from "@/lib/connection";

interface AppState {
	connection: ConnectionState | undefined;
	environment: EnvironmentInfo | undefined;
	sessions: SessionSummary[];
	sessionStates: Record<string, SessionState>;
	activeSessionId: string | undefined;
	models: ModelInfo[];
	openingSession: boolean;
	mcpPanelOpen: boolean;

	connect(config: ConnectionConfig): void;
	disconnect(): void;
	refreshSessions(): Promise<void>;
	refreshModels(): Promise<void>;
	openSession(summary: SessionSummary): Promise<void>;
	createSession(cwd: string): Promise<void>;
	clearActiveSession(): void;
	setMcpPanelOpen(open: boolean): void;
	compact(customInstructions?: string): Promise<void>;
	editMessage(itemId: string, text: string): Promise<void>;
	renameSession(name: string): Promise<void>;
	sendPrompt(text: string, streamingBehavior?: "steer" | "followUp"): Promise<void>;
	abort(): Promise<void>;
	respond(interactionId: string, response: InteractionResponse): Promise<void>;
	setModel(model: ModelRef): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	setPermissionMode(mode: PermissionMode): Promise<void>;
	mcpAction(server: string, action: McpAction | "exposure", exposure?: McpExposure): Promise<void>;
}

let client: AgentClient | undefined;
let mirror: SessionMirror | undefined;
let disposers: Array<() => void> = [];

export function getClient(): AgentClient {
	if (!client) throw new Error("Not connected");
	return client;
}

const LAST_SESSION_KEY = (envId: string) => `argon.lastSession.${envId}`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const useApp = create<AppState>((set, get) => ({
	connection: undefined,
	environment: undefined,
	sessions: [],
	sessionStates: {},
	activeSessionId: undefined,
	models: [],
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
					if (state) next[sessionId] = state;
					else delete next[sessionId];
					const activeGone = !state && s.activeSessionId === sessionId;
					return { sessionStates: next, activeSessionId: activeGone ? undefined : s.activeSessionId };
				});
			}),
			m.onNotification((_sessionId, event) => {
				const show = event.level === "error" ? toast.error : event.level === "warning" ? toast.warning : toast;
				show(event.message);
			}),
			c.onGlobalEvent((event) => {
				if (event.type === "sessions_changed" || event.type === "session_unloaded") void get().refreshSessions();
			}),
			c.onConnectionChange((connection) => {
				set({ connection });
				if (connection.status === "connected") {
					set({ environment: connection.environment });
					void get().refreshSessions();
					void get().refreshModels();
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
		client = undefined;
		mirror = undefined;
		set({ connection: undefined, sessionStates: {}, activeSessionId: undefined, sessions: [] });
	},

	async refreshSessions() {
		if (!client) return;
		try {
			const { sessions } = await client.request("sessions.list", {});
			set({ sessions });
		} catch (error) {
			console.warn("sessions.list failed", error);
		}
	},

	async refreshModels() {
		if (!client) return;
		try {
			const { models } = await client.request("models.list", {});
			set({ models });
		} catch (error) {
			toast.error(`Could not load models: ${errorMessage(error)}`);
		}
	},

	async openSession(summary) {
		if (!mirror) return;
		set({ openingSession: true });
		try {
			const state =
				summary.loaded || !summary.sessionPath
					? await mirror.attach(summary.sessionId)
					: await mirror.open(summary.sessionPath);
			set({ activeSessionId: state.sessionId });
			const envId = get().environment?.id;
			if (envId && state.sessionPath) localStorage.setItem(LAST_SESSION_KEY(envId), state.sessionPath);
		} catch (error) {
			toast.error(`Could not open session: ${errorMessage(error)}`);
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
			toast.error(`Could not create session: ${errorMessage(error)}`);
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
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client
			.request("sessions.compact", { sessionId, customInstructions })
			.catch((e) => toast.error(errorMessage(e)));
	},

	async editMessage(itemId, text) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		const clientMessageId = crypto.randomUUID();
		try {
			await client.request("sessions.editMessage", { sessionId, itemId, text, clientMessageId });
		} catch (error) {
			toast.error(errorMessage(error));
			throw error;
		}
	},

	async renameSession(name) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client.request("sessions.rename", { sessionId, name }).catch((e) => toast.error(errorMessage(e)));
	},

	async sendPrompt(text, streamingBehavior) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		const clientMessageId = crypto.randomUUID();
		try {
			await client.request("sessions.prompt", { sessionId, clientMessageId, text, streamingBehavior });
		} catch (error) {
			toast.error(errorMessage(error));
			throw error;
		}
	},

	async abort() {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client.request("sessions.abort", { sessionId }).catch((e) => toast.error(errorMessage(e)));
	},

	async respond(interactionId, response) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		try {
			const { accepted } = await client.request("interactions.respond", { sessionId, interactionId, response });
			if (!accepted) toast.warning("This request was already answered or has expired");
		} catch (error) {
			toast.error(errorMessage(error));
		}
	},

	async setModel(model) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client.request("sessions.setModel", { sessionId, model }).catch((e) => toast.error(errorMessage(e)));
	},

	async setThinkingLevel(level) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client.request("sessions.setThinkingLevel", { sessionId, level }).catch((e) => toast.error(errorMessage(e)));
	},

	async setPermissionMode(mode) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		await client.request("sessions.setPermissionMode", { sessionId, mode }).catch((e) => toast.error(errorMessage(e)));
	},

	async mcpAction(server, action, exposure) {
		const sessionId = get().activeSessionId;
		if (!client || !sessionId) return;
		try {
			const { error } = await client.request("sessions.mcpAction", { sessionId, server, action, exposure });
			if (error) toast.error(error);
		} catch (error) {
			toast.error(errorMessage(error));
		}
	},
}));

export function useActiveSession(): SessionState | undefined {
	return useApp((s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId] : undefined));
}
