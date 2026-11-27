import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createBuiltinExtensions } from "../src/builtin-extensions.ts";
import { createHandlers } from "../src/server.ts";
import { ArgonSettingsStore } from "../src/settings.ts";
import { findToolPreset, resolveToolPreset } from "../src/tool-presets.ts";

vi.mock(import("@earendil-works/pi-coding-agent"), async (original) => ({
	...(await original()),
	createCodemodeExtension: vi.fn(),
}));

it("resolves known ids and falls back for unknown and missing ids", () => {
	expect(findToolPreset("classic")?.label).toBe("Classic");
	expect(findToolPreset("constructor")).toBeUndefined();
	expect(resolveToolPreset(undefined).id).toBe("classic");
	expect(resolveToolPreset("obsolete", "codemode").id).toBe("codemode");
});

it("reads the current mode each time pi requests it", () => {
	let preset = resolveToolPreset("classic");
	createBuiltinExtensions(new ArgonSettingsStore("/unused"), () => preset.codemodeMode);
	const options = vi.mocked(createCodemodeExtension).mock.lastCall?.[0];
	expect(options).toBeDefined();
	expect(options?.mode).toBeUndefined();
	preset = resolveToolPreset("codemode");
	expect(options?.mode).toBe("on");
	preset = resolveToolPreset("codemode_only");
	expect(options?.mode).toBe("only");
});

it("rejects an unknown preset before accessing the session", async () => {
	const handlers = createHandlers({} as never, {} as never);
	await expect(
		handlers["sessions.setToolPreset"]({ sessionId: "session", preset: "unknown" }, {} as never),
	).rejects.toMatchObject({ code: "bad_request" });
	expect((await handlers["toolPresets.list"]({}, {} as never)).presets.map((p) => p.id)).toEqual([
		"classic",
		"codemode",
		"codemode_only",
	]);
});
