import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { resolveCodexToolProvider } from "../vendor/codex-web-run/src/codex-runtime/resolve.ts";
import { WEB_SEARCH_PARAMETERS } from "../vendor/codex-web-run/src/contract.ts";
import { executeCodexWebSearch } from "../vendor/codex-web-run/src/execute.ts";
import type { ArgonSettingsStore } from "./settings.ts";

type Settings = Pick<ArgonSettingsStore, "get">;
const extensions = new WeakMap<Settings, { factory: ExtensionFactory; apply: Set<() => void> }>();

export function createWebSearchExtension(settings: Settings): ExtensionFactory {
	const existing = extensions.get(settings);
	if (existing) return existing.factory;
	const apply = new Set<() => void>();
	const factory: ExtensionFactory = (pi) => {
		const lifetime = new AbortController();
		const refresh = () =>
			pi.registerTool({
				name: "web_run",
				label: "web_run",
				description: "Search the web, open pages, follow links and find text in pages.",
				promptGuidelines: [
					"Use web_run for web research. Pass returned ref_ids to open, click and find. Cite source URLs as Markdown links, never internal ref_ids.",
				],
				parameters: WEB_SEARCH_PARAMETERS,
				exposure: settings.get().webSearch ? "direct" : "hidden",
				async execute(_id, params, signal, _onUpdate, ctx) {
					if (!settings.get().webSearch) throw new Error("Web search is disabled in Argon settings.");
					const combined = AbortSignal.any([
						lifetime.signal,
						AbortSignal.timeout(120_000),
						...(signal ? [signal] : []),
					]);
					combined.throwIfAborted();
					// Select Argon's Codex login even when the conversation uses another provider or proxy.
					const authContext = new Proxy(ctx, {
						get(target, key, receiver) {
							return key === "model" ? undefined : Reflect.get(target, key, receiver);
						},
					}) as ExtensionContext;
					const result = await executeCodexWebSearch(params as Record<string, unknown>, ctx, combined, {
						model: "gpt-6-luna",
						resolveProvider: () => resolveCodexToolProvider(authContext),
					});
					return { content: [{ type: "text", text: result.text }], details: { webRun: result.details } };
				},
			});
		refresh();
		apply.add(refresh);
		pi.on("session_shutdown", async () => {
			lifetime.abort();
			apply.delete(refresh);
		});
	};
	extensions.set(settings, { factory, apply });
	return factory;
}
export function refreshWebSearchExposure(settings: Settings): void {
	for (const refresh of extensions.get(settings)?.apply ?? []) refresh();
}
