// Argon-owned stand-in for upstream src/menu.ts (the TUI menu behind /codex-imagegen). Argon does not
// register that command (see packages/backend/src/codex-imagegen.ts); this only satisfies the type
// import in codex-imagegen.ts. Not in vendor.json, so `vendor sync` leaves it alone.

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ImagegenSettings } from "./settings.js";

export interface ImagegenMenuOwner {
  signal: AbortSignal;
  isCurrent(): boolean;
  getSettings(): ImagegenSettings;
  settingsPath: string;
  getAuthStatus(): string;
  isBusy(): boolean;
  saveSettings(patch: Partial<ImagegenSettings>): Promise<void>;
  generate(prompt: string, path: string, signal: AbortSignal): Promise<void>;
}

export async function showImagegenMenu(_ctx: ExtensionCommandContext, _owner: ImagegenMenuOwner): Promise<void> {
  throw new Error("/codex-imagegen is not available in Argon. Use Argon's settings instead.");
}
