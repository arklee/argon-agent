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
	type ExtensionFactory,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { log } from "./log.ts";

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

export function createBuiltinExtensions(codemodeMode: () => ToolPreset["codemodeMode"]): InlineExtension[] {
	return [
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
		{ name: "mcp", factory: createMcpExtension({ openUrl: () => {} }), replaceable: true, builtin: true },
	];
}
