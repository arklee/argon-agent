import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createWriteDiffExtension } from "../src/write-diff.ts";

type Handler = (event: Record<string, unknown>) => unknown;

function load(diffs: Record<string, string>) {
	let handler: Handler | undefined;
	const pi = { on: (name: string, h: Handler) => name === "tool_result" && (handler = h) };
	const extension = createWriteDiffExtension({
		takeWriteDiff: (id) => {
			const diff = diffs[id];
			delete diffs[id];
			return diff;
		},
	});
	if (typeof extension === "function" || !("factory" in extension)) throw new Error("unexpected extension shape");
	void extension.factory(pi as unknown as ExtensionAPI);
	if (!handler) throw new Error("no tool_result handler");
	return handler;
}

describe("argon-write-diff", () => {
	it("stores the previewed diff in a successful write result", () => {
		const handler = load({ w1: "+1 hello" });
		expect(handler({ toolName: "write", toolCallId: "w1", isError: false, details: undefined })).toEqual({
			details: { diff: "+1 hello" },
		});
	});

	it("leaves failed writes, other tools and pi's own diffs alone", () => {
		const handler = load({ w1: "+1 a", w2: "+1 b", e1: "+1 c" });
		expect(handler({ toolName: "write", toolCallId: "w1", isError: true })).toBeUndefined();
		expect(handler({ toolName: "edit", toolCallId: "e1", isError: false })).toBeUndefined();
		expect(
			handler({ toolName: "write", toolCallId: "w2", isError: false, details: { diff: "from pi" } }),
		).toBeUndefined();
	});

	it("does nothing without a previewed diff", () => {
		const handler = load({});
		expect(handler({ toolName: "write", toolCallId: "w9", isError: false })).toBeUndefined();
	});
});
