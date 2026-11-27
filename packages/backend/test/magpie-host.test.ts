import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginsStatus } from "@argon/shared";
import type { findBun, prepareBun } from "magpie-pi/embed";
import { afterEach, expect, it, vi } from "vitest";
import { MagpieHost } from "../src/magpie-host.ts";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup(plugins: string[] = [], env: NodeJS.ProcessEnv = {}, prefs?: object) {
	const home = mkdtempSync(join(tmpdir(), "argon-plugins-"));
	homes.push(home);
	if (prefs) writeFileSync(join(home, "plugins.json"), JSON.stringify(prefs));
	const state = join(home, "magpie");
	const statuses: PluginsStatus[] = [];
	const runtime = { registerNativeProvider: vi.fn(), unregisterProvider: vi.fn() };
	const close = vi.fn(async () => {});
	const startMagpie = vi.fn(async () => ({
		state,
		configPath: "",
		providers: [{ id: "fixture", name: "Fixture" }],
		errors: [],
		close,
	}));
	const prepare = vi.fn<typeof prepareBun>(async () => "fixture-bun");
	const detect = vi.fn<typeof findBun>(async () => undefined);
	const manager = vi.fn(() => ({
		list: async () => plugins.map((spec) => ({ spec })),
		mutate: vi.fn(),
		search: vi.fn(),
	}));
	const host = new MagpieHost(runtime, home, (s) => statuses.push(s), vi.fn(), {
		state: () => state,
		env,
		bunReady: async () => false,
		prepareBun: prepare,
		startMagpie,
		manager,
		findBun: detect,
	});
	return {
		detect,
		manager,
		host,
		state,
		file: join(home, "plugins.json"),
		statuses,
		startMagpie,
		prepare,
		close,
		runtime,
	};
}

it.each([false, true])("migrates configured plugins (enabled=%s) without writing", async (enabled) => {
	const { host, file } = setup(enabled ? ["cursor"] : []);
	expect((await host.list()).status).toMatchObject({ enabled, bunMirror: "github", runtime: { state: "missing" } });
	expect(existsSync(file)).toBe(false);
});

it("enables, reports first and final bytes, registers and disables", async () => {
	const { host, state, file, statuses, startMagpie, prepare, close, runtime } = setup();
	await expect(host.change("install", "cursor")).rejects.toMatchObject({ code: "bad_request" });
	await expect(host.enable("invalid")).rejects.toMatchObject({ code: "bad_request" });
	prepare.mockImplementationOnce(async (options) => {
		for (const received of [1, 2, 3]) options?.onProgress?.({ received, total: 3 });
		return "fixture-bun";
	});
	expect((await host.enable("npmmirror")).runtime.state).toBe("preparing");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
		enabled: true,
		bunSource: "managed",
		bunMirror: "npmmirror",
	});
	await vi.waitFor(() => expect(runtime.registerNativeProvider).toHaveBeenCalledTimes(1));
	expect(startMagpie).toHaveBeenCalledWith({ state, mirror: "npmmirror", bun: "fixture-bun" });
	expect(statuses.flatMap((s) => s.runtime.received ?? [])).toEqual([1, 3]);
	expect((await host.list()).status.runtime.state).toBe("ready");
	expect((await host.disable()).enabled).toBe(false);
	expect(close).toHaveBeenCalledOnce();
	expect(runtime.unregisterProvider).toHaveBeenCalledWith("fixture");
});

it("keeps the failed URL and retries using the new mirror", async () => {
	const { host, prepare, startMagpie } = setup();
	prepare.mockRejectedValueOnce(Error("download https://example.org/bun failed"));
	await host.enable();
	await vi.waitFor(async () =>
		expect((await host.list()).status.runtime).toMatchObject({
			state: "failed",
			error: expect.stringContaining("https://example.org/bun"),
		}),
	);
	await host.enable("npmmirror-cdn");
	await vi.waitFor(() => expect(startMagpie).toHaveBeenCalledOnce());
	expect(prepare.mock.lastCall?.[0]?.mirror).toBe("npmmirror-cdn");
});

it("uses the environment mirror and prevents late host startup", async () => {
	const { host, prepare, startMagpie } = setup([], { ARGON_BUN_MIRROR: " npmmirror " });
	let finish!: (bun: string) => void;
	prepare.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	expect(await host.enable("invalid")).toMatchObject({ bunMirror: "github", bunMirrorEnv: "npmmirror" });
	await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
	expect(prepare.mock.lastCall?.[0]?.mirror).toBe("npmmirror");
	await host.enable();
	await expect(host.change("remove", "cursor")).rejects.toMatchObject({ code: "bad_request" });
	// Disabling doesn't wait for the download; it finishes in the background and stays cached.
	expect(await host.disable()).toMatchObject({ enabled: false, runtime: { state: "preparing" } });
	finish("fixture-bun");
	await vi.waitFor(async () => expect((await host.list()).status.runtime.state).toBe("ready"));
	expect(prepare).toHaveBeenCalledOnce();
	expect(startMagpie).not.toHaveBeenCalled();
});

it("surfaces an invalid backend mirror without starting magpie", async () => {
	const { host, prepare } = setup(["cursor"], { ARGON_BUN_MIRROR: "invalid" });
	await host.start();
	expect((await host.list()).status.runtime.state).toBe("failed");
	expect(prepare).not.toHaveBeenCalled();
});

const system = { path: "/opt/bun", version: "1.3.14", compatible: true };
it("offers a newly installed Bun without changing old preferences", async () => {
	const { host, detect } = setup([], {}, { enabled: false, bunMirror: "github" });
	expect((await host.list()).status.systemBun).toBeUndefined();
	detect.mockResolvedValue(system);
	expect((await host.list()).status).toMatchObject({
		systemBun: system,
		bunSource: "managed",
		minSystemBunVersion: "1.3.14",
	});
});
it.each([undefined, { ...system, compatible: false, version: "1.2.0" }])(
	"rejects unusable system Bun before persisting",
	async (bun) => {
		const { host, detect, file, prepare } = setup();
		detect.mockResolvedValue(bun);
		await expect(host.enable({ bunSource: "system" })).rejects.toMatchObject({
			code: "bad_request",
			message: expect.stringContaining(bun ? bun.version : "No Bun found"),
		});
		expect(existsSync(file)).toBe(false);
		expect(prepare).not.toHaveBeenCalled();
	},
);
it("uses system Bun for host and manager until explicitly switched", async () => {
	const { host, detect, state, startMagpie, manager, prepare, close } = setup();
	detect.mockResolvedValue(system);
	expect((await host.enable({ bunSource: "system" })).runtime.state).toBe("ready");
	await vi.waitFor(() => expect(startMagpie).toHaveBeenCalledWith({ state, bun: system.path, mirror: "github" }));
	await host.list();
	expect(manager).toHaveBeenLastCalledWith(state, "github", system.path);
	detect.mockResolvedValue(undefined);
	await host.start();
	expect(close).toHaveBeenCalledOnce();
	expect((await host.list()).status.runtime).toMatchObject({
		state: "failed",
		error: expect.stringContaining("No Bun found"),
	});
	expect(prepare).not.toHaveBeenCalled();
	expect(startMagpie).toHaveBeenCalledTimes(1);
	await host.enable({ bunSource: "managed" });
	await vi.waitFor(() => expect(startMagpie).toHaveBeenCalledWith({ state, bun: "fixture-bun", mirror: "github" }));
	expect(prepare).toHaveBeenCalledOnce();
});
it("uses the pinned executable independently of source and mirror", async () => {
	const { host, startMagpie, prepare } = setup([], { MAGPIE_PI_BUN: "/pinned", ARGON_BUN_MIRROR: "invalid" });
	expect(await host.enable({ bunSource: "system" })).toMatchObject({
		bunPathEnv: "/pinned",
		runtime: { state: "ready" },
	});
	await vi.waitFor(() => expect(startMagpie).toHaveBeenCalledWith(expect.objectContaining({ bun: "/pinned" })));
	expect(prepare).not.toHaveBeenCalled();
});
