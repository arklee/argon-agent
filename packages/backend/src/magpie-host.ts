/**
 * magpie community plugin providers (Cursor, WorkBuddy, ...) through magpie-pi's embedding API.
 *
 * Providers are backend-wide (one shared ModelRuntime), so the plugin host runs once per backend
 * instead of once per session as the pi extension would. `startMagpie()` also sets
 * MAGPIE_PI_EMBEDDED=1, which keeps a magpie-pi extension from the user's pi packages inactive in
 * Argon sessions. Plugin changes restart the host and re-register its providers (no pi restart).
 */

import type { PluginInfo } from "@argon/shared";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { defaultState, type MagpieHost as Host, PluginManager, startMagpie } from "magpie-pi/embed";
import { log } from "./log.ts";

export class MagpieHost {
	private host: Host | undefined;
	private providerIds = new Set<string>();
	private readonly manager: PluginManager;
	private readonly state: string;
	private restarting: Promise<void> = Promise.resolve();

	constructor(private readonly runtime: ModelRuntime) {
		this.state = defaultState();
		this.manager = new PluginManager(this.state);
	}

	get errors(): string[] {
		return this.host?.errors ?? [];
	}

	isPluginProvider(providerId: string): boolean {
		return this.providerIds.has(providerId);
	}

	/** Start (or restart) the plugin host and (re-)register its providers. */
	start(): Promise<void> {
		this.restarting = this.restarting.then(async () => {
			await this.stopHost();
			try {
				this.host = await startMagpie({ state: this.state });
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
			if (this.providerIds.size > 0) log.info(`magpie providers: ${[...this.providerIds].join(", ")}`);
		});
		return this.restarting;
	}

	async list(): Promise<{ plugins: PluginInfo[]; errors: string[] }> {
		const plugins = await this.manager.list().catch(() => []);
		return {
			plugins: plugins.map((p) => ({ spec: p.spec ?? p.target ?? "?", managed: p.magpieManaged === true })),
			errors: this.errors,
		};
	}

	search(query: string) {
		return this.manager.search(query);
	}

	/** Install/remove (the client already asked the user), then restart the host to apply it. */
	async change(action: "install" | "remove", spec: string): Promise<string> {
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
	}
}
