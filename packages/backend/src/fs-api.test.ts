import { mkdtemp, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileForDisplay } from "./fs-api.ts";
import { parseDisplayTarget, resolveDisplayTarget } from "./path-target.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "argon-file-preview-"));
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(dir, { recursive: true, force: true });
});

const LIMIT = 1024 * 1024;

describe("display targets", () => {
	it.each([
		[":12", 12, undefined],
		[":12:5", 12, undefined],
		["#L12", 12, undefined],
		["#L12-L20", 12, 20],
		["#L12-20", 12, 20],
		["#L12–L20", 12, 20],
		["#L12C5", 12, undefined],
		[":0", undefined, undefined],
		["#L0-L20", undefined, undefined],
		["#L12-L12", 12, undefined],
		["#L12-L2", 12, undefined],
	] as const)("preserves anchor %s after unwrapping", (anchor, line, endLine) => {
		expect(parseDisplayTarget(` (a.ts${anchor}) `)).toEqual({ target: "a.ts", line, endLine });
	});

	it.each(["`a.ts:12`", '"a.ts:12"', "'a.ts:12'", "<a.ts:12>", "(a.ts:12)", "[a.ts:12]", "`([a.ts:12])`"])(
		"strips matching wrappers: %s",
		(target) => expect(parseDisplayTarget(target)).toEqual({ target: "a.ts", line: 12 }),
	);

	it("preserves Windows drive letters and internal brackets", () => {
		expect(parseDisplayTarget("C:\\a\\b.ts")).toEqual({ target: "C:\\a\\b.ts" });
		expect(parseDisplayTarget("C:\\a\\b.ts:12:5")).toEqual({ target: "C:\\a\\b.ts", line: 12 });
		expect(parseDisplayTarget("My (notes)/a.ts")).toEqual({ target: "My (notes)/a.ts" });
	});

	it("uses home when cwd is missing or relative", () => {
		for (const cwd of [undefined, "relative"])
			expect(resolveDisplayTarget("a.ts", cwd).path).toBe(join(homedir(), "a.ts"));
		expect(resolveDisplayTarget("~", dir).path).toBe(homedir());
	});
});

describe("readFileForDisplay", () => {
	it("reads absolute, relative, home, encoded and file URL paths with metadata", async () => {
		const path = join(dir, "空 格.txt");
		await writeFile(path, "你好\n");
		const info = await stat(path);
		for (const target of [
			path,
			"空 格.txt",
			encodeURIComponent("空 格.txt"),
			pathToFileURL(path).href,
			`~/${relative(homedir(), path)}`,
		]) {
			expect(await readFileForDisplay(`(${target}#L12-L20)`, dir)).toEqual({
				path,
				line: 12,
				endLine: 20,
				size: info.size,
				modifiedAt: info.mtimeMs,
				kind: "text",
				text: "你好\n",
			});
		}
	});

	it("follows symlinks to regular files", async () => {
		await writeFile(join(dir, "source"), "text");
		await symlink(join(dir, "source"), join(dir, "link"));
		expect(await readFileForDisplay("link", dir)).toMatchObject({ kind: "text", text: "text" });
	});

	it("returns protocol errors for empty, missing, non-directory components and directories", async () => {
		for (const target of ["", "  ", "([])", "(:12)"])
			await expect(readFileForDisplay(target, dir)).rejects.toMatchObject({ code: "bad_request" });
		await expect(readFileForDisplay("missing", dir)).rejects.toMatchObject({ code: "not_found" });
		await writeFile(join(dir, "file"), "");
		await expect(readFileForDisplay("file/child", dir)).rejects.toMatchObject({ code: "not_found" });
		await expect(readFileForDisplay(dir, dir)).rejects.toMatchObject({ code: "bad_request" });
	});

	it.each([Buffer.from([65, 0, 66]), Buffer.from([0xff]), Buffer.from([0xe4, 0xb8])])(
		"classifies NUL and malformed or incomplete UTF-8 as binary: %s",
		async (bytes) => {
			await writeFile(join(dir, "data"), bytes);
			const result = await readFileForDisplay("data", dir);
			expect(result.kind).toBe("binary");
			expect(result.text).toBeUndefined();
		},
	);

	it("truncates at the last newline when the byte limit splits Chinese text", async () => {
		const prefix = `${"a".repeat(LIMIT - 5)}\n`;
		await writeFile(join(dir, "large"), `${prefix}中文中文\n`);
		expect(await readFileForDisplay("large", dir)).toMatchObject({ kind: "text", text: prefix, truncated: true });
	});

	it("keeps a valid UTF-8 boundary when a long line has no newline", async () => {
		await writeFile(join(dir, "large"), "中".repeat(LIMIT));
		const result = await readFileForDisplay("large", dir);
		expect(result).toMatchObject({ kind: "text", truncated: true });
		expect(result.text).toBe("中".repeat(Math.floor(LIMIT / 3)));
	});

	it("does not hide invalid UTF-8 near the truncation boundary", async () => {
		await writeFile(join(dir, "large"), Buffer.concat([Buffer.alloc(LIMIT - 1, 65), Buffer.from([0xff, 65, 65])]));
		expect(await readFileForDisplay("large", dir)).toMatchObject({ kind: "binary" });
	});

	it("does not truncate exactly 1 MiB or empty files", async () => {
		for (const text of ["", "a".repeat(LIMIT)]) {
			await writeFile(join(dir, "text"), text);
			const result = await readFileForDisplay("text", dir);
			expect(result.text).toBe(text);
			expect(result.truncated).toBeUndefined();
		}
	});

	it.each([
		["png", "image/png"],
		["jpg", "image/jpeg"],
		["jpeg", "image/jpeg"],
		["gif", "image/gif"],
		["webp", "image/webp"],
		["SVG", "image/svg+xml"],
	])("returns base64 for small %s images", async (extension, mimeType) => {
		const bytes = Buffer.from([0, 1, 255]);
		await writeFile(join(dir, `image.${extension}`), bytes);
		expect(await readFileForDisplay(`image.${extension}`, dir)).toMatchObject({
			kind: "image",
			image: { mimeType, data: bytes.toString("base64") },
		});
	});

	it("omits image data above 10 MiB", async () => {
		const path = join(dir, "large.png");
		await writeFile(path, "");
		await truncate(path, 10 * LIMIT + 1);
		const result = await readFileForDisplay(path, dir);
		expect(result).toMatchObject({ kind: "image", size: 10 * LIMIT + 1 });
		expect(result.image).toBeUndefined();
	});
});
