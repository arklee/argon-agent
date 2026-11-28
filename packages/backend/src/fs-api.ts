/** Minimal file-system browsing for picking project folders. Runs on the backend machine. */

import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { DirEntry, FileContent } from "@argon/shared";

import { resolveDisplayTarget } from "./path-target.ts";
import { RequestError } from "./request-error.ts";

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

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

/** Bounded reads for previews; paths and file IO belong exclusively to the backend. */
export async function readFileForDisplay(target: string, cwd: string | undefined): Promise<FileContent> {
	try {
		const resolved = resolveDisplayTarget(target, cwd);
		const info = await stat(resolved.path);
		if (!info.isFile()) throw new RequestError("bad_request", `Not a regular file: ${resolved.path}`);
		const base = { ...resolved, size: info.size, modifiedAt: info.mtimeMs };
		const mimeType = IMAGE_MIME_TYPES[extname(resolved.path).toLowerCase()];
		if (mimeType && info.size > MAX_IMAGE_BYTES) return { ...base, kind: "image" };
		const handle = await open(resolved.path, "r");
		try {
			// Read one extra byte for images, four for text (one complete UTF-8 character).
			const limit = mimeType ? MAX_IMAGE_BYTES + 1 : MAX_TEXT_BYTES + 4;
			const buffer = Buffer.alloc(Math.min(info.size + 1, limit));
			let length = 0;
			let eof = false;
			while (length < buffer.length) {
				const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
				if (bytesRead === 0) {
					eof = true;
					break;
				}
				length += bytesRead;
			}
			const bytes = buffer.subarray(0, length);
			if (mimeType) {
				return {
					...base,
					kind: "image",
					...(length <= MAX_IMAGE_BYTES ? { image: { mimeType, data: bytes.toString("base64") } } : {}),
				};
			}
			if (bytes.subarray(0, 8192).includes(0)) return { ...base, kind: "binary" };
			const truncated = length > MAX_TEXT_BYTES || info.size > MAX_TEXT_BYTES;
			let text: string;
			try {
				// Validate the lookahead too, but allow a pending character at a non-EOF read boundary.
				new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: !eof });
				text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, MAX_TEXT_BYTES), {
					stream: truncated,
				});
			} catch {
				return { ...base, kind: "binary" };
			}
			if (truncated) {
				const newline = text.lastIndexOf("\n");
				if (newline >= 0) text = text.slice(0, newline + 1);
			}
			return { ...base, kind: "text", text, ...(truncated ? { truncated: true } : {}) };
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (error instanceof RequestError) throw error;
		const code = (error as NodeJS.ErrnoException).code;
		throw new RequestError(
			code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "bad_request",
			error instanceof Error ? error.message : String(error),
		);
	}
}
