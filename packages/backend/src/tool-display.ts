import type { ToolDisplay } from "@argon/shared";

import { patchedPaths } from "./apply-patch.ts";

function stringArg(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberArg(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readSummary(path: string, offset: number | undefined, limit: number | undefined): string {
	if (offset === undefined && limit === undefined) return path;
	// Use 1-based inclusive ranges. A trailing dash means no limit.
	const start = Math.max(1, offset ?? 1);
	if (!Number.isInteger(start) || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) {
		// Pi accepts numeric arguments that don't describe a positive whole-line range.
		return `${path} (offset ${offset ?? 1}, limit ${limit ?? "unset"})`;
	}
	return `${path}:${start}-${limit === undefined ? "" : start + (limit - 1)}`;
}

function describeKnownTool(title: string, args: Record<string, unknown>): ToolDisplay | undefined {
	switch (title) {
		case "bash":
		case "powershell": {
			// Both tools take the working directory from the SDK context.
			const command = stringArg(args.command);
			if (command) return { kind: "shell", title, command, summary: command.split(/\r\n?|\n/, 1)[0] };
			break;
		}
		case "web_run": {
			const operations = ["search_query", "image_query", "open", "click", "find"];
			const summary = operations
				.flatMap((op) =>
					Array.isArray(args[op])
						? (args[op] as unknown[]).flatMap((value) => {
								if (!value || typeof value !== "object") return [];
								const item = value as Record<string, unknown>;
								const text = stringArg(item.q) ?? stringArg(item.ref_id);
								return text ? [text] : [];
							})
						: [],
				)
				.join(" · ");
			return { kind: "generic", title, summary: summary.slice(0, 240) };
		}
		case "codex_imagegen": {
			const prompt = stringArg(args.prompt);
			if (prompt !== undefined)
				return { kind: "generic", title, summary: (prompt.split(/\r\n?|\n/, 1)[0] ?? "").slice(0, 120) };
			break;
		}
		case "read": {
			const path = stringArg(args.path);
			if (!path) break;
			const offset = numberArg(args.offset);
			const limit = numberArg(args.limit);
			return {
				kind: "file_read",
				title,
				path,
				...(offset === undefined ? {} : { offset }),
				...(limit === undefined ? {} : { limit }),
				summary: readSummary(path, offset, limit),
			};
		}
		case "apply_patch": {
			const files = patchedPaths(stringArg(args.input) ?? "") ?? [];
			return {
				kind: "file_change",
				title,
				files,
				summary: files.length ? `${files[0]!.path}${files.length > 1 ? ` +${files.length - 1}` : ""}` : "",
			};
		}
		case "edit":
		case "write": {
			const path = stringArg(args.path);
			if (!path) break;
			const files = title === "edit" ? [{ path, op: "update" as const }] : [{ path }];
			return { kind: "file_change", title, files, summary: path };
		}
		case "grep":
		case "find": {
			const pattern = stringArg(args.pattern);
			if (pattern === undefined) break;
			const path = stringArg(args.path);
			return {
				kind: "search",
				title,
				mode: title === "grep" ? "content" : "files",
				pattern,
				...(path === undefined ? {} : { path }),
				summary: pattern && path ? `${pattern} in ${path}` : pattern || path || "",
			};
		}
		case "ls": {
			const path = stringArg(args.path) || ".";
			return { kind: "search", title, mode: "list", path, summary: path };
		}
		case "codemode": {
			const source = stringArg(args.code);
			if (!source?.trim()) break;
			const summary = source
				.split(/\r\n?|\n/)
				.map((line) => line.trim())
				.find((line) => line && !line.startsWith("// @options:"));
			return { kind: "script", title, language: "javascript", source, summary: summary ?? "" };
		}
	}
}

export function describeToolCall(name: string, args: unknown): ToolDisplay {
	let summary = "";
	try {
		if (args !== null && typeof args === "object" && !Array.isArray(args)) {
			const display = describeKnownTool(name, args as Record<string, unknown>);
			if (display) return display;
		}
		const json = JSON.stringify(args);
		if (json && json !== "{}") summary = json.slice(0, 120);
	} catch {
		// Malformed inputs can include throwing property access or values JSON cannot serialize.
	}
	return { kind: "generic", title: name, summary };
}
