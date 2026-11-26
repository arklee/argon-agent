import { describe, expect, it } from "vitest";
import { describeToolCall } from "../src/tool-display.ts";

describe("describeToolCall", () => {
	it.each(["bash", "powershell"])("describes %s with the first command line", (name) => {
		const command = "pwd\r\nls";
		expect(describeToolCall(name, { command, timeout: 10, cwd: "/ignored" })).toStrictEqual({
			kind: "shell",
			title: name,
			command,
			summary: "pwd",
		});
	});

	it.each([
		[{}, "src/a.ts"],
		[{ offset: 10, limit: 51 }, "src/a.ts:10-60"],
		[{ offset: 10 }, "src/a.ts:10-"],
		[{ limit: 5 }, "src/a.ts:1-5"],
		[{ limit: -1 }, "src/a.ts (offset 1, limit -1)"],
	])("describes read with range arguments %o", (range, summary) => {
		expect(describeToolCall("read", { path: "src/a.ts", ...range })).toStrictEqual({
			kind: "file_read",
			title: "read",
			path: "src/a.ts",
			...range,
			summary,
		});
	});

	it("describes edit as an update and leaves the write operation unset", () => {
		const path = "src/a.ts";
		expect(describeToolCall("edit", { path, edits: [{ oldText: "old", newText: "new" }] })).toStrictEqual({
			kind: "file_change",
			title: "edit",
			files: [{ path, op: "update" }],
			summary: path,
		});
		expect(describeToolCall("write", { path, content: "new" })).toStrictEqual({
			kind: "file_change",
			title: "write",
			files: [{ path }],
			summary: path,
		});
	});

	it("describes content and file searches", () => {
		expect(describeToolCall("grep", { pattern: "name", path: "src", glob: "*.ts", literal: true })).toStrictEqual({
			kind: "search",
			title: "grep",
			mode: "content",
			pattern: "name",
			path: "src",
			summary: "name in src",
		});
		expect(describeToolCall("find", { pattern: "*.ts" })).toStrictEqual({
			kind: "search",
			title: "find",
			mode: "files",
			pattern: "*.ts",
			summary: "*.ts",
		});
	});

	it.each([
		[{}, "."],
		[{ path: "src", limit: 5 }, "src"],
	])("describes directory listings with args %o", (args, path) => {
		expect(describeToolCall("ls", args)).toStrictEqual({
			kind: "search",
			title: "ls",
			mode: "list",
			path,
			summary: path,
		});
	});

	it("keeps the full codemode script and skips blank and options lines in the summary", () => {
		const code = '\r\n  // @options: {"timeout_ms": 1000}\r\n\r\n  const n = 1;\r\nconsole.log(n);';
		expect(describeToolCall("codemode", { code })).toStrictEqual({
			kind: "script",
			title: "codemode",
			language: "javascript",
			source: code,
			summary: "const n = 1;",
		});
	});

	it.each([
		["extension-tool", { option: true }, '{"option":true}'],
		["extension-tool", {}, ""],
		["read", "src/a.ts", '"src/a.ts"'],
		["ls", [], "[]"],
		["ls", null, "null"],
		["bash", {}, ""],
		["powershell", { command: 42 }, '{"command":42}'],
		["read", { offset: 10 }, '{"offset":10}'],
		["edit", { edits: [] }, '{"edits":[]}'],
		["write", { content: "text" }, '{"content":"text"}'],
		["grep", { path: "src" }, '{"path":"src"}'],
		["find", {}, ""],
		["codemode", { code: "" }, '{"code":""}'],
		["codemode", { code: " " }, '{"code":" "}'],
	])("describes %s with args %o as generic", (name, args, summary) => {
		expect(describeToolCall(name, args)).toStrictEqual({ kind: "generic", title: name, summary });
	});

	it("truncates compact JSON and handles unserializable arguments", () => {
		const value = "x".repeat(120);
		expect(describeToolCall("custom", { value }).summary).toBe(`{"value":"${"x".repeat(110)}`);
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(describeToolCall("custom", circular)).toStrictEqual({ kind: "generic", title: "custom", summary: "" });
	});
});
