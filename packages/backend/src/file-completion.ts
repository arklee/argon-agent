/**
 * `@file` completion, delegated to pi-tui's CombinedAutocompleteProvider so matching, quoting and
 * directory handling are exactly what pi's own editor does. It searches with `fd`, looked up like pi
 * does (agent dir's bin/, then PATH); without fd only the top-level entries of a directory are offered.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CompletionItem } from "@argon/shared";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

const fdCache = new Map<string, string | null>();

function findOnPath(name: string): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (dir && existsSync(join(dir, name))) return join(dir, name);
	}
	return undefined;
}

function fdPath(agentDir: string): string | null {
	const cached = fdCache.get(agentDir);
	if (cached !== undefined) return cached;
	const local = join(agentDir, "bin", "fd");
	const found = existsSync(local) ? local : (findOnPath("fd") ?? findOnPath("fdfind") ?? null);
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
