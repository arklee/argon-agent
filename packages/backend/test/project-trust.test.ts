import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, ProjectTrustStore, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectTrust } from "../src/project-trust.ts";
import { SessionRegistry } from "../src/registry.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

vi.mock("../src/magpie-host.ts", () => ({
	MagpieHost: class {
		async start() {}
		async dispose() {}
	},
}));

let root: string;
let cwd: string;
let parentPath: string;
let agentDir: string;
let store: ProjectTrustStore;
let decisions: Map<string, boolean>;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "argon-project-trust-")));
	parentPath = join(root, "parent");
	cwd = join(parentPath, "project");
	agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	store = new ProjectTrustStore(agentDir);
	decisions = new Map();
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

function addProjectSettings(path: string): void {
	const configDir = join(path, CONFIG_DIR_NAME);
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "settings.json"), "{}");
}

describe("resolveProjectTrust", () => {
	it("uses session-only choices before resource detection or persisted decisions", () => {
		const alias = join(root, "alias");
		symlinkSync(cwd, alias, "junction");
		store.set(parentPath, true);
		decisions.set(cwd, false);
		expect(resolveProjectTrust(alias, store, decisions, "always")).toEqual({
			trusted: false,
			info: { status: "untrusted", parentPath },
		});
		addProjectSettings(cwd);
		store.set(cwd, false);
		decisions.set(cwd, true);
		expect(resolveProjectTrust(cwd, store, decisions, "never")).toEqual({
			trusted: true,
			info: { status: "trusted", parentPath },
		});
	});

	it("uses the saved boolean or allows projects without gated resources, independent of the default", () => {
		expect(resolveProjectTrust(cwd, store, decisions, "never")).toMatchObject({
			trusted: true,
			info: { status: "not_required", parentPath },
		});
		store.set(parentPath, false);
		expect(resolveProjectTrust(cwd, store, decisions, "always")).toEqual({
			trusted: false,
			info: { status: "not_required", savedPath: parentPath, parentPath },
		});
	});

	it("uses the closest saved decision before the default when resources are present", () => {
		addProjectSettings(cwd);
		store.set(parentPath, true);
		expect(resolveProjectTrust(cwd, store, decisions, "never")).toEqual({
			trusted: true,
			info: { status: "trusted", savedPath: parentPath, parentPath },
		});
		store.set(cwd, false);
		expect(resolveProjectTrust(cwd, store, decisions, "always")).toEqual({
			trusted: false,
			info: { status: "untrusted", savedPath: cwd, parentPath },
		});
	});

	it.each([
		["always", true, "trusted"],
		["never", false, "untrusted"],
		["ask", false, "undecided"],
	] as const)("uses the %s default for projects with resources and no decision", (fallback, trusted, status) => {
		addProjectSettings(cwd);
		expect(resolveProjectTrust(cwd, store, decisions, fallback)).toEqual({ trusted, info: { status, parentPath } });
	});
});

it("loads undecided projects untrusted and reapplies saved and temporary choices across loaded sessions", async () => {
	vi.spyOn(SessionManager, "create").mockImplementation((path) => SessionManager.inMemory(path));
	const sibling = join(parentPath, "sibling");
	const outside = join(root, "parent-other");
	for (const project of [cwd, sibling, outside]) addProjectSettings(project);
	const extensionsDir = join(cwd, CONFIG_DIR_NAME, "extensions");
	mkdirSync(extensionsDir);
	writeFileSync(
		join(extensionsDir, "commands.js"),
		'export default pi => pi.registerCommand("project-command", { handler: async () => {} });',
	);
	writeFileSync(join(extensionsDir, "broken.js"), 'throw new Error("Broken project extension");');

	const userExtensions = join(agentDir, "extensions");
	mkdirSync(userExtensions, { recursive: true });
	writeFileSync(
		join(userExtensions, "trust-hook.js"),
		`export default pi => {
			pi.on("project_trust", () => ({ trusted: "yes", remember: true }));
			pi.registerCommand("switch-project", { handler: (path, ctx) => ctx.switchSession(path) });
		};`,
	);
	const registry = await SessionRegistry.create({ agentDir, argonHome: root, settings: new ArgonSettingsStore(root) });
	try {
		const first = await registry.create(cwd);
		const second = await registry.create(cwd);
		const other = await registry.create(sibling);
		const unrelated = await registry.create(outside);
		const globalEvent = vi.fn();
		registry.onGlobalEvent(globalEvent);
		const hasProjectCommand = () => first.listCommands().some(({ name }) => name === "project-command");
		expect(first.snapshot().state.projectTrust).toMatchObject({ status: "undecided", parentPath });
		expect(hasProjectCommand()).toBe(false);
		expect(existsSync(join(agentDir, "trust.json"))).toBe(false);

		await registry.setProjectTrust({ cwd, decision: "trust_session" });
		expect(first.snapshot().state.projectTrust?.status).toBe("trusted");
		expect(second.snapshot().state.projectTrust?.status).toBe("trusted");
		expect(other.snapshot().state.projectTrust?.status).toBe("undecided");
		expect(hasProjectCommand()).toBe(true);
		expect(first.snapshot().state.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ level: "error", source: "resources", path: join(extensionsDir, "broken.js") }),
			]),
		);
		expect(existsSync(join(agentDir, "trust.json"))).toBe(false);

		await registry.setProjectTrust({ cwd, decision: "deny" });
		expect(first.snapshot().state.projectTrust).toMatchObject({ status: "untrusted", savedPath: cwd });
		expect(hasProjectCommand()).toBe(false);
		expect(first.snapshot().state.diagnostics.some(({ path }) => path === join(extensionsDir, "broken.js"))).toBe(
			false,
		);

		await registry.setProjectTrust({ cwd, decision: "trust_parent" });
		for (const session of [first, second, other]) {
			expect(session.snapshot().state.projectTrust).toMatchObject({ status: "trusted", savedPath: parentPath });
		}
		expect(store.getEntry(cwd)).toEqual({ path: parentPath, decision: true });
		expect(unrelated.snapshot().state.projectTrust?.status).toBe("undecided");
		expect(globalEvent.mock.calls.filter(([event]) => event.type === "projects_changed")).toHaveLength(3);

		const target = SessionManager.inMemory(outside);
		const targetFile = join(root, "switch-target.jsonl");
		writeFileSync(targetFile, `${JSON.stringify(target.getHeader())}\n`);
		expect(await first.prompt({ clientMessageId: "switch", text: `/switch-project ${targetFile}` })).toBe("handled");
		expect(globalEvent).toHaveBeenCalledWith({
			type: "session_requested",
			fromSessionId: first.sessionId,
			sessionPath: targetFile,
		});
		expect(registry.require(target.getSessionId()).snapshot().state.projectTrust?.status).toBe("undecided");
		expect(first.snapshot().state.projectTrust?.status).toBe("trusted");
	} finally {
		await registry.dispose();
	}
});
