/**
 * pi's built-in extensions (MCP, codemode, tool_search). The pi CLI loads these by default; the SDK
 * does not, so Argon registers them the same way the CLI does: as `builtin` + `replaceable` inline
 * extensions. That keeps pi's semantics:
 *   - they appear as `builtin:<name>` and can be disabled with `-builtin:<name>` in the `extensions`
 *     setting, exactly like in the CLI;
 *   - a third-party extension registering the same tool/command (e.g. its own `/mcp`) replaces them.
 *
 * The CLI also ships `builtin:llama.cpp` (the llama.cpp provider and /llama). pi does not export it, so
 * it is imported by file from the installed package (the package `exports` map only restricts bare
 * specifiers). If a pi upgrade moves it, Argon logs a warning and runs without it.
 */

import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionContext,
	type ExtensionFactory,
	type InlineExtension,
	type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { applyPatchExtension } from "./apply-patch.ts";
import { createCompactExtension } from "./codex-compact.ts";
import { createImagegenExtension } from "./codex-imagegen.ts";
import { log } from "./log.ts";
import { piMcp } from "./mcp-config.ts";
import type { ArgonSettingsStore } from "./settings.ts";

import type { ToolPreset } from "./tool-presets.ts";

async function loadLlamaExtension(): Promise<ExtensionFactory | undefined> {
	try {
		const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
		const module = (await import(new URL("./extensions/llama/index.js", entry).href)) as { default?: unknown };
		if (typeof module.default === "function") return module.default as ExtensionFactory;
		log.warn("builtin:llama.cpp has no default export; skipping it");
	} catch (error) {
		log.warn(`builtin:llama.cpp could not be loaded: ${error instanceof Error ? error.message : error}`);
	}
	return undefined;
}

const llamaExtension = await loadLlamaExtension();

const MCP_ENTRY = "argon.mcp_servers";
function sessionServers(manager: Pick<SessionManager, "getEntries">): Record<string, boolean> {
	const entry = manager.getEntries().findLast((e) => e.type === "custom" && e.customType === MCP_ENTRY);
	const servers =
		entry?.type === "custom" ? (entry.data as { servers?: Record<string, boolean> } | null)?.servers : undefined;
	return Object.fromEntries(Object.entries(servers ?? {}).filter(([, value]) => typeof value === "boolean"));
}
/**
 * Per-session MCP enable/disable (decisions D16): the `argon.mcp_servers` session entry, then the
 * project's private defaults, override each server's `enabled`. Servers from mcp.json go through pi's
 * `loadConfig` / `updateConfig`; servers extensions register go through the two hooks Argon's patch adds
 * (pi has no file to save their changes to).
 */
export function sessionMcpOptions(agentDir: string, manager: SessionManager, settings: ArgonSettingsStore) {
	const overrides = (cwd: string) => ({ ...settings.getProject(cwd).mcpServers, ...sessionServers(manager) });
	const remember = (name: string, enabled: boolean) =>
		manager.appendCustomEntry(MCP_ENTRY, { servers: { ...sessionServers(manager), [name]: enabled } });
	return {
		loadConfig(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "sessionManager">) {
			const config = piMcp().loadMcpConfig({ agentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
			const enabled = overrides(ctx.cwd);
			for (const { name, config: server } of config.servers)
				if (Object.hasOwn(enabled, name)) server.enabled = enabled[name];
			return config;
		},
		updateConfig(entry, patch) {
			if (patch.enabled !== undefined) remember(entry.name, patch.enabled);
			if (patch.exposure !== undefined)
				piMcp().updateMcpServerConfig(
					entry.override ?? entry.source,
					entry.name,
					{ exposure: patch.exposure },
					{ override: entry.override !== undefined },
				);
		},
		registeredServerConfig(name, config) {
			const enabled = overrides(manager.getCwd());
			return Object.hasOwn(enabled, name) ? { ...config, enabled: enabled[name] } : config;
		},
		updateRegisteredConfig(entry, patch) {
			// Exposure changes of registered servers last for this runtime, as in pi.
			if (patch.enabled !== undefined) remember(entry.name, patch.enabled);
		},
	} satisfies NonNullable<Parameters<typeof createMcpExtension>[0]>;
}
export function createBuiltinExtensions(
	settings: ArgonSettingsStore,
	codemodeMode: () => ToolPreset["codemodeMode"],
	mcpOptions: Parameters<typeof createMcpExtension>[0] = {},
): InlineExtension[] {
	return [
		{ name: "apply-patch", factory: applyPatchExtension, builtin: true, replaceable: true },
		{ name: "codex-compact", factory: createCompactExtension(settings), builtin: true, replaceable: true },
		{ name: "codex-imagegen", factory: createImagegenExtension(settings), builtin: true, replaceable: true },
		// Same order and flags as pi's builtInExtensions (dist/extensions/index.js).
		...(llamaExtension ? [{ name: "llama.cpp", factory: llamaExtension, builtin: true } as InlineExtension] : []),
		{
			name: "codemode",
			factory: createCodemodeExtension({
				get mode() {
					return codemodeMode();
				},
			}),
			replaceable: true,
			builtin: true,
		},
		{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
		// Never open a browser on the backend machine (it may be remote): sign-in URLs go to the client
		// as an `oauth` interaction (see mcp-bridge.ts).
		{
			name: "mcp",
			factory: createMcpExtension({ ...mcpOptions, openUrl: () => {} }),
			replaceable: true,
			builtin: true,
		},
	];
}
