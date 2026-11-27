/** D18: keep the vendored factory intact; drop its upstream TUI menu in favor of Argon settings. */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import upstreamFactory from "../vendor/codex-imagegen/src/codex-imagegen.ts";
import { setImagegenSettingsSource } from "../vendor/codex-imagegen/src/settings.ts";
import { openaiFeaturesEnabled } from "./openai-features.ts";
import type { ArgonSettingsStore } from "./settings.ts";

type Settings = Pick<ArgonSettingsStore, "get">;
const extensions = new WeakMap<Settings, { factory: ExtensionFactory; apply: Set<() => void> }>();

export function createImagegenExtension(settings: Settings): ExtensionFactory {
	const existing = extensions.get(settings);
	if (existing) return existing.factory;
	setImagegenSettingsSource(() => ({
		toolEnabled: settings.get().openaiFeatures !== "off",
		transparentBackground: false,
	}));
	const apply = new Set<() => void>();
	const factory: ExtensionFactory = async (pi) => {
		let provider: string | undefined;
		let applyDefinition: (() => void) | undefined;
		const refresh = () => {
			applyDefinition?.();
		};
		const registerTool: ExtensionAPI["registerTool"] = (tool) => {
			if (tool.name !== "codex_imagegen") return pi.registerTool(tool);
			applyDefinition = () =>
				pi.registerTool({
					...tool,
					exposure: openaiFeaturesEnabled(settings.get().openaiFeatures, provider) ? "direct" : "hidden",
					async execute(id, args, signal, update, ctx) {
						if (!openaiFeaturesEnabled(settings.get().openaiFeatures, ctx.model?.provider))
							throw new Error("Image generation is disabled for this model in Argon settings.");
						return tool.execute(id, args, signal, update, ctx);
					},
				});
			refresh();
		};
		const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
			if (name !== "codex-imagegen") pi.registerCommand(name, options);
		};
		pi.on("session_start", async (_event, ctx) => {
			provider = ctx.model?.provider;
			refresh();
		});
		pi.on("model_select", async (event) => {
			provider = event.model.provider;
			refresh();
		});
		await upstreamFactory(
			new Proxy(pi, {
				get(target, key, receiver) {
					if (key === "registerTool") return registerTool;
					if (key === "registerCommand") return registerCommand;
					return Reflect.get(target, key, receiver);
				},
			}),
		);
		apply.add(refresh);
		pi.on("session_shutdown", async () => {
			apply.delete(refresh);
		});
	};
	extensions.set(settings, { factory, apply });
	return factory;
}

export function refreshImagegenExposure(settings: Settings): void {
	for (const apply of extensions.get(settings)?.apply ?? []) apply();
}
