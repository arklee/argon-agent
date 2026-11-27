/**
 * Reads MCP server snippets people paste from providers' docs into `mcpServers` entries (settings →
 * MCP → Add). Accepted shapes:
 *   { "mcpServers": { name: server } }        Claude Desktop, Cursor, pi
 *   { "servers": { name: server } }           VS Code mcp.json
 *   { "mcp": { "servers": { name: server } } } VS Code settings.json
 *   { name: server, ... }                     a bare map
 *   server                                    one server; the caller asks for a name
 * JSONC comments and trailing commas are allowed. Entries are passed through as they are (pi validates
 * them on the backend), except Windsurf's `serverUrl`, which becomes `url`.
 */

type Entry = Record<string, unknown>;

export type McpImport =
	| { kind: "servers"; servers: Record<string, Entry> }
	| { kind: "single"; server: Entry; suggestedName: string }
	| { kind: "error"; error: "json"; detail: string }
	| { kind: "error"; error: "shape" };

function record(value: unknown): value is Entry {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serverLike(value: unknown): value is Entry {
	return (
		record(value) &&
		(typeof value.command === "string" || typeof value.url === "string" || typeof value.serverUrl === "string")
	);
}

function normalize(entry: Entry): Entry {
	if (typeof entry.serverUrl !== "string" || entry.url !== undefined) return entry;
	const { serverUrl, ...rest } = entry;
	return { ...rest, url: serverUrl };
}

function serverMap(value: unknown): Record<string, Entry> | undefined {
	if (!record(value)) return undefined;
	const entries = Object.entries(value);
	if (entries.length === 0 || !entries.every(([, server]) => serverLike(server))) return undefined;
	return Object.fromEntries(entries.map(([name, server]) => [name, normalize(server as Entry)]));
}

/** Drop comments and trailing commas outside strings (JSONC → JSON). */
export function stripJsonc(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const char = text[i] as string;
		if (char === '"') {
			const start = i++;
			while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
			out += text.slice(start, ++i);
		} else if (char === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (char === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 2;
		} else {
			out += char;
			i++;
		}
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseMcpImport(text: string): McpImport {
	let root: unknown;
	try {
		root = JSON.parse(stripJsonc(text.replace(/^﻿/, "").trim()));
	} catch (error) {
		return { kind: "error", error: "json", detail: error instanceof Error ? error.message : String(error) };
	}
	if (!record(root)) return { kind: "error", error: "shape" };
	const vscode = record(root.mcp) ? root.mcp.servers : undefined;
	const servers = serverMap(root.mcpServers) ?? serverMap(root.servers) ?? serverMap(vscode);
	if (servers) return { kind: "servers", servers };
	if (serverLike(root)) return { kind: "single", server: normalize(root), suggestedName: suggestName(normalize(root)) };
	const bare = serverMap(root);
	return bare ? { kind: "servers", servers: bare } : { kind: "error", error: "shape" };
}

/** Legacy SSE entries, which pi does not support. */
export function sseServers(servers: Record<string, Entry>): string[] {
	return Object.entries(servers)
		.filter(([, server]) => server.type === "sse")
		.map(([name]) => name);
}

const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx", "pipx", "docker", "node", "python", "python3", "deno"]);
const GENERIC = new Set(["mcp", "www", "api", "server", "app", "sse"]);

/** A valid server name (letters, digits, `_`, `-`) guessed from the URL host or the command. */
export function suggestName(server: Entry): string {
	let guess = "";
	if (typeof server.url === "string" && URL.canParse(server.url)) {
		const url = new URL(server.url);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		guess = local
			? `local-${url.port || "server"}`
			: (url.hostname.split(".").find((part) => !GENERIC.has(part)) ?? url.hostname);
	} else if (typeof server.command === "string") {
		const program =
			server.command
				.split(/[\\/]/)
				.pop()
				?.replace(/\.(exe|cmd|js|mjs|py)$/, "") ?? "";
		const args = Array.isArray(server.args) ? server.args.filter((a): a is string => typeof a === "string") : [];
		const target = RUNNERS.has(program) ? args.find((arg) => !arg.startsWith("-")) : undefined;
		guess = (target ?? program)
			.replace(/@[^/@]*$/, "") // version suffix
			.split("/")
			.pop()
			?.replace(/^(mcp-server-|server-)|(-mcp-server|-mcp|-server)$/g, "") as string;
	}
	return (
		guess
			.replace(/[^A-Za-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "server"
	);
}
