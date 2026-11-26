/**
 * pi's built-in extensions (MCP, codemode, tool_search). The pi CLI loads these by default; the SDK
 * does not, so Argon registers them the same way the CLI does: as `builtin` + `replaceable` inline
 * extensions. That keeps pi's semantics:
 *   - they appear as `builtin:<name>` and can be disabled with `-builtin:<name>` in the `extensions`
 *     setting, exactly like in the CLI;
 *   - a third-party extension registering the same tool/command (e.g. its own `/mcp`) replaces them.
 *
 * The CLI also ships `builtin:llama.cpp`, which pi does not export; it is left out for now.
 */

import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";

export function createBuiltinExtensions(): InlineExtension[] {
	return [
		{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
		{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
		{ name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
	];
}
