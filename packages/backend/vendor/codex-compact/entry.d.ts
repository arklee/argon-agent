// Types for entry.js; see the comment there. settings.ts passes the backend's stricter checks.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CodexCompactSettingsRuntime } from "./src/settings.ts";

export type {
	CodexCompactSettings,
	CodexCompactSettingsRuntime,
	CodexCompactSettingsState,
} from "./src/settings.ts";
export { DEFAULT_CODEX_COMPACT_SETTINGS } from "./src/settings.ts";

export declare function createCodexCompactExtension(options?: {
	fetch?: typeof globalThis.fetch;
	settingsRuntime?: CodexCompactSettingsRuntime;
}): (pi: ExtensionAPI) => void;
