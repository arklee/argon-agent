import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createCompactExtension } from "../src/codex-compact.ts";
import { ArgonSettingsStore } from "../src/settings.ts";
import { createCodexCompactExtension, DEFAULT_CODEX_COMPACT_SETTINGS } from "../vendor/codex-compact/entry.js";

vi.mock("../vendor/codex-compact/entry.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../vendor/codex-compact/entry.js")>();
	return {
		...original,
		createCodexCompactExtension: vi.fn(() => (pi: ExtensionAPI) => {
			const command = { handler: async () => {} };
			pi.registerCommand("codex-compact", command);
			pi.registerCommand("other", command);
			pi.on("session_start", async () => {});
		}),
	};
});

it("drops only the compact command and reads fresh live Argon settings", async () => {
	const defaults = new ArgonSettingsStore("/unused").get();
	let enabled = true;
	const factory = createCompactExtension({ get: () => ({ ...defaults, remoteCompaction: enabled }) });
	const runtime = vi.mocked(createCodexCompactExtension).mock.calls.at(-1)?.[0]?.settingsRuntime;
	expect(runtime).toBeDefined();
	if (!runtime) throw new Error("Missing settings runtime");
	const registerCommand = vi.fn();
	const on = vi.fn();
	await factory({ registerCommand, on } as unknown as ExtensionAPI);
	expect(registerCommand).toHaveBeenCalledExactlyOnceWith("other", expect.any(Object));
	expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
	const initial = runtime.get();
	expect(initial).toEqual({ kind: "loaded", path: "Argon settings", settings: DEFAULT_CODEX_COMPACT_SETTINGS });
	for (const value of [false, true]) {
		enabled = value;
		expect(runtime.get().settings.enabled).toBe(value);
		expect((await runtime.reload()).settings.enabled).toBe(value);
		expect(runtime.get()).not.toBe(initial);
		expect(runtime.get().settings).not.toBe(initial.settings);
	}
	await expect(runtime.update({ enabled: false })).rejects.toThrow("managed in Argon");
	await expect(runtime.flush()).resolves.toBeUndefined();
});
