import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectPiSettings } from "@argon/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectSettingsPath, readProjectSettings, writeProjectSettings } from "../src/settings.ts";

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "argon-project-settings-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function seed(data: unknown): void {
	mkdirSync(dirname(projectSettingsPath(cwd)), { recursive: true });
	writeFileSync(projectSettingsPath(cwd), JSON.stringify(data));
}
function disk(): unknown {
	return JSON.parse(readFileSync(projectSettingsPath(cwd), "utf8"));
}

describe("project settings", () => {
	it("uses the project .argon directory and reads a missing file as empty", () => {
		expect(projectSettingsPath(cwd)).toBe(join(cwd, ".argon", "settings.json"));
		expect(readProjectSettings(cwd, false)).toEqual({
			cwd,
			path: projectSettingsPath(cwd),
			trusted: false,
			values: {},
		});
	});

	it("maps values to pi keys and preserves unrelated settings and nested siblings", () => {
		seed({ extensions: ["./extension.ts"], compaction: { reserveTokens: 4096 }, images: { custom: "keep" } });
		const values = {
			compaction: false,
			retry: true,
			imageAutoResize: false,
			blockImages: true,
			defaultModel: { provider: "test-provider", id: "test-model" },
		};
		writeProjectSettings(cwd, values);
		expect(disk()).toEqual({
			extensions: ["./extension.ts"],
			compaction: { reserveTokens: 4096, enabled: false },
			retry: { enabled: true },
			images: { custom: "keep", autoResize: false, blockImages: true },
			defaultProvider: "test-provider",
			defaultModel: "test-model",
		});
		expect(readProjectSettings(cwd, true)).toEqual({ cwd, path: projectSettingsPath(cwd), trusted: true, values });
	});

	it("unsets model keys and prunes empty parents while retaining nonempty parents", () => {
		seed({
			defaultProvider: "p",
			defaultModel: "m",
			compaction: { enabled: true, reserveTokens: 10 },
			retry: { enabled: true },
			images: { autoResize: true, blockImages: false },
			custom: 42,
		});
		writeProjectSettings(cwd, {}, ["defaultModel", "compaction", "retry", "imageAutoResize"]);
		expect(disk()).toEqual({ compaction: { reserveTokens: 10 }, images: { blockImages: false }, custom: 42 });
		writeProjectSettings(cwd, {}, ["blockImages"]);
		expect(disk()).toEqual({ compaction: { reserveTokens: 10 }, custom: 42 });
		expect(readProjectSettings(cwd, true).values).toEqual({});
	});

	it.each([
		["compaction", "yes"],
		["retry", 1],
		["imageAutoResize", null],
		["blockImages", []],
		["enableSkillCommands", "false"],
		["shellPath", 12],
		["shellCommandPrefix", false],
		["defaultThinkingLevel", 1],
		["enabledModels", "model"],
		["enabledModels", [1]],
		["steeringMode", "invalid"],
		["followUpMode", "invalid"],
		["unknownSetting", true],
		["defaultModel", { provider: "p" }],
		["defaultModel", { provider: 42, id: "m" }],
		["defaultModel", { provider: "p", id: true }],
		["defaultModel", { provider: "", id: "m" }],
		["defaultModel", { provider: "p", id: "" }],
	])("rejects invalid %s value %j without changing existing contents", (key, value) => {
		seed({ custom: "keep" });
		const before = readFileSync(projectSettingsPath(cwd), "utf8");
		expect(() => writeProjectSettings(cwd, { [key]: value } as Partial<ProjectPiSettings>)).toThrow();
		expect(readFileSync(projectSettingsPath(cwd), "utf8")).toBe(before);
	});

	it("rejects unknown unset keys", () => {
		expect(() => writeProjectSettings(cwd, {}, ["unknown" as keyof ProjectPiSettings])).toThrow(
			"Not a project setting",
		);
	});

	it("reports invalid JSON on read and refuses to overwrite it", () => {
		seed({});
		const invalid = '{"compaction":';
		writeFileSync(projectSettingsPath(cwd), invalid);
		const result = readProjectSettings(cwd, true);
		expect(result.values).toEqual({});
		expect(result.error).toEqual(expect.any(String));
		expect(result.error).not.toBe("");
		expect(() => writeProjectSettings(cwd, { retry: true })).toThrow();
		expect(readFileSync(projectSettingsPath(cwd), "utf8")).toBe(invalid);
	});
});
