/**
 * `@file` completion, delegated to pi-tui's CombinedAutocompleteProvider so matching, quoting and
 * directory handling are exactly what pi's own editor does. It searches with `fd`, looked up like pi
 * does (agent dir's bin/, then PATH); without fd only the top-level entries of a directory are offered.
 */

import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { CompletionItem } from "@argon/shared";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

const fdCache = new Map<string, string | null>();

/** Platform-aware lookup; a Windows PATH entry can contain a drive colon and spaces. */
export function findFd(
	agentDir: string,
	platform: string = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	exists: (path: string) => boolean = existsSync,
): string | null {
	const windows = platform === "win32";
	const path = windows ? win32 : posix;
	const names = windows ? ["fd.exe", "fdfind.exe"] : ["fd", "fdfind"];
	const local = path.join(agentDir, "bin", names[0]!);
	if (exists(local)) return local;
	const searchPath =
		Object.entries(env).find(([key]) => (windows ? key.toLowerCase() === "path" : key === "PATH"))?.[1] ?? "";
	for (const name of names) {
		for (const entry of searchPath.split(path.delimiter)) {
			const dir = entry.replace(/^"(.*)"$/, "$1");
			if (!dir) continue;
			const candidate = path.join(dir, name);
			if (exists(candidate)) return candidate;
		}
	}
	return null;
}

function fdPath(agentDir: string): string | null {
	const cached = fdCache.get(agentDir);
	if (cached !== undefined) return cached;
	const found = findFd(agentDir);
	fdCache.set(agentDir, found);
	return found;
}

export interface FileCompletion {
	/** The `@...` text before the cursor that the chosen value replaces. */
	prefix: string;
	items: (CompletionItem & { isDirectory: boolean })[];
}

/** Suggestions for the `@` reference that ends at the end of `textBeforeCursor`, if there is one. */
export async function completeFile(
	textBeforeCursor: string,
	cwd: string,
	agentDir: string,
	signal: AbortSignal,
): Promise<FileCompletion | undefined> {
	const lines = textBeforeCursor.split("\n");
	const cursorLine = lines.length - 1;
	const cursorCol = lines[cursorLine]?.length ?? 0;
	const provider = new CombinedAutocompleteProvider([], cwd, fdPath(agentDir));
	const result = await provider.getSuggestions(lines, cursorLine, cursorCol, { signal });
	if (!result?.prefix.startsWith("@")) return undefined;
	return {
		prefix: result.prefix,
		items: result.items.slice(0, 50).map((item) => ({
			value: item.value,
			label: item.label,
			description: item.description,
			isDirectory: item.label.endsWith("/"),
		})),
	};
}
