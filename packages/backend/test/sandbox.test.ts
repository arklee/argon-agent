import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionBroker } from "../src/interactions.ts";
import { ArgonSandbox, domainMatches, NetworkAttribution, runtimeConfig } from "../src/sandbox.ts";
import { canonicalPath, effectiveMode, SandboxPolicy, sandboxSupport } from "../src/sandbox-policy.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

const dirs: string[] = [];
function fixture() {
	const root = canonicalPath(mkdtempSync(join(tmpdir(), "argon-sandbox-")));
	dirs.push(root);
	const cwd = join(root, "project");
	const home = join(root, "home");
	const argon = join(home, ".argon");
	const temp = join(root, "temp");
	for (const dir of [cwd, argon, temp]) mkdirSync(dir, { recursive: true });
	return { root, cwd, home, argon, temp, policy: () => new SandboxPolicy(cwd, argon, home, [temp]) };
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

it("resolves nonexistent descendants and rejects symlink escapes, including dangling links", () => {
	const f = fixture();
	symlinkSync(f.home, join(f.cwd, "escape"));
	symlinkSync(join(f.home, "missing"), join(f.cwd, "broken"));
	const policy = f.policy();
	expect(policy.canWrite("new/sub/file")).toBe(true);
	expect(policy.canWrite(join(f.temp, "file"))).toBe(true);
	expect(policy.canWrite("../project-other/file")).toBe(false);
	expect(policy.canWrite("escape/file")).toBe(false);
	expect(policy.canWrite("broken/file")).toBe(false);
	expect(canonicalPath(join(f.cwd, "escape/new/file"))).toBe(join(f.home, "new/file"));
});

it("protects metadata, gitdir targets, shell configuration and secret paths", () => {
	const f = fixture();
	const gitdir = join(f.temp, "metadata");
	mkdirSync(gitdir);
	writeFileSync(join(f.cwd, ".git"), `gitdir: ${gitdir}\n`);
	symlinkSync(gitdir, join(f.cwd, "git-alias"));
	symlinkSync(f.argon, join(f.cwd, "secrets"));
	const policy = f.policy();
	for (const path of [
		".git",
		".argon/settings.json",
		".pi/settings.json",
		".mcp.json",
		"sub/.git/config",
		"sub/.GiT/config",
		"@.argon/settings.json",
		"git-alias/config",
		join(gitdir, "config"),
		join(f.home, ".zshrc"),
	])
		expect(policy.canWrite(path), path).toBe(false);
	for (const path of [
		"secrets/agent/auth.json",
		"~/.ssh/key",
		"~/.npmrc",
		"@~/.npmrc",
		`file://${f.home}/.npmrc`,
		"~/.pi/agent/auth.json",
		"~/.aws/credentials",
		"~/.docker/config.json",
	])
		expect(policy.canRead(path), path).toBe(false);
	expect(policy.canRead("src/index.ts")).toBe(true);
	expect(policy.canRead(f.home, true)).toBe(false);
	expect(policy.canRead(f.root, true)).toBe(false);
	expect(policy.canRead(f.cwd, true)).toBe(true);
	const config = runtimeConfig(policy);
	expect(config.filesystem.allowWrite).toContainEqual({ path: f.cwd, literal: true });
	expect(config.filesystem.denyWrite).toContain("/**/.git");
	expect(config.network.allowUnixSockets).toEqual([]);
});

it("keeps platform unavailability distinct from initialization failure", () => {
	for (const platform of ["win32", "linux"]) {
		expect(sandboxSupport(platform).supported).toBe(false);
		expect(effectiveMode("ask", sandboxSupport(platform))).toBe("auto");
	}
	expect(effectiveMode("ask", { ...sandboxSupport("darwin"), reason: "rg missing" })).toBe("ask");
});

it("migrates old settings and rejects ask on unsupported platforms", async () => {
	const { argon } = fixture();
	writeFileSync(join(argon, "settings.json"), JSON.stringify({ permissions: { defaultMode: "ask", rules: [] } }));
	const settings = new ArgonSettingsStore(argon, "ask", sandboxSupport("linux"));
	await settings.load();
	expect(settings.defaultPermissionMode).toBe("auto");
	expect(settings.get().permissions.defaultMode).toBe("auto");
	expect(settings.get().sandbox.allowedDomains).toEqual([]);
	await expect(settings.update({ permissions: { defaultMode: "ask", rules: [] } })).rejects.toThrow("Linux");
	await Promise.all([settings.addAllowedDomain("one.example"), settings.addAllowedDomain("two.example")]);
	expect(JSON.parse(readFileSync(join(argon, "settings.json"), "utf8")).sandbox.allowedDomains).toEqual([
		"one.example",
		"two.example",
	]);
	await expect(settings.update({ sandbox: { allowedDomains: ["*"] } })).rejects.toThrow();
});

function session(id: string, answer: "allow" | "allow_session" | "allow_always" | "deny" = "deny") {
	const requested = vi.fn();
	const broker = new InteractionBroker({
		onRequested(interaction) {
			requested(interaction);
			queueMicrotask(() => broker.respond(interaction.id, { decision: answer }));
		},
		onResolved() {},
	});
	return { id, broker, allowedDomains: new Set<string>(), requested };
}

it("attributes concurrent commands by session, with latest-start fallback", () => {
	const attribution = new NetworkAttribution();
	const a = session("a");
	const b = session("b");
	const endA = attribution.start({ session: a, toolCallId: "a1" });
	const endA2 = attribution.start({ session: a, toolCallId: "a2" });
	expect(attribution.select()).toMatchObject({ ambiguous: false, call: { toolCallId: "a2" } });
	const endB = attribution.start({ session: b, toolCallId: "b1" });
	expect(attribution.select()).toMatchObject({ ambiguous: true, call: { toolCallId: "b1" } });
	endA();
	endA2();
	endB();
	expect(attribution.select()).toMatchObject({ ambiguous: true, call: { toolCallId: "b1" } });
	attribution.forget("b");
	expect(attribution.select().call).toBeUndefined();
});

it("keeps host grants session-local, persists always, and denies cancellation", async () => {
	const { argon } = fixture();
	const settings = new ArgonSettingsStore(argon, undefined, sandboxSupport("darwin"));
	const sandbox = new ArgonSandbox(settings);
	const a = session("a", "allow_session");
	const end = sandbox.attribution.start({ session: a, toolCallId: "a1" });
	expect(await sandbox.askNetwork("example.com", 443)).toBe(true);
	expect(await sandbox.askNetwork("example.com", 443)).toBe(true);
	expect(a.requested).toHaveBeenCalledTimes(1);
	expect(a.requested.mock.calls[0]?.[0]).toMatchObject({
		kind: "network_access",
		host: "example.com",
		toolCallId: "a1",
	});
	end();
	const b = session("b");
	const endB = sandbox.attribution.start({ session: b, toolCallId: "b1" });
	expect(await sandbox.askNetwork("example.com", 443)).toBe(false);
	endB();
	const c = session("c", "allow_always");
	sandbox.attribution.start({ session: c, toolCallId: "c1" });
	expect(await sandbox.askNetwork("saved.example", 443)).toBe(true);
	expect(settings.get().sandbox.allowedDomains).toEqual(["saved.example"]);
	const abort = new AbortController();
	abort.abort();
	sandbox.attribution.start({ session: b, toolCallId: "cancel", signal: abort.signal });
	expect(await sandbox.askNetwork("other.example", 443)).toBe(false);
});

it("matches the runtime's strict subdomain and port semantics", () => {
	expect(domainMatches("x.example.com", "*.example.com")).toBe(true);
	expect(domainMatches("example.com", "*.example.com")).toBe(false);
	expect(domainMatches("example.com", "example.com:8443", 443)).toBe(false);
	expect(domainMatches("example.com", "example.com:8443", 8443)).toBe(true);
});

describe("macOS Seatbelt integration (opt in outside an enclosing OS sandbox)", () => {
	it.skipIf(process.platform !== "darwin" || process.env.ARGON_SANDBOX_INTEGRATION !== "1")(
		"enforces writes and read-deny and asks for network",
		async () => {
			const f = fixture();
			const settings = new ArgonSettingsStore(f.argon);
			const sandbox = new ArgonSandbox(settings);
			const owner = session("integration");
			writeFileSync(join(f.argon, "secret"), "fixture-secret");
			const operations = sandbox.operations({ session: owner, toolCallId: "integration" });
			async function run(command: string) {
				let output = "";
				const result = await operations.exec(command, f.cwd, {
					onData: (data) => {
						output += data.toString();
					},
					timeout: 15,
				});
				return { ...result, output };
			}
			try {
				expect((await run("touch ./x")).exitCode).toBe(0);
				const denied = await run('touch "$HOME/argon-sbx-test"');
				expect(denied.exitCode).not.toBe(0);
				expect(denied.output).toMatch(/sandbox/i);
				expect((await run(`cat '${join(f.argon, "secret")}'`)).exitCode).not.toBe(0);
				await run("curl -sI --max-time 10 https://example.com");
				expect(owner.requested).toHaveBeenCalledWith(
					expect.objectContaining({ kind: "network_access", host: "example.com" }),
				);
			} finally {
				await sandbox.dispose();
			}
		},
		60_000,
	);
});

it("rejects unsupported ask updates as protocol bad_request before touching a session", async () => {
	const { createHandlers } = await import("../src/server.ts");
	const { argon } = fixture();
	const { loadConfig } = await import("../src/config.ts");
	const config = loadConfig({ ARGON_HOME: argon });
	config.environment.sandbox = sandboxSupport("linux");
	const handlers = createHandlers({} as Parameters<typeof createHandlers>[0], config);
	await expect(
		handlers["sessions.setPermissionMode"]({ sessionId: "test", mode: "ask" }, {} as never),
	).rejects.toMatchObject({ code: "bad_request" });
	await expect(
		handlers["settings.update"]({ argon: { permissions: { defaultMode: "ask", rules: [] } } }, {} as never),
	).rejects.toMatchObject({ code: "bad_request" });
});
