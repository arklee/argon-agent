import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/ui-bridge.ts";

describe("stripAnsi", () => {
	it("removes CSI colors while retaining surrounding text and whitespace", () => {
		expect(stripAnsi("before \x1b[31mred\x1b[0m \x1b[1;38;2;1;2;3mbold\x1b[0m\nafter")).toBe("before red bold\nafter");
	});

	it.each(["\x07", "\x1b\\"])("removes OSC 8 hyperlinks terminated by %j and retains their labels", (end) => {
		expect(stripAnsi(`see \x1b]8;;https://example.com${end}link text\x1b]8;;${end} here`)).toBe("see link text here");
	});

	it("preserves plain Unicode text", () => {
		expect(stripAnsi("你好 👋\n\tplain text")).toBe("你好 👋\n\tplain text");
	});
});
