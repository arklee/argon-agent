/** Minimal file-system browsing for picking project folders. Runs on the backend machine. */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Store a file the client uploaded (browsers cannot hand over paths) under `$ARGON_HOME/uploads`, so
 * the agent can read it. Returns the backend-side path. The name is reduced to a safe basename.
 */
export async function saveUpload(argonHome: string, name: string, base64: string): Promise<{ path: string }> {
	const data = Buffer.from(base64, "base64");
	if (data.length > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
	const safeName =
		basename(name)
			.replace(/[^\w.\- ]+/g, "_")
			.slice(0, 120) || "file";
	const dir = join(argonHome, "uploads", new Date().toISOString().slice(0, 10), randomUUID().slice(0, 8));
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, safeName);
	await writeFile(path, data, { mode: 0o600 });
	return { path };
}
