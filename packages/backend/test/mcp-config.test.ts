import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionMcpOptions } from "../src/builtin-extensions.ts";
import { McpConfigStore } from "../src/mcp-config.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

let dir: string;
let store: McpConfigStore;
const global = { scope: "global" } as const;
const changed = vi.fn(async () => {});
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "argon-mcp-"));
	changed.mockClear();
	store = new McpConfigStore(dir, () => false, changed);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function entries() {
	return JSON.parse(store.getText(global).text).mcpServers;
}
const http = { transport: "http", url: "https://example.test" } as const;

it("creates, edits, switches transport and renames atomically, preserving extras", async () => {
	const create = { ...global, name: "docs", form: http, create: true };
	await store.saveServer(create);
	expect(store.get().global.servers[0]).toMatchObject({ enabled: true, form: http });
	await expect(store.saveServer(create)).rejects.toMatchObject({ code: "conflict" });
	const doc = {
		untouched: 1,
		mcpServers: {
			docs: {
				...entries().docs,
				type: "http",
				auth: { provider: "p" },
				headers: { x: "y" },
				timeout: 8,
				exposure: "direct",
			},
		},
	};
	writeFileSync(join(dir, "mcp.json"), `\uFEFF${JSON.stringify(doc, null, "\t")}`);
	await store.saveServer({ ...create, create: false, form: { ...http, url: "https://other.test" } });
	expect(entries().docs).toMatchObject({ timeout: 8, type: "http", auth: { provider: "p" } });
	await store.saveServer({ ...create, name: "other" });
	await expect(
		store.saveServer({ ...create, name: "other", previousName: "docs", create: false }),
	).rejects.toMatchObject({ code: "conflict" });
	await store.saveServer({
		...create,
		name: "local",
		previousName: "docs",
		create: false,
		form: { transport: "stdio", command: "tool" },
	});
	expect(entries().local).toEqual({ timeout: 8, exposure: "direct", command: "tool" });
	expect(entries().docs).toBeUndefined();
	expect(store.getText(global).text).toContain('\t"untouched": 1');
	await store.setEnabled({ name: "local", enabled: false });
	expect(entries().local.enabled).toBe(false);
	expect(changed).toHaveBeenLastCalledWith(global, false);
	await store.setEnabled({ name: "local", enabled: true });
	expect(entries().local.enabled).toBeUndefined();
	await store.removeServer({ ...global, name: "local" });
	expect(entries().local).toBeUndefined();
	await expect(store.saveServer({ ...create, name: "bad", form: { ...http, url: "invalid" } })).rejects.toMatchObject({
		code: "bad_request",
		message: expect.stringContaining("url"),
	});
});

it("validates project overrides and auth, returns parse errors and detects stale raw edits", async () => {
	const project = { scope: "project", cwd: dir } as const;
	const original = store.getText(project);
	expect(original.text).toBe("");
	await store.saveServer({ ...global, name: "base", form: http, create: true });
	const text = JSON.stringify({ mcpServers: { base: { enabled: false } } });
	await store.setText({ ...project, text, version: original.version });
	expect(store.get(dir).project).toMatchObject({
		trusted: false,
		servers: [{ name: "base", override: true, enabled: false }],
	});
	await expect(store.setText({ ...project, text, version: original.version })).rejects.toMatchObject({
		code: "conflict",
	});
	const { version } = store.getText(project);
	for (const invalid of [
		"{",
		JSON.stringify({ mcpServers: { unknown: { enabled: true } } }),
		JSON.stringify({ mcpServers: { x: { url: http.url, auth: { provider: "p" } } } }),
	])
		await expect(store.setText({ ...project, text: invalid, version })).rejects.toMatchObject({ code: "bad_request" });
	writeFileSync(original.path, JSON.stringify({ mcpServers: { x: { url: http.url, auth: { provider: "p" } } } }));
	await expect(store.saveServer({ ...project, name: "x", form: http, create: false })).rejects.toMatchObject({
		code: "bad_request",
	});
	writeFileSync(original.path, "{");
	expect(store.get(dir).project).toMatchObject({ error: expect.any(String), servers: [] });
});

it("layers session enable choices over project and file defaults and saves exposure to the file", async () => {
	const manager = SessionManager.inMemory(dir);
	const settings = new ArgonSettingsStore(dir);
	await settings.updateProject(dir, { mcpServers: { a: true, b: false } });
	const file = JSON.stringify({
		mcpServers: { a: { command: "a", enabled: false }, b: { command: "b" }, c: { command: "c", enabled: false } },
	});
	writeFileSync(join(dir, "mcp.json"), file);
	const options = sessionMcpOptions(dir, manager, settings);
	const ctx = { cwd: dir, sessionManager: manager, isProjectTrusted: () => false };
	const load = () => options.loadConfig(ctx).servers;
	expect(load().map((s) => s.config.enabled)).toEqual([true, false, false]);
	options.updateConfig(load()[0]!, { enabled: false });
	options.updateConfig(load()[1]!, { enabled: true });
	expect(load().map((s) => s.config.enabled)).toEqual([false, true, false]);
	expect(store.getText(global).text).toBe(file);
	options.updateConfig(load()[1]!, { exposure: "direct" });
	expect(entries().b).toEqual({ command: "b", exposure: "direct" });
});

it("accepts only one raw write based on the same version", async () => {
	const { version } = store.getText(global);
	const results = await Promise.allSettled(
		["one", "two"].map((name) =>
			store.setText({ ...global, version, text: JSON.stringify({ mcpServers: { [name]: { command: "tool" } } }) }),
		),
	);
	expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
	expect(results[1]).toMatchObject({ reason: { code: "conflict" } });
	expect(changed).toHaveBeenCalledTimes(1);
	expect(entries()).toEqual({ one: { command: "tool" } });
});

it("imports pasted servers all-or-nothing, keeping their fields", async () => {
	const servers = {
		fs: { command: "npx", args: ["-y", "srv"], description: "files", timeout: 9 },
		docs: { type: "http", url: "https://docs.test/mcp" },
	};
	expect(await store.importServers({ ...global, servers })).toEqual({ added: ["fs", "docs"], replaced: [] });
	expect(entries().fs).toEqual(servers.fs);
	expect(changed).toHaveBeenCalledWith(expect.objectContaining(global), true);

	await expect(store.importServers({ ...global, servers: { fs: servers.fs } })).rejects.toMatchObject({
		code: "conflict",
	});
	expect(await store.importServers({ ...global, servers: { fs: { command: "uvx" } }, replace: true })).toEqual({
		added: [],
		replaced: ["fs"],
	});

	// One bad entry (legacy SSE) rejects the whole import.
	const sse = { type: "sse", url: "http://127.0.0.1:64342/sse" };
	await expect(store.importServers({ ...global, servers: { ok: { command: "x" }, ide: sse } })).rejects.toMatchObject({
		code: "bad_request",
		message: expect.stringContaining("SSE"),
	});
	expect(entries().ok).toBeUndefined();
});
