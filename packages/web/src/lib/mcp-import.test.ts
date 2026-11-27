import { describe, expect, it } from "vitest";
import { parseMcpImport, sseServers, stripJsonc, suggestName } from "./mcp-import";

describe("parseMcpImport", () => {
	it("reads the common wrappers", () => {
		const fs = { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] };
		expect(parseMcpImport(JSON.stringify({ mcpServers: { fs } }))).toEqual({ kind: "servers", servers: { fs } });
		expect(parseMcpImport(JSON.stringify({ servers: { fs } }))).toEqual({ kind: "servers", servers: { fs } });
		expect(parseMcpImport(JSON.stringify({ mcp: { servers: { fs } } }))).toEqual({ kind: "servers", servers: { fs } });
		expect(parseMcpImport(JSON.stringify({ fs }))).toEqual({ kind: "servers", servers: { fs } });
	});
	it("reads a single server and suggests a name", () => {
		const result = parseMcpImport('{\n  "type": "sse",\n  "url": "http://127.0.0.1:64342/sse",\n  "headers": {}\n}');
		expect(result).toMatchObject({ kind: "single", suggestedName: "local-64342" });
	});
	it("accepts JSONC and maps serverUrl", () => {
		const text = `{
			// Windsurf
			"mcpServers": { "docs": { "serverUrl": "https://mcp.docs.dev/mcp", /* inline */ }, },
		}`;
		expect(parseMcpImport(text)).toEqual({ kind: "servers", servers: { docs: { url: "https://mcp.docs.dev/mcp" } } });
		expect(stripJsonc('{"a": "// not a comment", "b": "x\\"/*y*/"}')).toBe(
			'{"a": "// not a comment", "b": "x\\"/*y*/"}',
		);
	});
	it("reports bad JSON and unknown shapes", () => {
		expect(parseMcpImport("{")).toMatchObject({ kind: "error", error: "json" });
		expect(parseMcpImport('{"foo": 1}')).toEqual({ kind: "error", error: "shape" });
		expect(parseMcpImport("[]")).toEqual({ kind: "error", error: "shape" });
	});
	it("finds legacy SSE entries", () => {
		expect(sseServers({ a: { type: "sse", url: "x" }, b: { url: "y" } })).toEqual(["a"]);
	});
});

describe("suggestName", () => {
	it("uses the host or the package", () => {
		expect(suggestName({ url: "https://mcp.linear.app/mcp" })).toBe("linear");
		expect(suggestName({ url: "https://api.githubcopilot.com/mcp/" })).toBe("githubcopilot");
		expect(suggestName({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.2", "."] })).toBe(
			"filesystem",
		);
		expect(suggestName({ command: "uvx", args: ["mcp-server-git"] })).toBe("git");
		expect(suggestName({ command: "/usr/local/bin/my tool.exe" })).toBe("my-tool");
	});
});
