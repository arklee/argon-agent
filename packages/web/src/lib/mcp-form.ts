/** Text-field conversions for the MCP server form (settings → MCP). */

import type { McpServerForm } from "@argon/shared";

/** One value per non-empty line (trimmed). */
export function parseLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * `KEY=value` (env) or `Name: value` (headers) per line. Returns the map, or the first line without the
 * separator as an error.
 */
export function parsePairs(text: string, separator: "=" | ":"): { pairs: Record<string, string> } | { error: string } {
	const pairs: Record<string, string> = {};
	for (const line of parseLines(text)) {
		const at = line.indexOf(separator);
		const key = at > 0 ? line.slice(0, at).trim() : "";
		if (!key) return { error: line };
		pairs[key] = line.slice(at + 1).trim();
	}
	return { pairs };
}

export function formatPairs(pairs: Record<string, string> | undefined, separator: "=" | ":"): string {
	const glue = separator === ":" ? ": " : "=";
	return Object.entries(pairs ?? {})
		.map(([key, value]) => `${key}${glue}${value}`)
		.join("\n");
}

/** One-line summary: the command line or the URL. */
export function describeForm(form: McpServerForm): string {
	return form.transport === "stdio" ? [form.command, ...(form.args ?? [])].join(" ") : form.url;
}
