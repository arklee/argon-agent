/** Minimal file-system browsing for picking project folders. Runs on the backend machine. */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DirEntry } from "@argon/shared";

export async function listDir(
	path: string | undefined,
	dirsOnly: boolean,
): Promise<{ path: string; parent?: string; entries: DirEntry[] }> {
	const target = resolve(path && path.length > 0 ? path.replace(/^~(?=$|\/)/, homedir()) : homedir());
	const info = await stat(target);
	if (!info.isDirectory()) throw new Error(`Not a directory: ${target}`);
	const dirents = await readdir(target, { withFileTypes: true });
	const entries: DirEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.name.startsWith(".")) continue;
		const isDir = dirent.isDirectory();
		if (dirsOnly && !isDir) continue;
		entries.push({ name: dirent.name, path: join(target, dirent.name), isDir });
	}
	entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
	const parent = dirname(target);
	return { path: target, parent: parent !== target ? parent : undefined, entries };
}
