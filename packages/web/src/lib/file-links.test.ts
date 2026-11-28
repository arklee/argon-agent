import { describe, expect, it } from "vitest";
import { classifyMarkdownLink, fileLinkTarget, formatBytes, languageFor, wrapFileHref } from "./file-links";

describe("classifyMarkdownLink", () => {
	it.each([
		["src/a.ts", "src/a.ts"],
		["src/a.ts:42", "src/a.ts:42"],
		["a.ts:42", "a.ts:42"],
		["a.ts:42:7", "a.ts:42:7"],
		["./docs/x.md#L3-L9", "./docs/x.md#L3-L9"],
		["/Users/me/p/a.ts", "/Users/me/p/a.ts"],
		["~/notes.md", "~/notes.md"],
		["file:///tmp/a%20b.txt", "file:///tmp/a%20b.txt"],
		["C:\\work\\a.ts", "C:\\work\\a.ts"],
		["%E4%B8%AD.md", "%E4%B8%AD.md"],
	])("treats %s as a file", (href, target) => {
		expect(classifyMarkdownLink(href)).toEqual({ kind: "file", target });
	});

	it.each(["https://example.com", "HTTP://x.y", "mailto:a@b.c"])("leaves %s to the browser", (href) => {
		expect(classifyMarkdownLink(href)).toEqual({ kind: "external" });
	});

	it.each(["", "  ", "#heading", "javascript:alert(1)", "data:text/html,x", "vscode://file/a", "//evil.com/x"])(
		"ignores %j",
		(href) => {
			expect(classifyMarkdownLink(href)).toEqual({ kind: "ignore" });
		},
	);
});

describe("languageFor", () => {
	const known = new Set(["typescript", "ts", "tsx", "javascript", "json", "yaml", "md", "shellscript", "docker"]);
	const supports = (language: string) => known.has(language);
	it("maps extensions and names", () => {
		expect(languageFor("/a/b.ts", supports)).toBe("ts");
		expect(languageFor("x.mts", supports)).toBe("typescript");
		expect(languageFor("c.yml", supports)).toBe("yaml");
		expect(languageFor("run.sh", supports)).toBe("shellscript");
		expect(languageFor("/p/Dockerfile", supports)).toBe("docker");
	});
	it("returns undefined for unknown or plain text", () => {
		expect(languageFor("a.unknown", supports)).toBeUndefined();
		expect(languageFor("notes.txt", supports)).toBeUndefined();
		expect(languageFor("README", supports)).toBeUndefined();
		expect(languageFor(".gitignore", supports)).toBeUndefined();
	});
});

describe("formatBytes", () => {
	it("formats", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
	});
});

describe("file hrefs", () => {
	it("round-trips file targets and leaves the rest alone", () => {
		for (const target of ["a.ts:42", "../x/中文 名.md#L3-L9", "file:///tmp/a%20b"]) {
			const wrapped = wrapFileHref(target);
			expect(wrapped).toMatch(/^https:\/\//);
			expect(fileLinkTarget(wrapped!)).toBe(target);
		}
		expect(wrapFileHref("https://example.com")).toBeUndefined();
		expect(wrapFileHref("javascript:alert(1)")).toBeUndefined();
		expect(fileLinkTarget("https://example.com/?target=x")).toBeUndefined();
	});
});
