import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createImagegenExtension, refreshImagegenExposure } from "../src/codex-imagegen.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

it("drops the TUI command and refreshes each live runtime's tool exposure", async () => {
	const settings = new ArgonSettingsStore("/unused");
	let mode: "on" | "off" | "openai" = "off";
	const defaults = settings.get();
	vi.spyOn(settings, "get").mockImplementation(() => ({ ...defaults, openaiFeatures: mode }));
	const factory = createImagegenExtension(settings);
	expect(createImagegenExtension(settings)).toBe(factory);
	const runtimes = await Promise.all(
		[0, 1].map(async () => {
			const registerTool = vi.fn();
			const registerCommand = vi.fn();
			const on = vi.fn();
			await factory({ registerTool, registerCommand, on, registerMessageRenderer: vi.fn() } as unknown as ExtensionAPI);
			expect(registerCommand).not.toHaveBeenCalled();
			expect(registerTool).toHaveBeenLastCalledWith(
				expect.objectContaining({ name: "codex_imagegen", exposure: "hidden" }),
			);
			return { registerTool, on };
		}),
	);
	try {
		for (const value of [true, false]) {
			mode = value ? "on" : "off";
			refreshImagegenExposure(settings);
			for (const runtime of runtimes)
				expect(runtime.registerTool).toHaveBeenLastCalledWith(
					expect.objectContaining({ exposure: value ? "direct" : "hidden" }),
				);
		}

		mode = "openai";
		for (const [i, runtime] of runtimes.entries()) {
			await runtime.on.mock.calls.find(([event]) => event === "model_select")?.[1]({
				model: { provider: i === 0 ? "openai" : "anthropic" },
			});
		}
		refreshImagegenExposure(settings);
		expect(runtimes[0]?.registerTool.mock.lastCall?.[0].exposure).toBe("direct");
		expect(runtimes[1]?.registerTool.mock.lastCall?.[0].exposure).toBe("hidden");
		await expect(
			runtimes[0]?.registerTool.mock.lastCall?.[0].execute("id", {}, undefined, undefined, {
				model: { provider: "anthropic" },
			}),
		).rejects.toThrow("disabled");
	} finally {
		for (const runtime of runtimes) {
			// The wrapper's cleanup is registered after the upstream shutdown handler.
			await runtime.on.mock.calls.findLast(([event]) => event === "session_shutdown")?.[1]();
			runtime.registerTool.mockClear();
		}
	}
	refreshImagegenExposure(settings);
	for (const runtime of runtimes) expect(runtime.registerTool).not.toHaveBeenCalled();
});
