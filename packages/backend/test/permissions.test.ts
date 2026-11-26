import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createPermissionExtension } from "../src/permissions.ts";

it("nested sandboxed bash shares its parent approval, but nested unsandboxed bash must ask", async () => {
	const host = {
		previewNestedCall: vi.fn(),
		checkToolCall: vi.fn(async () => ({ allow: false as const, reason: "denied" })),
	};
	let handler: (event: ToolCallEvent, ctx: ExtensionContext) => unknown;
	const pi = {
		on(_name: string, callback: typeof handler) {
			handler = callback;
		},
	} as unknown as ExtensionAPI;
	const extension = createPermissionExtension(host);
	await (typeof extension === "function" ? extension : extension.factory)(pi);
	const event = {
		type: "tool_call",
		toolName: "bash",
		toolCallId: "child",
		parentToolCallId: "parent",
		input: { command: "make" },
	} as ToolCallEvent;
	const ctx = {} as ExtensionContext;
	expect(await handler!(event, ctx)).toBeUndefined();
	expect(host.checkToolCall).not.toHaveBeenCalled();
	expect(
		await handler!({ ...event, input: { command: "make", dangerouslyDisableSandbox: true } } as ToolCallEvent, ctx),
	).toEqual({ block: true, reason: "denied" });
	expect(host.checkToolCall).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: "child" }));
});
