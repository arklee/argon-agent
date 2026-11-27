// Argon-owned stand-in for upstream src/settings-menu.ts (the TUI menu behind /codex-compact, built on
// @narumitw/pi-tui-kit). Argon does not register that command (see packages/backend/src/codex-compact.ts);
// this only satisfies the dynamic import in codex-compact.ts. Not in vendor.json, so `vendor sync`
// leaves it alone.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CodexCompactSettingsRuntime } from "./settings.js";

export interface SettingsMenuOwner {
  signal: AbortSignal;
  isCurrent(): boolean;
  isPaused?(): boolean;
  hasCheckpoint?(): boolean;
  canReplayCheckpoint?(): boolean;
}

export async function showCodexCompactMenu(
  _runtime: CodexCompactSettingsRuntime,
  _ctx: ExtensionCommandContext,
  _owner: SettingsMenuOwner,
): Promise<void> {
  throw new Error("/codex-compact is not available in Argon. Use Argon's settings instead.");
}
