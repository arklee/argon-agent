import { expect, it } from "vitest";
import { activeToolNames, isGpt5Family } from "../src/model-family.ts";

it.each(["gpt-6-astra", "gpt-5.1-codex", "openai/GPT-5", "gpt-5-mini"])("uses patches for %s", (id) => {
	expect(isGpt5Family(id)).toBe(true);
});
it.each(["gpt-4", "gpt-4.1", "gpt-4o", "gpt-oss-120b", "GPT-5-OSS", "claude-opus", ""])(
	"keeps edit/write for %s",
	(id) => {
		expect(isGpt5Family(id)).toBe(false);
	},
);
const registered = ["read", "edit", "write", "apply_patch", "codemode", "custom"];
it("switches GPT tools independently of codemode", () => {
	expect(activeToolNames(["read", "edit", "write", "custom"], { codemode: true, patchMode: true, registered })).toEqual(
		["read", "custom", "codemode", "apply_patch"],
	);
});
it("restores only the edit tools removed by this reconciliation", () => {
	expect(
		activeToolNames(["read", "apply_patch", "codemode"], {
			codemode: false,
			patchMode: false,
			registered,
			removed: ["edit"],
		}),
	).toEqual(["read", "edit"]);
	expect(activeToolNames(["read"], { codemode: false, patchMode: false, registered })).toEqual(["read"]);
});
it("does not hide edits when apply_patch is disabled or resurrect unregistered tools", () => {
	expect(
		activeToolNames(["read", "write"], {
			codemode: false,
			patchMode: true,
			registered: ["read", "write"],
			removed: ["edit"],
		}),
	).toEqual(["read", "write"]);
});
