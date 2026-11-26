/**
 * Argon's tool permission gate, implemented as an inline pi extension (no pi patch needed).
 * pi itself never asks before running tools; Argon asks for anything that is not read-only.
 */

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

/** Built-in tools that only read. Everything else (bash, edit, write, MCP, custom) needs approval in "ask" mode. */
export const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export interface ToolCallCheck {
	toolCallId: string;
	toolName: string;
	input: unknown;
	signal: AbortSignal | undefined;
}

export type ToolCallDecision = { allow: true } | { allow: false; reason: string };

export interface PermissionHost {
	previewNestedCall?(check: ToolCallCheck): Promise<void>;
	checkToolCall(check: ToolCallCheck): Promise<ToolCallDecision>;
}

export function createPermissionExtension(host: PermissionHost): InlineExtension {
	const factory: ExtensionFactory = (pi) => {
		pi.on("tool_call", async (event, ctx) => {
			const check = {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
				signal: ctx.signal,
			};
			// Nested calls were approved with their parent.
			if (event.parentToolCallId) {
				await host.previewNestedCall?.(check);
				return;
			}
			const decision = await host.checkToolCall(check);
			if (decision.allow) return undefined;
			return { block: true, reason: decision.reason };
		});
	};
	return { name: "argon-permissions", factory, hidden: true };
}
