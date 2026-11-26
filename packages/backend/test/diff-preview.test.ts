import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewDiff, resultDiff } from "../src/diff-preview.ts";

const dir = mkdtempSync(join(tmpdir(), "argon-diff-"));
writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");

describe("previewDiff", () => {
	it("diffs an edit against the file with real line numbers", async () => {
		const diff = await previewDiff("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] }, dir);
		expect(diff).toContain("-2 two");
		expect(diff).toContain("+2 TWO");
	});

	it("falls back to the replacement itself when oldText does not match exactly", async () => {
		const diff = await previewDiff("edit", { path: "a.txt", edits: [{ oldText: "missing", newText: "x" }] }, dir);
		expect(diff).toContain("-1 missing");
		expect(diff).toContain("+1 x");
	});

	it("diffs a write against the existing file, or against nothing for a new file", async () => {
		expect(await previewDiff("write", { path: "a.txt", content: "one\n2\nthree\n" }, dir)).toContain("+2 2");
		const created = await previewDiff("write", { path: join(dir, "new.txt"), content: "hi\n" }, dir);
		expect(created).toContain("+1 hi");
		expect(created).not.toMatch(/^-/m);
	});

	it("ignores other tools and malformed input", async () => {
		expect(await previewDiff("bash", { command: "ls" }, dir)).toBeUndefined();
		expect(await previewDiff("edit", { path: 3 }, dir)).toBeUndefined();
	});
});

describe("resultDiff", () => {
	it("reads details.diff from an edit result", () => {
		expect(resultDiff({ details: { diff: "+1 x" } })).toBe("+1 x");
		expect(resultDiff({ content: [] })).toBeUndefined();
	});
});
