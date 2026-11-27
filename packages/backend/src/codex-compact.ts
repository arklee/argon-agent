/** D18: keep the vendored factory intact; manage settings in Argon and drop the upstream TUI menu. */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	type CodexCompactSettingsRuntime,
	type CodexCompactSettingsState,
	createCodexCompactExtension,
	DEFAULT_CODEX_COMPACT_SETTINGS,
} from "../vendor/codex-compact/entry.js";
import type { ArgonSettingsStore } from "./settings.ts";

export function createCompactExtension(settings: Pick<ArgonSettingsStore, "get">): ExtensionFactory {
	const get = (): CodexCompactSettingsState => ({
		kind: "loaded",
		path: "Argon settings",
		settings: { ...DEFAULT_CODEX_COMPACT_SETTINGS, enabled: settings.get().remoteCompaction },
	});
	const settingsRuntime: CodexCompactSettingsRuntime = {
		get,
		reload: async () => get(),
		update: async () => {
			throw new Error("Remote compaction settings are managed in Argon");
		},
		flush: async () => {},
	};
	const factory = createCodexCompactExtension({ settingsRuntime });
	return (pi) => {
		const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
			if (name !== "codex-compact") pi.registerCommand(name, options);
		};
		return factory(
			new Proxy(pi, {
				get(target, key, receiver) {
					if (key === "registerCommand") return registerCommand;
					return Reflect.get(target, key, receiver);
				},
			}),
		);
	};
}
