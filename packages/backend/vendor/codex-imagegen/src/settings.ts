// Argon-owned stand-in for upstream src/settings.ts. Upstream keeps its settings in
// <agentDir>/pi-codex-imagegen.json, edited from a TUI menu; in Argon they come from Argon's own
// settings (ArgonSettings.openaiFeatures; provider gating is in the extension wrapper), read live on every call. Not in vendor.json, so
// `vendor sync` leaves it alone. The shape matches what codex-imagegen.ts uses.

export interface ImagegenSettings {
  toolEnabled: boolean;
  transparentBackground: boolean;
}

let source: () => ImagegenSettings = () => ({ toolEnabled: false, transparentBackground: false });

/** Called once by Argon (packages/backend/src/codex-imagegen.ts). */
export function setImagegenSettingsSource(get: () => ImagegenSettings): void {
  source = get;
}

export class SettingsStore {
  readonly path = "Argon settings";

  constructor(_agentDir: string) {}

  get settings(): ImagegenSettings {
    return { ...source() };
  }

  async load(): Promise<{ settings: ImagegenSettings; warning?: string }> {
    return { settings: this.settings };
  }

  async save(
    _patch: Partial<ImagegenSettings>,
    _options?: { signal?: AbortSignal; isCurrent?: () => boolean; apply?: (next: ImagegenSettings) => void },
  ): Promise<ImagegenSettings> {
    throw new Error("Image generation settings are managed in Argon's settings.");
  }

  async flush(): Promise<void> {}
}
