/**
 * Argon's tool permission gate, implemented as an inline pi extension (no pi patch needed).
 * pi itself never asks before running tools; Argon asks when a call leaves the sandbox policy.
 */

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

/** Built-in readers: allowed only when their target is outside the read-deny list. */
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
			// Nested calls share the parent approval, except requests to leave the OS sandbox.
			if (event.parentToolCallId && !isUnsandboxedBash(check)) {
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

export function isUnsandboxedBash(check: Pick<ToolCallCheck, "toolName" | "input">): boolean {
	return (
		check.toolName === "bash" &&
		(check.input as { dangerouslyDisableSandbox?: unknown } | undefined)?.dangerouslyDisableSandbox === true
	);
}
