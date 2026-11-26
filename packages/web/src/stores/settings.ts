import { t } from "@/i18n";
/**
 * Settings, provider accounts and plugins. Backend-wide state (not per session), fetched on demand
 * while the settings dialog is open; login flows are owned by the backend and pushed as events.
 */

import type {
	ArgonSettings,
	AuthFlow,
	AuthType,
	GlobalEvent,
	PiSettings,
	PluginInfo,
	ProjectPiSettings,
	ProjectSettingsInfo,
	ProviderInfo,
	ResourceSettings,
} from "@argon/shared";
import { toast } from "sonner";
import { create } from "zustand";
import { getClient, useApp } from "@/stores/app";

export type SettingsSection = "general" | "accounts" | "permissions" | "plugins" | "resources";

interface SettingsData {
	project?: ProjectSettingsInfo;
	pi: PiSettings;
	resources: ResourceSettings[];
	argon: ArgonSettings;
}

interface PluginsData {
	plugins: PluginInfo[];
	errors: string[];
	available: boolean;
}

interface SettingsState {
	open: boolean;
	scope: "global" | "project";
	setScope(scope: "global" | "project"): void;
	updateProject(set: Partial<ProjectPiSettings>, unset?: (keyof ProjectPiSettings)[]): Promise<void>;
	section: SettingsSection;
	/** Project whose settings files are shown under Resources (the active session's cwd). */
	cwd: string | undefined;
	providers: ProviderInfo[] | undefined;
	flows: Record<string, AuthFlow>;
	settings: SettingsData | undefined;
	plugins: PluginsData | undefined;

	show(section?: SettingsSection, cwd?: string): void;
	close(): void;
	setSection(section: SettingsSection): void;
	onGlobalEvent(event: GlobalEvent): void;
	reset(): void;

	refreshProviders(): Promise<void>;
	refreshFlows(): Promise<void>;
	refreshSettings(): Promise<void>;
	refreshPlugins(): Promise<void>;

	updatePi(patch: Partial<PiSettings>): Promise<void>;
	updateArgon(patch: Partial<ArgonSettings>): Promise<void>;

	login(providerId: string, type: AuthType): Promise<void>;
	respondFlow(flowId: string, promptId: string, value: string): Promise<void>;
	cancelFlow(flowId: string): Promise<void>;
	dismissFlow(flowId: string): void;
	logout(providerId: string): Promise<void>;

	searchPlugins(query: string): Promise<{ name: string; version: string; description?: string }[]>;
	changePlugin(action: "install" | "remove", spec: string): Promise<boolean>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const initial = {
	scope: "global" as const,
	providers: undefined,
	flows: {},
	settings: undefined,
	plugins: undefined,
};

export const useSettings = create<SettingsState>((set, get) => ({
	open: false,
	section: "general",
	cwd: undefined,
	...initial,

	show(section, cwd) {
		set({ open: true, section: section ?? get().section, cwd, scope: cwd ? get().scope : "global" });
		void get().refreshSettings();
		void get().refreshProviders();
		void get().refreshFlows();
		void get().refreshPlugins();
	},
	setScope(scope) {
		set({ scope });
	},
	close() {
		set({ open: false });
	},
	setSection(section) {
		set({ section });
	},
	reset() {
		set({ open: false, ...initial });
	},

	onGlobalEvent(event) {
		if (event.type === "auth_flow") {
			set((s) => ({ flows: { ...s.flows, [event.flow.flowId]: event.flow } }));
			if (event.flow.status === "succeeded")
				toast.success(t("notifications.signedIn", { provider: event.flow.providerName }));
		}
		if (event.type === "providers_changed" && get().open) {
			void get().refreshProviders();
			void get().refreshPlugins();
		}
	},

	async refreshProviders() {
		try {
			const { providers } = await getClient().request("providers.list", {});
			set({ providers });
		} catch (e) {
			toast.error(t("notifications.loadProviders", { error: errorMessage(e) }));
		}
	},
	async refreshFlows() {
		try {
			const { flows } = await getClient().request("auth.flows", {});
			set({ flows: Object.fromEntries(flows.map((f) => [f.flowId, f])) });
		} catch {
			// Older backends / transient errors: flows still arrive as events.
		}
	},
	async refreshSettings() {
		try {
			const settings = await getClient().request("settings.get", { cwd: get().cwd });
			set({ settings });
		} catch (e) {
			toast.error(t("notifications.loadSettings", { error: errorMessage(e) }));
		}
	},
	async refreshPlugins() {
		try {
			const plugins = await getClient().request("plugins.list", {});
			set({ plugins });
		} catch {
			set({ plugins: { plugins: [], errors: [], available: false } });
		}
	},

	async updatePi(patch) {
		const cwd = get().cwd;
		const current = get().settings;
		if (current) set({ settings: { ...current, pi: { ...current.pi, ...patch } } });
		try {
			await getClient().request("settings.update", { pi: patch });
		} catch (e) {
			toast.error(t("notifications.save", { error: errorMessage(e) }));
		}
		await get().refreshSettings();
		if ("enabledModels" in patch) await refreshModelScopes(cwd);
	},
	async updateProject(patch, unset) {
		const cwd = get().cwd;
		if (!cwd) return;
		const current = get().settings;
		if (current?.project) {
			const values = { ...current.project.values, ...patch };
			for (const key of unset ?? []) delete values[key];
			set({ settings: { ...current, project: { ...current.project, values } } });
		}
		try {
			await getClient().request("settings.updateProject", { cwd, set: patch, unset });
		} catch (e) {
			toast.error(t("notifications.save", { error: errorMessage(e) }));
		}
		await get().refreshSettings();
		if ("enabledModels" in patch || unset?.includes("enabledModels")) await refreshModelScopes(cwd);
	},
	async updateArgon(patch) {
		const current = get().settings;
		if (current) set({ settings: { ...current, argon: { ...current.argon, ...patch } } });
		try {
			await getClient().request("settings.update", { argon: patch });
		} catch (e) {
			toast.error(t("notifications.save", { error: errorMessage(e) }));
		}
		await get().refreshSettings();
	},

	async login(providerId, type) {
		try {
			await getClient().request("auth.login", { providerId, type });
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async respondFlow(flowId, promptId, value) {
		try {
			const { accepted } = await getClient().request("auth.respond", { flowId, promptId, value });
			if (!accepted) toast.warning(t("notifications.stepAnswered"));
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},
	async cancelFlow(flowId) {
		await getClient()
			.request("auth.cancel", { flowId })
			.catch((e) => toast.error(errorMessage(e)));
	},
	dismissFlow(flowId) {
		set((s) => {
			const flows = { ...s.flows };
			delete flows[flowId];
			return { flows };
		});
	},
	async logout(providerId) {
		try {
			await getClient().request("auth.logout", { providerId });
		} catch (e) {
			toast.error(errorMessage(e));
		}
	},

	async searchPlugins(query) {
		try {
			const { results } = await getClient().request("plugins.search", { query });
			return results;
		} catch (e) {
			toast.error(t("notifications.searchFailed", { error: errorMessage(e) }));
			return [];
		}
	},
	async changePlugin(action, spec) {
		try {
			const { message } = await getClient().request("plugins.change", { action, spec, confirmed: true });
			toast.success(
				message ||
					(action === "install" ? t("notifications.installed", { spec }) : t("notifications.removed", { spec })),
			);
			await get().refreshPlugins();
			return true;
		} catch (e) {
			toast.error(errorMessage(e));
			return false;
		}
	},
}));

/** Open settings for the active session's project. */
export function openSettings(section?: SettingsSection): void {
	const app = useApp.getState();
	const cwd = app.activeSessionId ? app.sessionStates[app.activeSessionId]?.cwd : undefined;
	useSettings.getState().show(section, cwd);
}

/** Flows to show for a provider: running, or finished but not yet dismissed. */
export function latestFlow(flows: Record<string, AuthFlow>, providerId: string): AuthFlow | undefined {
	return Object.values(flows)
		.filter((f) => f.providerId === providerId)
		.sort((a, b) => b.startedAt - a.startedAt)[0];
}

async function refreshModelScopes(cwd: string | undefined): Promise<void> {
	const app = useApp.getState();
	const activeCwd = app.activeSessionId ? app.sessionStates[app.activeSessionId]?.cwd : undefined;
	await Promise.all(
		[...new Set([cwd, activeCwd])].filter((path): path is string => !!path).map((path) => app.refreshModelScope(path)),
	);
}
