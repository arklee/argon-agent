/**
 * Provider accounts: listing providers with their auth state, and interactive login/logout through
 * pi's ModelRuntime (credentials land in auth.json, shared with the pi CLI).
 *
 * pi drives a login through an `AuthInteraction` (prompt/notify). Here every prompt becomes part of
 * a backend-owned `AuthFlow` broadcast to all clients, so a login survives client reconnects and any
 * client can answer it, like session interactions. Covers built-in API-key/OAuth providers and
 * plugin providers (magpie) alike.
 */

import { randomUUID } from "node:crypto";
import type { AuthFlow, AuthFlowEvent, AuthPromptInfo, AuthType, ProviderInfo } from "@argon/shared";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { log } from "./log.ts";
import { isBuiltinProvider, type ModelsConfigStore } from "./models-config.ts";

const FINISHED_FLOW_TTL_MS = 10 * 60_000;
const MAX_EVENTS = 20;

type LoginInteraction = Parameters<ModelRuntime["login"]>[2];
type PiAuthPrompt = Parameters<LoginInteraction["prompt"]>[0];
type PiAuthEvent = Parameters<LoginInteraction["notify"]>[0];

interface FlowEntry {
	flow: AuthFlow;
	controller: AbortController;
	answer?: { promptId: string; resolve: (value: string) => void; reject: (error: Error) => void };
}

export class AuthFlows {
	private readonly flows = new Map<string, FlowEntry>();

	constructor(
		private readonly runtime: ModelRuntime,
		private readonly onFlow: (flow: AuthFlow) => void,
		private readonly onProvidersChanged: () => void,
		private readonly isPluginProvider: (providerId: string) => boolean,
		private readonly modelsConfig: ModelsConfigStore,
	) {}

	async listProviders(): Promise<ProviderInfo[]> {
		const configs = await this.modelsConfig.providerConfigs();
		const available = this.runtime.getAvailableSnapshot();
		return this.runtime
			.getProviders()
			.map((provider): ProviderInfo => {
				const config = configs.get(provider.id);
				const status = this.runtime.getProviderAuthStatus(provider.id);
				const methods: ProviderInfo["methods"] = [];
				if (provider.auth.oauth) {
					methods.push({
						type: "oauth",
						name: provider.auth.oauth.name,
						label: provider.auth.oauth.loginLabel,
						subscription: provider.auth.oauth.isSubscription,
					});
				}
				if (provider.auth.apiKey?.login) methods.push({ type: "api_key", name: provider.auth.apiKey.name });
				return {
					id: provider.id,
					name: provider.name,
					origin: this.isPluginProvider(provider.id)
						? "plugin"
						: config && !isBuiltinProvider(provider.id)
							? "custom"
							: "builtin",
					config,
					auth: { configured: status.configured, source: status.source, label: status.label },
					stored:
						status.source === "stored" ? (this.runtime.isUsingOAuth(provider.id) ? "oauth" : "api_key") : undefined,
					methods,
					modelCount: available.filter((model) => model.provider === provider.id).length,
				};
			})
			.sort((a, b) => Number(b.auth.configured) - Number(a.auth.configured) || a.name.localeCompare(b.name));
	}

	list(): AuthFlow[] {
		this.prune();
		return [...this.flows.values()].map((entry) => entry.flow);
	}

	start(providerId: string, type: AuthType): string {
		const provider = this.runtime.getProvider(providerId);
		if (!provider) throw new Error(`Unknown provider: ${providerId}`);
		for (const entry of this.flows.values()) {
			if (entry.flow.providerId === providerId && entry.flow.status === "running") return entry.flow.flowId;
		}
		const entry: FlowEntry = {
			flow: {
				flowId: randomUUID(),
				providerId,
				providerName: provider.name,
				type,
				status: "running",
				events: [],
				startedAt: Date.now(),
			},
			controller: new AbortController(),
		};
		this.flows.set(entry.flow.flowId, entry);
		this.publish(entry);
		void this.run(entry);
		return entry.flow.flowId;
	}

	respond(flowId: string, promptId: string, value: string): boolean {
		const entry = this.flows.get(flowId);
		if (!entry?.answer || entry.answer.promptId !== promptId) return false;
		const { resolve } = entry.answer;
		entry.answer = undefined;
		entry.flow = { ...entry.flow, prompt: undefined };
		this.publish(entry);
		resolve(value);
		return true;
	}

	cancel(flowId: string): void {
		const entry = this.flows.get(flowId);
		if (!entry || entry.flow.status !== "running") return;
		entry.controller.abort();
		entry.answer?.reject(new Error("Login cancelled"));
		entry.answer = undefined;
	}

	async logout(providerId: string): Promise<void> {
		await this.runtime.logout(providerId);
		this.onProvidersChanged();
	}

	dispose(): void {
		for (const entry of this.flows.values()) this.cancel(entry.flow.flowId);
	}

	private async run(entry: FlowEntry): Promise<void> {
		const interaction: LoginInteraction = {
			signal: entry.controller.signal,
			prompt: (prompt) => this.ask(entry, prompt),
			notify: (event) => this.addEvent(entry, event),
		};
		try {
			await this.runtime.login(entry.flow.providerId, entry.flow.type, interaction);
			entry.flow = { ...entry.flow, status: "succeeded", prompt: undefined };
			this.onProvidersChanged();
		} catch (error) {
			const cancelled = entry.controller.signal.aborted;
			const message = error instanceof Error ? error.message : String(error);
			if (!cancelled) log.warn(`login to ${entry.flow.providerId} failed: ${message}`);
			entry.flow = {
				...entry.flow,
				status: cancelled ? "cancelled" : "failed",
				prompt: undefined,
				error: cancelled ? undefined : message,
			};
		}
		entry.answer = undefined;
		this.publish(entry);
	}

	private ask(entry: FlowEntry, prompt: PiAuthPrompt): Promise<string> {
		if (entry.controller.signal.aborted) return Promise.reject(new Error("Login cancelled"));
		const info: AuthPromptInfo = {
			id: randomUUID(),
			type: prompt.type,
			message: prompt.message,
			placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
			options:
				prompt.type === "select"
					? prompt.options.map((o) => ({ id: o.id, label: o.label, description: o.description }))
					: undefined,
		};
		return new Promise<string>((resolve, reject) => {
			entry.answer = { promptId: info.id, resolve, reject };
			entry.flow = { ...entry.flow, prompt: info };
			this.publish(entry);
			// A flow may withdraw a prompt (e.g. a manual-code prompt raced by a browser callback).
			prompt.signal?.addEventListener(
				"abort",
				() => {
					if (entry.answer?.promptId !== info.id) return;
					entry.answer = undefined;
					entry.flow = { ...entry.flow, prompt: undefined };
					this.publish(entry);
					reject(new Error("Prompt withdrawn"));
				},
				{ once: true },
			);
		});
	}

	private addEvent(entry: FlowEntry, event: PiAuthEvent): void {
		let next: AuthFlowEvent;
		switch (event.type) {
			case "info":
				next = {
					type: "info",
					message: event.message,
					links: event.links?.map((l) => ({ url: l.url, label: l.label })),
				};
				break;
			case "auth_url":
				next = { type: "auth_url", url: event.url, instructions: event.instructions };
				break;
			case "device_code":
				next = {
					type: "device_code",
					userCode: event.userCode,
					verificationUri: event.verificationUri,
					expiresInSeconds: event.expiresInSeconds,
				};
				break;
			case "progress":
				next = { type: "progress", message: event.message };
				break;
			default:
				return;
		}
		entry.flow = { ...entry.flow, events: [...entry.flow.events, next].slice(-MAX_EVENTS) };
		this.publish(entry);
	}

	private publish(entry: FlowEntry): void {
		this.onFlow(entry.flow);
	}

	private prune(): void {
		const cutoff = Date.now() - FINISHED_FLOW_TTL_MS;
		for (const [id, entry] of this.flows) {
			if (entry.flow.status !== "running" && entry.flow.startedAt < cutoff) this.flows.delete(id);
		}
	}
}
