/**
 * magpie community plugin providers (Cursor, WorkBuddy, ...) through magpie-pi's embedding API.
 *
 * Providers are backend-wide (one shared ModelRuntime), so the plugin host runs once per backend
 * instead of once per session as the pi extension would. `startMagpie()` also sets
 * MAGPIE_PI_EMBEDDED=1, which keeps a magpie-pi extension from the user's pi packages inactive in
 * Argon sessions. Plugin changes restart the host and re-register its providers (no pi restart).
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BunSource, PluginRuntimeStatus, PluginsStatus, SystemBunInfo } from "@argon/shared";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	BUN_VERSION,
	bunDownloadBase,
	bunReady,
	defaultState,
	findBun,
	type MagpieHost as Host,
	MIN_SYSTEM_BUN,
	PluginManager,
	prepareBun,
	startMagpie,
} from "magpie-pi/embed";
import { log } from "./log.ts";
import { RequestError } from "./request-error.ts";

const defaults = {
	findBun,
	startMagpie,
	bunReady,
	prepareBun,
	state: defaultState,
	env: process.env,
	manager: (state: string, mirror: string, bun?: string): Pick<PluginManager, "list" | "search" | "mutate"> =>
		new PluginManager(state, { mirror, bun }),
};

export class MagpieHost {
	private host: Host | undefined;
	private providerIds = new Set<string>();
	private readonly state: string;
	private readonly file: string;
	private readonly initialized: Promise<void>;
	private readonly deps: typeof defaults;
	private enabled = false;
	private source: BunSource = "managed";
	private systemBun?: SystemBunInfo;
	private managedPath?: string;
	private storedMirror = "github";
	private runtimeStatus: PluginRuntimeStatus = { state: "missing" };
	private restarting: Promise<void> = Promise.resolve();
	private generation = 0;

	constructor(
		private readonly runtime: Pick<ModelRuntime, "registerNativeProvider" | "unregisterProvider">,
		home: string,
		private readonly onStatus: (status: PluginsStatus) => void,
		private readonly providersChanged: () => void,
		deps: Partial<typeof defaults> = {},
	) {
		this.deps = { ...defaults, ...deps };
		this.state = this.deps.state();
		this.file = join(home, "plugins.json");
		this.initialized = this.initialize();
	}
	private get envMirror() {
		return this.deps.env.ARGON_BUN_MIRROR?.trim() || undefined;
	}
	private get mirror() {
		return this.envMirror ?? this.storedMirror;
	}
	private get override() {
		return this.deps.env.MAGPIE_PI_BUN || undefined;
	}
	private get systemError() {
		const bun = this.systemBun;
		if (!bun) return "No Bun found on the backend machine (looked in PATH, $BUN_INSTALL/bin and ~/.bun/bin)";
		if (!bun.compatible)
			return `Bun ${bun.version} at ${bun.path} is older than ${MIN_SYSTEM_BUN} (or not 1.x); install a newer Bun or download Bun ${BUN_VERSION} instead`;
		return undefined;
	}
	private get manager() {
		return this.deps.manager(
			this.state,
			this.mirror,
			this.override ?? (this.source === "system" ? this.systemBun?.path : this.managedPath),
		);
	}
	private get status(): PluginsStatus {
		return {
			enabled: this.enabled,
			bunSource: this.source,
			systemBun: this.systemBun,
			bunPathEnv: this.override,
			minSystemBunVersion: MIN_SYSTEM_BUN,
			bunMirror: this.storedMirror,
			bunMirrorEnv: this.envMirror,
			bunVersion: BUN_VERSION,
			runtime: this.runtimeStatus,
		};
	}
	private update(runtime: PluginRuntimeStatus) {
		this.runtimeStatus = runtime;
		this.onStatus(this.status);
	}
	private async initialize() {
		try {
			const prefs = JSON.parse(readFileSync(this.file, "utf8"));
			if (
				typeof prefs?.enabled !== "boolean" ||
				typeof prefs.bunMirror !== "string" ||
				(prefs.bunSource !== undefined && !["system", "managed"].includes(prefs.bunSource))
			)
				throw Error("Invalid plugin settings");
			if (!this.override && prefs.bunSource !== "system") bunDownloadBase(prefs.bunMirror);
			this.source = prefs.bunSource ?? "managed";
			this.enabled = prefs.enabled;
			this.storedMirror = prefs.bunMirror;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") log.warn(`Reading plugin settings: ${error}`);
			this.enabled = (await this.manager.list().catch(() => [])).length > 0;
		}
		try {
			await this.detect();
			if (this.override || this.source === "system") {
				this.update(this.installedStatus());
				return;
			}
			bunDownloadBase(this.mirror);
			this.update({ state: (await this.deps.bunReady({ state: this.state })) ? "ready" : "missing" });
		} catch (error) {
			this.fail(error);
		}
	}
	private async detect() {
		this.systemBun = await this.deps.findBun({ env: this.deps.env });
	}
	private installedStatus(): PluginRuntimeStatus {
		const error = !this.override && this.systemError;
		return error ? { state: "failed", error } : { state: "ready" };
	}
	private fail(error: unknown) {
		log.warn(`[magpie] ${error}`);
		this.update({ state: "failed", error: String(error) });
	}
	private persist(enabled: boolean, bunMirror: string, bunSource = this.source) {
		if (this.enabled === enabled && this.storedMirror === bunMirror && this.source === bunSource) return;
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${randomUUID()}`;
		try {
			writeFileSync(tmp, `${JSON.stringify({ enabled, bunMirror, bunSource }, null, 2)}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			renameSync(tmp, this.file);
		} finally {
			rmSync(tmp, { force: true });
		}
		this.source = bunSource;
		this.enabled = enabled;
		this.storedMirror = bunMirror;
		this.onStatus(this.status);
	}
	async enable(options: { bunMirror?: string; bunSource?: BunSource } | string = {}) {
		await this.initialized;
		const { bunMirror: mirror, bunSource = this.source } =
			typeof options === "string" ? { bunMirror: options } : options;
		if (bunSource !== "system" && bunSource !== "managed") throw new RequestError("bad_request", "Invalid Bun source");
		const switching = this.source !== bunSource && !this.override;
		if (!switching && this.enabled && this.runtimeStatus.state === "preparing") return this.status;
		let selected = this.storedMirror;
		if (!this.override && !this.envMirror && mirror !== undefined) {
			try {
				bunDownloadBase(mirror);
				selected = mirror.trim() || "github";
			} catch (error) {
				throw new RequestError("bad_request", String(error));
			}
		}
		if (!this.override && bunSource === "system") {
			await this.detect();
			if (this.systemError) throw new RequestError("bad_request", this.systemError);
		}
		this.persist(true, selected, bunSource);
		if (this.override || bunSource === "system") this.update(this.installedStatus());
		else if (switching) this.update({ state: "preparing" });
		if (!switching && this.host && this.runtimeStatus.state === "ready") return this.status;
		if (this.runtimeStatus.state !== "ready") this.update({ state: "preparing" });
		void this.start().catch((error) => this.fail(error));
		return this.status;
	}
	async disable() {
		await this.initialized;
		this.persist(false, this.storedMirror);
		// The host is not running while Bun is prepared; don't wait for the download to finish.
		const stopping = this.start();
		if (this.runtimeStatus.state === "preparing") void stopping.catch((error) => this.fail(error));
		else await stopping;
		return this.status;
	}

	get errors(): string[] {
		return this.host?.errors ?? [];
	}

	isPluginProvider(providerId: string): boolean {
		return this.providerIds.has(providerId);
	}

	private async prepare(mirror: string) {
		try {
			const base = bunDownloadBase(mirror);
			const downloading = !(await this.deps.bunReady({ state: this.state }));

			let last = -Infinity;
			let progress: { received: number; total?: number } | undefined;
			if (downloading) {
				log.info(`[magpie] preparing Bun from ${base}`);
				if (this.runtimeStatus.state !== "preparing") this.update({ state: "preparing" });
			}
			const bun = await this.deps.prepareBun({
				state: this.state,
				mirror,
				onProgress: (p) => {
					progress = p;
					const now = performance.now();
					if (now - last >= 250) {
						last = now;
						this.update({ state: "preparing", ...p });
					}
				},
			});
			if (progress && this.runtimeStatus.received !== progress.received)
				this.update({ state: "preparing", ...progress });
			if (downloading) log.info("[magpie] Bun preparation succeeded");
			if (this.runtimeStatus.state !== "ready") this.update({ state: "ready" });
			this.managedPath = bun;
			return bun;
		} catch (error) {
			this.fail(error);
			return undefined;
		}
	}

	/** Start (or restart) the plugin host and (re-)register its providers. */
	start(): Promise<void> {
		const generation = ++this.generation;
		this.restarting = this.restarting
			.catch((error) => log.warn(String(error)))
			.then(async () => {
				await this.initialized;
				if (generation !== this.generation) return;
				await this.stopHost();
				try {
					await this.detect();
					if (generation !== this.generation) return;
					const installed = this.override || this.source === "system";
					if (installed) this.update(this.installedStatus());
					if (!this.enabled) {
						if (this.runtimeStatus.state === "preparing")
							this.update({ state: (await this.deps.bunReady({ state: this.state })) ? "ready" : "missing" });
						return;
					}
					const mirror = this.mirror;
					if (installed && this.runtimeStatus.state !== "ready") return;
					const bun = installed ? (this.override ?? this.systemBun?.path) : await this.prepare(mirror);
					if (!bun) return;
					if (!this.enabled || generation !== this.generation) return;
					log.info(
						`[magpie] starting with Bun ${this.override ?? (installed ? `${bun} (${this.systemBun?.version})` : `managed ${BUN_VERSION}`)}`,
					);
					this.host = await this.deps.startMagpie({ state: this.state, bun, mirror });
					if (!this.enabled || generation !== this.generation) {
						await this.stopHost();
						return;
					}
				} catch (error) {
					log.warn(`magpie failed to start: ${error instanceof Error ? error.message : String(error)}`);
					return;
				}
				for (const message of this.host.errors) log.warn(`[magpie] ${message}`);
				for (const provider of this.host.providers) {
					try {
						// biome-ignore lint/suspicious/noExplicitAny: magpie returns pi provider definitions untyped
						this.runtime.registerNativeProvider(provider as any);
						this.providerIds.add(provider.id);
					} catch (error) {
						log.warn(`[magpie] could not register ${provider.id}: ${String(error)}`);
					}
				}
				this.providersChanged();
				if (this.providerIds.size > 0) log.info(`magpie providers: ${[...this.providerIds].join(", ")}`);
			});
		return this.restarting;
	}

	async list() {
		await this.initialized;
		if (!this.enabled) {
			await this.detect();
			if (!this.enabled && (this.override || this.source === "system")) this.runtimeStatus = this.installedStatus();
		}
		const plugins = await this.manager.list().catch(() => []);
		return {
			plugins: plugins.map((p) => ({ spec: p.spec ?? p.target ?? "?", managed: p.magpieManaged === true })),
			errors: this.errors,
			status: this.status,
		};
	}

	search(query: string) {
		return this.manager.search(query);
	}

	/** Install/remove (the client already asked the user), then restart the host to apply it. */
	async change(action: "install" | "remove", spec: string): Promise<string> {
		await this.initialized;
		if (
			!this.enabled ||
			this.runtimeStatus.state !== "ready" ||
			(!this.override && this.source === "system" && this.systemError)
		)
			throw new RequestError("bad_request", "Enable plugins and prepare Bun first");
		const message = await this.manager.mutate(action, spec, async () => true);
		if (message === "Cancelled") return message;
		await this.start();
		const failed = this.errors.length > 0;
		return failed
			? `Plugin ${action === "install" ? "installed" : "removed"}, but the plugin host reported: ${this.errors.join("; ")}`
			: `Plugin ${action === "install" ? "installed" : "removed"}.`;
	}

	async dispose(): Promise<void> {
		await this.restarting;
		await this.stopHost();
	}

	private async stopHost(): Promise<void> {
		for (const id of this.providerIds) this.runtime.unregisterProvider(id);
		this.providerIds.clear();
		const host = this.host;
		this.host = undefined;
		await host?.close().catch(() => undefined);
		if (host) this.providersChanged();
	}
}
