import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { cleanPathText, resolvePathTarget } from "../vendor/percho-path-target/src/path-target.ts";
import { RequestError } from "./request-error.ts";

/** Preserve display anchors before the upstream resolver strips them. */
export function parseDisplayTarget(target: string): { target: string; line?: number; endLine?: number } {
	let text = target.trim();
	const wrappers: Record<string, string> = { "`": "`", '"': '"', "'": "'", "<": ">", "(": ")", "[": "]" };
	while (text.length > 1 && wrappers[text[0]!] === text.at(-1)) text = text.slice(1, -1).trim();
	const match = /(?::(\d+)(?::\d+)?|#L(\d+)(?:[-–]L?(\d+))?(?:C\d+)?)$/i.exec(text);
	if (!match) return { target: text };
	const line = Number(match[1] ?? match[2]);
	const endLine = Number(match[3]);
	return {
		target: text.slice(0, match.index).trim(),
		...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
		...(Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(endLine) && endLine > line ? { endLine } : {}),
	};
}

export function resolveDisplayTarget(target: string, cwd: string | undefined) {
	const parsed = parseDisplayTarget(target);
	if (!cleanPathText(parsed.target)) throw new RequestError("bad_request", "File target is empty");
	return {
		path: resolvePathTarget(parsed.target, cwd && isAbsolute(cwd) ? cwd : homedir()),
		line: parsed.line,
		endLine: parsed.endLine,
	};
}
