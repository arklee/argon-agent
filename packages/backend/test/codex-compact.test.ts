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
	let mode: "on" | "off" | "openai" = "on";
	const factory = createCompactExtension({ get: () => ({ ...defaults, openaiFeatures: mode }) });
	const registerCommand = vi.fn();
	const on = vi.fn();
	await factory({ registerCommand, on } as unknown as ExtensionAPI);
	const runtime = vi.mocked(createCodexCompactExtension).mock.calls.at(-1)?.[0]?.settingsRuntime;
	expect(runtime).toBeDefined();
	if (!runtime) throw new Error("Missing settings runtime");

	expect(registerCommand).toHaveBeenCalledExactlyOnceWith("other", expect.any(Object));
	expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
	const initial = runtime.get();
	expect(initial).toEqual({ kind: "loaded", path: "Argon settings", settings: DEFAULT_CODEX_COMPACT_SETTINGS });
	for (const value of [false, true]) {
		mode = value ? "on" : "off";
		expect(runtime.get().settings.enabled).toBe(value);
		expect((await runtime.reload()).settings.enabled).toBe(value);
		expect(runtime.get()).not.toBe(initial);
		expect(runtime.get().settings).not.toBe(initial.settings);
	}

	mode = "openai";
	for (const provider of ["openai", "openai-codex", "anthropic"]) {
		await on.mock.calls.find(([event]) => event === "model_select")?.[1]({ model: { provider } });
		expect(runtime.get().settings.enabled).toBe(provider !== "anthropic");
	}
	const otherOn = vi.fn();
	await factory({ registerCommand: vi.fn(), on: otherOn } as unknown as ExtensionAPI);
	const other = vi.mocked(createCodexCompactExtension).mock.calls.at(-1)?.[0]?.settingsRuntime;
	await otherOn.mock.calls.find(([event]) => event === "session_start")?.[1]({}, { model: { provider: "openai" } });
	expect(other?.get().settings.enabled).toBe(true);
	expect(runtime.get().settings.enabled).toBe(false);
	await expect(runtime.update({ enabled: false })).rejects.toThrow("managed in Argon");
	await expect(runtime.flush()).resolves.toBeUndefined();
});
