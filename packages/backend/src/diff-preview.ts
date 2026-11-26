/**
 * Diffs for file-changing tools, shown before approval and in the tool card. Output uses pi's display
 * format (`generateDiffString`: lines prefixed with `+`, `-` or ` ` and a line number), the same the
 * edit tool returns in `details.diff`, so previews and results render alike.
 *
 * Previews read the file on the backend machine (clients never do file IO). The edit preview matches
 * `oldText` exactly; pi's fuzzy matching is not exported, so a whitespace-tolerant match falls back
 * to diffing each replacement on its own.
 */

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { generateDiffString } from "@earendil-works/pi-coding-agent";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_LINES = 4000;

function resolvePath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return isAbsolute(path) ? path : resolve(cwd, path);
}

async function readExisting(path: string): Promise<string | undefined> {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
		return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
	} catch {
		return undefined;
	}
}

export function capDiff(diff: string): string {
	const lines = diff.split("\n");
	if (lines.length <= MAX_DIFF_LINES) return diff;
	return [...lines.slice(0, MAX_DIFF_LINES), `… ${lines.length - MAX_DIFF_LINES} more lines`].join("\n");
}

interface EditArgs {
	path?: unknown;
	edits?: unknown;
	oldText?: unknown;
	newText?: unknown;
}

function editList(args: EditArgs): { oldText: string; newText: string }[] {
	const raw = Array.isArray(args.edits) ? args.edits : [args];
	return raw.flatMap((edit) => {
		const e = (edit ?? {}) as EditArgs;
		return typeof e.oldText === "string" && typeof e.newText === "string"
			? [{ oldText: e.oldText, newText: e.newText }]
			: [];
	});
}

/** Display diff of what an `edit` or `write` call would change, or undefined for other tools. */
export async function previewDiff(toolName: string, input: unknown, cwd: string): Promise<string | undefined> {
	const args = (input ?? {}) as EditArgs & { content?: unknown };
	if (typeof args.path !== "string") return undefined;
	const path = resolvePath(args.path, cwd);

	if (toolName === "write") {
		if (typeof args.content !== "string") return undefined;
		const before = (await readExisting(path)) ?? "";
		return capDiff(generateDiffString(before, args.content.replace(/\r\n/g, "\n")).diff);
	}

	if (toolName === "edit") {
		const edits = editList(args);
		if (edits.length === 0) return undefined;
		const before = await readExisting(path);
		if (before !== undefined) {
			let after = before;
			let matched = true;
			for (const edit of edits) {
				const oldText = edit.oldText.replace(/\r\n/g, "\n");
				const index = after.indexOf(oldText);
				if (index === -1 || after.indexOf(oldText, index + 1) !== -1) {
					matched = false;
					break;
				}
				after = after.slice(0, index) + edit.newText.replace(/\r\n/g, "\n") + after.slice(index + oldText.length);
			}
			if (matched) return capDiff(generateDiffString(before, after).diff);
		}
		// Without an exact match, show each replacement by itself (line numbers are relative).
		return capDiff(edits.map((edit) => generateDiffString(edit.oldText, edit.newText).diff).join("\n   ...\n"));
	}

	return undefined;
}

/** The diff an edit tool result carries in `details.diff`, if any. */
export function resultDiff(result: unknown): string | undefined {
	const details = (result as { details?: { diff?: unknown } } | undefined)?.details;
	return typeof details?.diff === "string" && details.diff ? capDiff(details.diff) : undefined;
}
