import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { capDiff } from "../src/diff-preview.ts";
import { createNestedDiffExtension } from "../src/nested-diffs.ts";
import { createPermissionExtension } from "../src/permissions.ts";

function load(extension: InlineExtension, name: string) {
	let handler: ((event: Record<string, unknown>, ctx: { signal?: AbortSignal }) => unknown) | undefined;
	if (typeof extension === "function" || !("factory" in extension)) throw new Error("unexpected extension shape");
	void extension.factory({
		on: (type: string, callback: typeof handler) => {
			if (type === name) handler = callback;
		},
	} as unknown as ExtensionAPI);
	if (!handler) throw new Error("missing handler");
	return handler;
}

it("previews nested calls under the parent's approval", async () => {
	const host = { previewNestedCall: vi.fn(), checkToolCall: vi.fn() };
	const call = load(createPermissionExtension(host), "tool_call");
	const check = { toolName: "write", toolCallId: "p/1", input: { path: "a" }, signal: new AbortController().signal };
	expect(await call({ ...check, parentToolCallId: "p" }, { signal: check.signal })).toBeUndefined();
	expect(host.previewNestedCall).toHaveBeenCalledWith(check);
	expect(host.checkToolCall).not.toHaveBeenCalled();
});

it("persists capped child diffs only on eligible parent results", () => {
	const diff = "line\n".repeat(5000);
	const getNestedDiffs = vi.fn((): Record<string, string> => ({ "p/1": diff }));
	const result = load(createNestedDiffExtension({ getNestedDiffs }), "tool_result");
	for (const details of [null, [], "text", 1, new Date()])
		expect(result({ toolCallId: "p", details }, {})).toBeUndefined();
	expect(result({ toolCallId: "p/1", parentToolCallId: "p" }, {})).toBeUndefined();
	expect(getNestedDiffs).not.toHaveBeenCalled();
	for (const details of [undefined, { other: true }])
		expect(result({ toolCallId: "p", details }, {})).toEqual({
			details: { ...details, argonNestedDiffs: { "p/1": capDiff(diff) } },
		});
	getNestedDiffs.mockReturnValue({ "p/1": capDiff(diff) });
	expect(result({ toolCallId: "p" }, {})).toEqual({ details: { argonNestedDiffs: { "p/1": capDiff(diff) } } });
	expect(getNestedDiffs).toHaveBeenCalledWith("p");
	getNestedDiffs.mockReturnValue({});
	expect(result({ toolCallId: "other" }, {})).toBeUndefined();
});
