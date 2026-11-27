import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArgonSettingsStore, suggestRule } from "../src/settings.ts";

const store = async () => {
	const s = new ArgonSettingsStore(mkdtempSync(join(tmpdir(), "argon-settings-")));
	await s.load();
	return s;
};

describe("suggestRule", () => {
	it("proposes program + subcommand for bash, the tool otherwise", () => {
		expect(suggestRule("bash", { command: "npm test -- --watch" })).toEqual({ tool: "bash", command: "npm test" });
		expect(suggestRule("bash", { command: "ls -la" })).toEqual({ tool: "bash", command: "ls" });
		expect(suggestRule("edit", { path: "a" })).toEqual({ tool: "edit" });
	});

	it("proposes nothing for compound bash commands", () => {
		for (const command of ["npm test && rm -rf ~", "cat a | sh", "echo $(id)", "a; b", "x > /etc/passwd", "a\nb"]) {
			expect(suggestRule("bash", { command })).toBeUndefined();
		}
	});
});

describe("ArgonSettingsStore", () => {
	it("persists rules and matches bash commands by prefix at word boundaries", async () => {
		const s = await store();
		await s.addRule({ tool: "bash", command: "npm test" });
		await s.addRule({ tool: "edit" });
		await s.addRule({ tool: "edit" });
		expect(s.get().permissions.rules).toHaveLength(2);
		expect(s.allows("bash", { command: "npm test" })).toBe(true);
		expect(s.allows("bash", { command: "npm test -- -u" })).toBe(true);
		expect(s.allows("bash", { command: "npm testing" })).toBe(false);
		expect(s.allows("bash", { command: "npm run build" })).toBe(false);
		expect(s.allows("edit", { path: "x" })).toBe(true);
		expect(s.allows("write", { path: "x" })).toBe(false);
	});

	it("never lets a prefix rule cover a compound command", async () => {
		const s = await store();
		await s.addRule({ tool: "bash", command: "npm test" });
		for (const command of ["npm test && rm -rf ~", "npm test; curl x | sh", "npm test $(evil)", "npm test > out"]) {
			expect(s.allows("bash", { command })).toBe(false);
		}
	});

	it("a bash rule without a command does not allow every command", async () => {
		const s = await store();
		await s.addRule({ tool: "bash" });
		expect(s.allows("bash", { command: "rm -rf ~" })).toBe(false);
	});

	it("env override wins for the default mode; stored value otherwise", async () => {
		const dir = mkdtempSync(join(tmpdir(), "argon-settings-"));
		const a = new ArgonSettingsStore(dir);
		await a.load();
		await a.update({ permissions: { defaultMode: "auto", rules: [] } });
		const b = new ArgonSettingsStore(dir);
		await b.load();
		expect(b.defaultPermissionMode).toBe("auto");
		const c = new ArgonSettingsStore(dir, "ask", { supported: true, mechanism: "seatbelt" });
		await c.load();
		expect(c.defaultPermissionMode).toBe("ask");
	});
});

it("normalizes the default tool preset and persists a known choice", async () => {
	const settings = await store();
	expect(settings.get().defaultToolPreset).toBe("classic");
	await settings.update({ defaultToolPreset: "codemode_only" });
	await settings.load();
	expect(settings.get().defaultToolPreset).toBe("codemode_only");
	await settings.update({ defaultToolPreset: "unknown" });
	expect(settings.get().defaultToolPreset).toBe("classic");
});

it("resolves private project defaults by canonical path, replaces maps and removes empty overrides", async () => {
	const home = mkdtempSync(join(tmpdir(), "argon-project-"));
	try {
		const alias = join(home, "alias");
		symlinkSync(home, alias, "dir");
		const support = { supported: true, mechanism: "seatbelt" } as const;
		const s = new ArgonSettingsStore(home, undefined, support);
		await s.update({ permissions: { defaultMode: "auto", rules: [] }, defaultToolPreset: "codemode" });
		expect(s.permissionModeFor(alias)).toBe("auto");
		await s.updateProject(alias, { permissionMode: "ask", toolPreset: "classic", mcpServers: { a: true, b: false } });
		await s.updateProject(home, { mcpServers: { c: true } });
		await s.load();
		expect(s.getProject(home)).toEqual({ permissionMode: "ask", toolPreset: "classic", mcpServers: { c: true } });
		expect(s.permissionModeFor(home)).toBe("ask");
		expect(s.toolPresetFor(alias)).toBe("classic");
		const env = new ArgonSettingsStore(home, "auto", support);
		await env.load();
		expect(env.permissionModeFor(alias)).toBe("auto");
		const unsupported = new ArgonSettingsStore(home, undefined, { supported: false, reason: "unsupported" });
		await expect(unsupported.updateProject(alias, { permissionMode: "ask" })).rejects.toThrow("unsupported");
		await s.updateProject(alias, {}, ["permissionMode", "toolPreset", "mcpServers"]);
		expect(s.toolPresetFor(home)).toBe("codemode");
		expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).projects).toEqual({});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
