import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyPlan, patchedPaths, patchFileDiffs, planPatch } from "../src/apply-patch.ts";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function workspace(files: Record<string, string> = {}) {
	const dir = await mkdtemp(join(tmpdir(), "argon-patch-"));
	dirs.push(dir);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	return dir;
}
const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;
it.each([
	["exact", "hello", "hello"],
	["trailing", "hello  ", "hello"],
	["surrounding", "  hello  ", "hello"],
	["punctuation", "“hello”—world", '"hello"-world'],
])("matches %s lines", async (_level, original, context) => {
	const dir = await workspace({ a: `${original}\n` });
	await applyPlan(await planPatch(patch(`*** Update File: a\n@@\n-${context}\n+changed`), dir));
	expect(await readFile(join(dir, "a"), "utf8")).toBe("changed\n");
});
it.each(["\uFEFFhello\n", "hello\r\n", "\uFEFFhello\r\n"])("preserves BOM and line endings: %j", async (before) => {
	const dir = await workspace({ a: before });
	await applyPlan(await planPatch(patch("*** Update File: a\n@@\n-hello\n+updated"), dir));
	expect(await readFile(join(dir, "a"), "utf8")).toBe(before.replace("hello", "updated"));
});
it("validates every file before any write", async () => {
	const dir = await workspace({ a: "old\n", b: "other\n" });
	await expect(
		planPatch(patch("*** Update File: a\n@@\n-old\n+new\n*** Update File: b\n@@\n-missing\n+new"), dir),
	).rejects.toThrow("Failed to find expected lines in b:\nmissing");
	expect(await readFile(join(dir, "a"), "utf8")).toBe("old\n");
	expect(await readFile(join(dir, "b"), "utf8")).toBe("other\n");
});
it("plans sequential edits, moves and deletes without IO side effects", async () => {
	const dir = await workspace({ gone: "bye\n" });
	const input = patch(
		"*** Add File: a\n+hello\n*** Update File: a\n*** Move to: nested/b\n@@\n-hello\n+world\n*** Delete File: gone",
	);
	const plan = await planPatch(input, dir);
	expect(await readdir(dir)).toEqual(["gone"]);
	expect(patchedPaths(input)).toEqual([
		{ path: "a", op: "add" },
		{ path: "a", op: "move", movePath: "nested/b" },
		{ path: "gone", op: "delete" },
	]);
	expect(patchFileDiffs(plan).map((diff) => diff.path)).toEqual(["a", "a", "gone"]);
	await applyPlan(plan);
	expect(await readFile(join(dir, "nested/b"), "utf8")).toBe("world\n");
	expect(await readdir(dir)).toEqual(["nested"]);
});
it("overwrites existing files on add, like opencode", async () => {
	const dir = await workspace({ a: "old" });
	await applyPlan(await planPatch(patch("*** Add File: a\n+new"), dir));
	expect(await readFile(join(dir, "a"), "utf8")).toBe("new\n");
});
it("honors context headers and end of file", async () => {
	const dir = await workspace({ a: "section\nsame\nnext\nsame\n" });
	await applyPlan(await planPatch(patch("*** Update File: a\n@@ next\n-same\n+last\n*** End of File"), dir));
	expect(await readFile(join(dir, "a"), "utf8")).toBe("section\nsame\nnext\nlast\n");
});
it("accepts absolute paths and caps diffs per file", async () => {
	const dir = await workspace();
	const input = patch(`*** Add File: ${join(dir, "a")}\n${"+line\n".repeat(5000)}*** Add File: b\n+small`);
	const plan = await planPatch(input, dir);
	expect(patchFileDiffs(plan)[0]?.diff).toContain("more lines");
	expect(patchFileDiffs(plan)[1]?.diff).toContain("small");
	await applyPlan(plan);
});
it.each([
	"broken",
	patch("*** Update File: missing\n@@\n-old\n+new"),
	patch("*** Delete File: missing"),
	patch("*** Update File: a\n@@"),
	patch(""),
])("rejects invalid input without writing: %j", async (input) => {
	const dir = await workspace({ a: "old\n" });
	await expect(planPatch(input, dir)).rejects.toThrow();
	expect(await readFile(join(dir, "a"), "utf8")).toBe("old\n");
});
it("observes cancellation before writes", async () => {
	const dir = await workspace();
	const plan = await planPatch(patch("*** Add File: a\n+new"), dir);
	await expect(applyPlan(plan, AbortSignal.abort())).rejects.toThrow();
	expect(await readdir(dir)).toEqual([]);
});

it("the extension replans inside pi's mutation queue and returns per-file results", async () => {
	const { applyPatchExtension } = await import("../src/apply-patch.ts");
	let tool:
		| {
				execute(
					id: string,
					args: { input: string },
					signal: AbortSignal | undefined,
					update: undefined,
					ctx: { cwd: string },
				): Promise<{ content: { text: string }[]; details: { diffs: { path: string; diff: string }[] } }>;
		  }
		| undefined;
	await applyPatchExtension({
		registerTool: (definition: unknown) => {
			tool = definition as typeof tool;
		},
	} as never);
	const dir = await workspace({ a: "one\n" });
	const first = patch("*** Update File: a\n@@\n-one\n+two");
	const second = patch("*** Update File: a\n@@\n-two\n+three");
	const results = await Promise.all([
		tool!.execute("1", { input: first }, undefined, undefined, { cwd: dir }),
		tool!.execute("2", { input: second }, undefined, undefined, { cwd: dir }),
	]);
	expect(await readFile(join(dir, "a"), "utf8")).toBe("three\n");
	expect(results[0]?.content[0]?.text).toBe("Success. Updated the following files:\nM a");
	expect(results[1]?.details.diffs[0]?.path).toBe("a");
	expect(results[1]?.details.diffs[0]?.diff).toContain("+1 three");
});
