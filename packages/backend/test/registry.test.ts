import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { SessionRegistry } from "../src/registry.ts";
import { SessionIndex } from "../src/session-index.ts";
import { SessionPrefs } from "../src/session-prefs.ts";
import { ArgonSettingsStore } from "../src/settings.ts";
import { listSessionFiles, UploadsGc } from "../src/uploads-gc.ts";

vi.mock("../src/magpie-host.ts", () => ({
	MagpieHost: class {
		async start() {}
		async dispose() {}
	},
}));
vi.mock(import("../src/uploads-gc.ts"), async (original) => ({
	...(await original()),
	listSessionFiles: vi.fn(async () => []),
}));

let home: string;
let registry: SessionRegistry | undefined;
afterEach(async () => {
	await registry?.dispose();
	registry = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
});

async function setup() {
	home = mkdtempSync(join(tmpdir(), "argon-registry-"));
	vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", join(home, "sessions"));
	vi.spyOn(ModelRuntime, "create").mockResolvedValue({
		settleCredentialWrites: async () => {},
	} as unknown as ModelRuntime);
	vi.spyOn(SessionIndex.prototype, "list").mockResolvedValue([]);
	vi.spyOn(SessionRegistry.prototype, "listProjects").mockResolvedValue([{ cwd: home }]);
	vi.spyOn(
		SessionRegistry.prototype as unknown as { isProjectTrusted(cwd: string): boolean },
		"isProjectTrusted",
	).mockReturnValue(true);
	const settings = SettingsManager.inMemory({ sessionDir: "extra" });
	vi.spyOn(SettingsManager, "create").mockReturnValue(settings);
	let scan: (() => Promise<Iterable<string>>) | undefined;
	vi.spyOn(UploadsGc.prototype, "start").mockImplementation(function (this: UploadsGc) {
		scan = (this as unknown as { options: { listSessionFiles(): Promise<Iterable<string>> } }).options.listSessionFiles;
	});
	registry = await SessionRegistry.create({ agentDir: home, argonHome: home, settings: new ArgonSettingsStore(home) });
	return { scan: scan!, settings };
}

it("aborts GC reference collection on an extra session directory scan error", async () => {
	const { scan } = await setup();
	const error = Object.assign(new Error("denied"), { code: "EACCES" });
	vi.mocked(listSessionFiles).mockImplementation(async (dir) => {
		if (dir === join(home, "extra")) throw error;
		return [];
	});
	await expect(scan()).rejects.toBe(error);
});

it("broadcasts global extension changes and attempts every session even if one reload fails", async () => {
	await setup();
	const event = vi.fn();
	registry!.onGlobalEvent(event);
	const failed = {
		sessionId: "failed",
		configRefreshPending: true,
		refreshProjectTrust: vi.fn().mockRejectedValue(new Error("broken")),
	};
	const idle = {
		sessionId: "idle",
		configRefreshPending: false,
		refreshProjectTrust: vi.fn().mockResolvedValue(undefined),
	};
	const sessions = (registry as unknown as { sessions: Map<string, unknown> }).sessions;
	sessions.set(failed.sessionId, failed);
	sessions.set(idle.sessionId, idle);
	try {
		await expect(registry!.changeExtension("builtin:mcp", { enabled: false })).rejects.toThrow("settings saved");
		expect(failed.refreshProjectTrust).toHaveBeenCalledWith(true);
		expect(idle.refreshProjectTrust).toHaveBeenCalledWith(true);
		expect(event).toHaveBeenCalledWith({ type: "extensions_changed" });
		const status = await registry!.listExtensions();
		expect(status.pendingSessions).toEqual(["failed"]);
		expect(status.items.find((item) => item.id === "builtin:mcp")?.enabled).toBe(false);
	} finally {
		sessions.clear();
	}
});

it("only tolerates settings creation errors, not errors inspecting settings", async () => {
	const { scan, settings } = await setup();
	vi.mocked(listSessionFiles).mockResolvedValue([]);
	vi.spyOn(settings, "getSessionDir").mockImplementation(() => {
		throw new Error("invalid directory");
	});
	await expect(scan()).rejects.toThrow("invalid directory");
	vi.mocked(SettingsManager.create).mockImplementation(() => {
		throw new Error("unreadable settings");
	});
	await expect(scan()).resolves.toEqual([]);
});

it("prunes missing external sessions before collecting GC references", async () => {
	const { scan } = await setup();
	const prefs = (registry as unknown as { prefs: SessionPrefs }).prefs;
	const kept = join(home, "kept.jsonl");
	writeFileSync(kept, "");
	await prefs.addExternalSession(kept);
	await prefs.addExternalSession(join(home, "gone.jsonl"));
	await expect(scan()).resolves.toEqual([kept]);
	expect(new SessionPrefs(home).externalSessions()).toEqual([kept]);
});

it("flushes pending preference writes before disposal completes", async () => {
	await setup();
	const prefs = (registry as unknown as { prefs: SessionPrefs }).prefs;
	void prefs.setArchived("session", true);
	await registry!.dispose();
	expect(new SessionPrefs(home).isArchived("session")).toBe(true);
	registry = undefined;
});

it("leaves blank new sessions out of the list until something happens in them", async () => {
	await setup();
	const fake = (sessionId: string, items: unknown[], isRunning = false) => ({
		sessionId,
		isRunning,
		createdAt: 1,
		snapshot: () => ({ state: { cwd: home, items } }),
	});
	const sessions = (registry as unknown as { sessions: Map<string, unknown> }).sessions;
	sessions.set("blank", fake("blank", []));
	sessions.set("starting", fake("starting", [], true));
	sessions.set("asked", fake("asked", [{ kind: "user", text: "hi" }]));
	const listed = await registry!.list();
	expect(listed.map((s) => s.sessionId).sort()).toEqual(["asked", "starting"]);
	expect(listed.find((s) => s.sessionId === "asked")?.firstMessage).toBe("hi");
	sessions.clear();
});
