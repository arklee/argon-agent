import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { SearchToolName, SearchToolStatus, SearchToolsStatus } from "@argon/shared";
import { resetFdCache } from "./file-completion.ts";
import { log } from "./log.ts";
import { RequestError } from "./request-error.ts";
import pinned from "./search-tools-manifest.json" with { type: "json" };
import {
	downloadTool,
	errorChain,
	extractTool,
	fileHash,
	MAX_TOOL_BYTES,
	mirrorUrl,
	toolsMirror,
} from "./search-tools-transfer.ts";

export interface SearchToolBuild {
	version: string;
	// null is an unverified maintainer candidate and MUST fail closed until the manifest script runs.
	sources: Partial<Record<"github" | "npmmirror", { url: string; sha256: string | null }>>;
}
export type SearchToolsManifest = Record<SearchToolName, Record<string, SearchToolBuild>>;
export const searchToolsManifest: SearchToolsManifest = pinned;
const names: SearchToolName[] = ["rg", "fd"];
const defaults = {
	env: process.env,
	platform: `${process.platform}-${process.arch}`,
	manifest: searchToolsManifest,
	fetch: globalThis.fetch,
	resetFdCache,
	async getToolPath(tool: SearchToolName): Promise<string | null> {
		const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
		const manager = (await import(new URL("./utils/tools-manager.js", entry).href)) as {
			getToolPath(tool: SearchToolName): string | null;
		};
		return manager.getToolPath(tool);
	},
};
export class SearchTools {
	private readonly deps: typeof defaults;
	private readonly active = new Map<SearchToolName, Promise<void>>();
	private readonly states = new Map<SearchToolName, Partial<SearchToolStatus>>();
	/** Last PATH / agent-bin probe; pi's getToolPath spawns `<tool> --version`, so progress events reuse it. */
	private readonly found = new Map<SearchToolName, Partial<SearchToolStatus> | undefined>();
	private storedMirror = "github";
	private readonly bin: string;
	private readonly prefs: string;
	private starting?: Promise<void>;
	constructor(
		private readonly home: string,
		private readonly agentDir: string,
		private readonly onStatus: (status: SearchToolsStatus) => void,
		deps: Partial<typeof defaults> = {},
	) {
		this.deps = { ...defaults, ...deps };
		this.bin = join(agentDir, "bin");
		this.prefs = join(home, "search-tools.json");
		try {
			this.storedMirror = toolsMirror(JSON.parse(readFileSync(this.prefs, "utf8")).mirror);
		} catch (error) {
			if (existsSync(this.prefs)) log.warn("Cannot load search tools preferences", error);
		}
	}
	private get mirrorEnv() {
		return this.deps.env.ARGON_TOOLS_MIRROR?.trim() || undefined;
	}
	private get mirror() {
		return this.mirrorEnv ?? this.storedMirror;
	}
	private build(tool: SearchToolName) {
		return this.deps.manifest[tool][this.deps.platform];
	}
	private binary(tool: SearchToolName) {
		return tool + (this.deps.platform.startsWith("win32-") ? ".exe" : "");
	}
	private validTool(tool: SearchToolName) {
		if (!names.includes(tool)) throw new RequestError("bad_request", "Unknown search tool");
	}
	private async ready(tool: SearchToolName, fresh = true): Promise<Partial<SearchToolStatus> | undefined> {
		if (!fresh && this.found.has(tool)) return this.found.get(tool);
		const path = await this.deps.getToolPath(tool);
		const result = path ? this.located(path) : undefined;
		this.found.set(tool, result);
		return result;
	}
	private located(path: string): Partial<SearchToolStatus> {
		const rel = relative(this.bin, path);
		const managed =
			isAbsolute(path) &&
			!isAbsolute(rel) &&
			rel !== ".." &&
			!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
		return { state: "ready", source: managed ? "managed" : "system", path };
	}
	/** `fresh: false` reuses the last probe (for progress events). */
	async status(fresh = true): Promise<SearchToolsStatus> {
		return {
			platform: this.deps.platform,
			supported: names.some((tool) => !!this.build(tool)),
			mirror: this.mirror,
			mirrorEnv: this.mirrorEnv,
			tools: await Promise.all(
				names.map(async (tool): Promise<SearchToolStatus> => {
					const build = this.build(tool);
					return {
						tool,
						version: build?.version ?? Object.values(this.deps.manifest[tool])[0]?.version ?? "unknown",
						state: "missing",
						...this.states.get(tool),
						...(await this.ready(tool, fresh)),
						downloads: Object.entries(build?.sources ?? {}).map(([source, asset]) => ({
							source: source as "github" | "npmmirror",
							url: asset.url,
							fileName: basename(new URL(asset.url).pathname),
						})),
					};
				}),
			),
		};
	}
	private async emit() {
		this.onStatus(await this.status(false));
	}
	private async success(tool: SearchToolName) {
		this.states.delete(tool);
		this.found.delete(tool);
		this.deps.resetFdCache(this.agentDir);
		await this.emit();
	}
	private lock(tool: SearchToolName, action: () => Promise<void>): Promise<void> {
		const existing = this.active.get(tool);
		if (existing) return existing;
		const work = Promise.resolve()
			.then(action)
			.finally(() => this.active.delete(tool));
		this.active.set(tool, work);
		return work;
	}
	private async temporary(action: (directory: string) => Promise<void>) {
		await mkdir(this.bin, { recursive: true });
		const dir = await mkdtemp(join(this.bin, ".search-tool-"));
		try {
			await action(dir);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
	private async publish(tool: SearchToolName, binary: string) {
		await chmod(binary, 0o755);
		await rename(binary, join(this.bin, this.binary(tool)));
		await this.success(tool);
	}
	async install(params: { mirror?: string; tools?: SearchToolName[] } = {}): Promise<SearchToolsStatus> {
		const selected = params.tools ?? names;
		if (!Array.isArray(selected)) throw new RequestError("bad_request", "tools must be an array");
		for (const tool of selected) this.validTool(tool);
		// Like Bun preferences, an environment override ignores the request's mirror and never persists it.
		if (params.mirror !== undefined && !this.mirrorEnv) {
			let mirror: string;
			try {
				mirror = toolsMirror(params.mirror);
			} catch (error) {
				throw new RequestError("bad_request", String(error));
			}
			await mkdir(this.home, { recursive: true });
			const tmp = `${this.prefs}.${randomUUID()}.tmp`;
			try {
				await writeFile(tmp, `${JSON.stringify({ mirror })}\n`, { mode: 0o600 });
				await rename(tmp, this.prefs);
			} finally {
				await rm(tmp, { force: true });
			}
			this.storedMirror = mirror;
		}
		const mirror = this.mirror;
		// Runs in the background: progress and the outcome arrive as tools_status events.
		for (const tool of selected)
			void this.lock(tool, () => this.download(tool, mirror)).catch((error) => log.warn("Search tool install", error));
		return this.status(false);
	}
	private async download(tool: SearchToolName, mirror: string) {
		if (await this.ready(tool)) return;
		let url = "";
		try {
			const source = mirror === "npmmirror" ? "npmmirror" : "github";
			const asset = this.build(tool)?.sources[source];
			if (!asset) throw new Error(`No ${source} asset for ${tool} on ${this.deps.platform}`);
			url = source === "github" ? mirrorUrl(asset.url, mirror) : asset.url;
			if (!asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256))
				throw new Error("Manifest binary hash has not been verified; run scripts/search-tools-manifest.mjs");
			this.states.set(tool, { state: "downloading", received: 0 });
			await this.emit();
			await this.temporary(async (dir) => {
				const archive = join(dir, "archive");
				const binary = join(dir, "binary");
				await downloadTool(
					url,
					archive,
					(received, total) => {
						this.states.set(tool, { state: "downloading", received, total });
						void this.emit().catch((error) => log.warn("Search tool progress", error));
					},
					this.deps.fetch,
				);
				await extractTool(archive, basename(new URL(asset.url).pathname), this.binary(tool), binary);
				if ((await fileHash(binary)) !== asset.sha256) throw new Error("SHA-256 mismatch");
				// A system install or pi's last-resort download may have completed in the meantime.
				if (await this.ready(tool)) {
					this.states.delete(tool);
					return;
				}
				await this.publish(tool, binary);
			});
		} catch (error) {
			const detail = errorChain(error);
			const message = url && detail.startsWith(url) ? detail : `${url || `source ${mirror}`}: ${detail}`;
			this.states.set(tool, { state: "failed", error: message });
			log.warn(`Search tool ${tool}: ${message}`);
			await this.emit();
		}
	}
	async upload(tool: SearchToolName, name: string, data: string): Promise<SearchToolsStatus> {
		this.validTool(tool);
		if (
			typeof name !== "string" ||
			typeof data !== "string" ||
			data.length > Math.ceil(MAX_TOOL_BYTES / 3) * 4 ||
			data.length % 4 !== 0 ||
			!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
		)
			throw new RequestError("bad_request", "Expected base64 data, at most 40 MiB");
		const bytes = Buffer.from(data, "base64");
		if (!bytes.length || bytes.length > MAX_TOOL_BYTES)
			throw new RequestError("bad_request", "Expected binary data, at most 40 MiB");
		// Wait for a download, then acquire the same lock: an upload must not silently turn into a download.
		while (this.active.has(tool)) await this.active.get(tool)?.catch(() => undefined);
		await this.lock(tool, async () => {
			try {
				await this.temporary(async (dir) => {
					const archive = join(dir, "upload");
					const binary = join(dir, "binary");
					await writeFile(archive, bytes, { mode: 0o600 });
					await extractTool(archive, name, this.binary(tool), binary);
					if (!this.accepts(tool, await fileHash(binary))) throw new Error("SHA-256 mismatch");
					await this.publish(tool, binary);
				});
			} catch (error) {
				const expected = Object.values(this.build(tool)?.sources ?? {})
					.map((asset) => basename(new URL(asset.url).pathname))
					.join(", ");
				throw new RequestError(
					"bad_request",
					`${error instanceof Error ? error.message : String(error)}. Expected a file from: ${expected || "no supported build"}`,
				);
			}
		});
		return this.status();
	}
	/** Resolves once no download, upload or bundled copy is running (tests, smoke). */
	async whenIdle(): Promise<void> {
		while (this.active.size) await Promise.allSettled([...this.active.values()]);
	}
	private accepts(tool: SearchToolName, hash: string) {
		return Object.values(this.build(tool)?.sources ?? {}).some((asset) => asset.sha256 === hash);
	}
	start(): Promise<void> {
		this.starting ??= this.startOnce();
		return this.starting;
	}
	private async startOnce() {
		const bundled = this.deps.env.ARGON_BUNDLED_TOOLS;
		if (bundled)
			await Promise.all(
				names.map((tool) =>
					this.lock(tool, async () => {
						const source = join(bundled, this.binary(tool));
						if (!existsSync(source) || existsSync(join(this.bin, this.binary(tool)))) return;
						try {
							await this.temporary(async (dir) => {
								const binary = join(dir, "binary");
								await copyFile(source, binary);
								if (!this.accepts(tool, await fileHash(binary))) throw new Error("Bundled binary SHA-256 mismatch");
								if (!existsSync(join(this.bin, this.binary(tool)))) await this.publish(tool, binary);
							});
						} catch (error) {
							log.warn(`Skipping bundled ${source}`, error);
						}
					}),
				),
			);
		await this.install();
	}
}
