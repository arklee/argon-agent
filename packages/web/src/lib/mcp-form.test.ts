import { describe, expect, it } from "vitest";
import { describeForm, formatPairs, parseLines, parsePairs } from "./mcp-form";

describe("mcp form fields", () => {
	it("splits lines and drops blanks", () => {
		expect(parseLines(" -y \n\n@scope/server \n")).toEqual(["-y", "@scope/server"]);
	});
	it("parses env and headers, keeping separators inside values", () => {
		expect(parsePairs("TOKEN=a=b\n\nDEBUG = 1", "=")).toEqual({ pairs: { TOKEN: "a=b", DEBUG: "1" } });
		expect(parsePairs("Authorization: Bearer x:y", ":")).toEqual({ pairs: { Authorization: "Bearer x:y" } });
		expect(parsePairs("oops", "=")).toEqual({ error: "oops" });
		expect(parsePairs("=value", "=")).toEqual({ error: "=value" });
	});
	it("formats pairs back and describes servers", () => {
		expect(formatPairs({ A: "1", B: "2" }, "=")).toBe("A=1\nB=2");
		expect(formatPairs({ Authorization: "x" }, ":")).toBe("Authorization: x");
		expect(describeForm({ transport: "stdio", command: "npx", args: ["-y", "srv"] })).toBe("npx -y srv");
		expect(describeForm({ transport: "http", url: "https://example.com/mcp" })).toBe("https://example.com/mcp");
	});
});
