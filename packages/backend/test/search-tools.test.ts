import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchTools, type SearchToolsManifest } from "../src/search-tools.ts";
import { downloadTool, mirrorUrl, sha256, toolsMirror } from "../src/search-tools-transfer.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const bytes = Buffer.from("pinned test binary");
async function fixture(
	options: { env?: NodeJS.ProcessEnv; system?: boolean; hash?: string; fetcher?: typeof fetch } = {},
) {
	const root = await mkdtemp(join(tmpdir(), "argon-search-test-"));
	roots.push(root);
	const agent = join(root, "agent");
	const manifest: SearchToolsManifest = { rg: {}, fd: {} };
	for (const tool of ["rg", "fd"] as const)
		manifest[tool]["darwin-arm64"] = {
			version: "1",
			sources: {
				github: { url: `https://github.com/test/${tool}.tar.gz`, sha256: options.hash ?? sha256(bytes) },
				npmmirror: { url: `https://registry.npmmirror.com/${tool}.tgz`, sha256: sha256(bytes) },
			},
		};
	const reset = vi.fn();
	const emit = vi.fn();
	const fetcher = options.fetcher ?? vi.fn<typeof fetch>();
	const manager = new SearchTools(root, agent, emit, {
		manifest,
		platform: "darwin-arm64",
		env: options.env ?? {},
		resetFdCache: reset,
		fetch: fetcher,
		getToolPath: async (tool) =>
			existsSync(join(agent, "bin", tool)) ? join(agent, "bin", tool) : options.system ? tool : null,
	});
	return { root, agent, manifest, manager, reset, emit, fetcher };
}
async function archive(root: string, tool = "fd") {
	const nested = join(root, "package", "bin");
	await mkdir(nested, { recursive: true });
	await writeFile(join(nested, tool), bytes);
	const path = join(root, "asset.tgz");
	execFileSync("tar", ["-czf", path, "-C", root, "package"]);
	return readFile(path);
}

describe("search tools", () => {
	it("validates and rewrites mirrors without changing release paths", () => {
		expect(mirrorUrl("https://github.com/a/b", "https://proxy.example/https://github.com/")).toBe(
			"https://proxy.example/https://github.com/a/b",
		);
		for (const invalid of [
			"http://example.com",
			"https://user:pass@example.com",
			"https://example.com/?x=1",
			"https://example.com/#x",
			"latest",
			"",
		])
			expect(() => toolsMirror(invalid)).toThrow();
		expect(toolsMirror(" npmmirror ")).toBe("npmmirror");
	});
	it("persists a mirror atomically and lets env ignore the request override", async () => {
		const f = await fixture({ env: { ARGON_TOOLS_MIRROR: "npmmirror" } });
		expect((await f.manager.install({ mirror: "invalid", tools: [] })).mirrorEnv).toBe("npmmirror");
		expect(existsSync(join(f.root, "search-tools.json"))).toBe(false);
		const g = await fixture();
		await g.manager.install({ mirror: "https://proxy.example/", tools: [] });
		expect(JSON.parse(await readFile(join(g.root, "search-tools.json"), "utf8"))).toEqual({
			mirror: "https://proxy.example",
		});
	});
	it("uploads a bare binary, replaces managed copies, and resets cached fd lookup", async () => {
		const f = await fixture();
		await f.manager.upload("fd", "fd", bytes.toString("base64"));
		await writeFile(join(f.agent, "bin", "fd"), "old copy");
		const status = await f.manager.upload("fd", "fd", bytes.toString("base64"));
		expect(status.tools[1]).toMatchObject({ state: "ready", source: "managed" });
		expect(await readFile(join(f.agent, "bin", "fd"))).toEqual(bytes);
		expect(f.reset).toHaveBeenCalledWith(f.agent);
		expect(f.emit).toHaveBeenCalled();
		expect(existsSync(join(f.root, "uploads"))).toBe(false);
	});
	it("uploads a nested archive and accepts either pinned source hash", async () => {
		const f = await fixture({ hash: "0".repeat(64) });
		await f.manager.upload("fd", "offline.tgz", (await archive(f.root)).toString("base64"));
		expect(await readFile(join(f.agent, "bin", "fd"))).toEqual(bytes);
	});
	it("rejects mismatched uploads with expected filenames, preserving existing binary", async () => {
		const f = await fixture();
		await f.manager.upload("fd", "fd", bytes.toString("base64"));
		await expect(f.manager.upload("fd", "fd", Buffer.from("tampered").toString("base64"))).rejects.toMatchObject({
			code: "bad_request",
			message: expect.stringContaining("fd.tar.gz"),
		});
		expect(await readFile(join(f.agent, "bin", "fd"))).toEqual(bytes);
		await expect(f.manager.upload("fd", "fd", "!!!!")).rejects.toThrow("base64");
	});
	it("never downloads or replaces a ready system or managed tool", async () => {
		const f = await fixture({ system: true });
		await f.manager.install();
		await f.manager.whenIdle();
		expect(f.fetcher).not.toHaveBeenCalled();
		const g = await fixture();
		await g.manager.upload("fd", "fd", bytes.toString("base64"));
		await g.manager.install({ tools: ["fd"] });
		await g.manager.whenIdle();
		expect(g.fetcher).not.toHaveBeenCalled();
	});
	it("coalesces concurrent installs and verifies downloaded binary", async () => {
		const f = await fixture();
		const tarball = await archive(f.root);
		vi.mocked(f.fetcher).mockImplementation(async () => new Response(tarball));
		await Promise.all([f.manager.install({ tools: ["fd"] }), f.manager.install({ tools: ["fd"] })]);
		await f.manager.whenIdle();
		expect(f.fetcher).toHaveBeenCalledTimes(1);
		expect((await f.manager.status()).tools[1]).toMatchObject({ state: "ready", source: "managed" });
	});
	it("fails a download hash mismatch with its URL and does not fall back", async () => {
		const f = await fixture({ hash: "0".repeat(64) });
		const tarball = await archive(f.root);
		vi.mocked(f.fetcher).mockImplementation(async () => new Response(tarball));
		await f.manager.install({ tools: ["fd"] });
		await f.manager.whenIdle();
		expect((await f.manager.status()).tools[1]).toMatchObject({
			state: "failed",
			error: expect.stringContaining("https://github.com/test/fd.tar.gz"),
		});
		expect(f.fetcher).toHaveBeenCalledTimes(1);
		expect(existsSync(join(f.agent, "bin", "fd"))).toBe(false);
	});
	it("copies valid bundles despite PATH and skips bad hashes", async () => {
		const f = await fixture({ system: true });
		const bundled = join(f.root, "bundle");
		await mkdir(bundled);
		await writeFile(join(bundled, "fd"), bytes);
		await writeFile(join(bundled, "rg"), "bad");
		const manager = new SearchTools(f.root, f.agent, f.emit, {
			manifest: f.manifest,
			platform: "darwin-arm64",
			env: { ARGON_BUNDLED_TOOLS: bundled },
			getToolPath: async (tool) => (existsSync(join(f.agent, "bin", tool)) ? join(f.agent, "bin", tool) : tool),
		});
		await manager.start();
		expect(existsSync(join(f.agent, "bin", "rg"))).toBe(false);
		expect(await readFile(join(f.agent, "bin", "fd"))).toEqual(bytes);
		await writeFile(join(bundled, "fd"), "changed source");
		expect(await readFile(join(f.agent, "bin", "fd"))).toEqual(bytes);
	});
	it("reports unsupported platforms without a fallback architecture", async () => {
		const f = await fixture();
		const manager = new SearchTools(f.root, f.agent, f.emit, {
			manifest: f.manifest,
			platform: "linux-riscv64",
			getToolPath: async () => null,
		});
		expect(await manager.status()).toMatchObject({
			supported: false,
			tools: [
				{ version: "1", downloads: [] },
				{ version: "1", downloads: [] },
			],
		});
	});
	it("caps streamed downloads even when Content-Length is absent", async () => {
		const f = await fixture();
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(40 * 1024 * 1024 + 1));
						controller.close();
					},
				}),
			),
		);
		await expect(downloadTool("https://example.com/fd", join(f.root, "download"), undefined, fetcher)).rejects.toThrow(
			"exceeds 40 MiB",
		);
	});
});
