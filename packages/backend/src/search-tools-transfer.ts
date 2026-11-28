/** Shared by the backend and maintainer/desktop scripts. Never executes a downloaded binary. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

export const MAX_TOOL_BYTES = 40 * 1024 * 1024;
const exec = promisify(execFile);
export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
export async function fileHash(path: string): Promise<string> {
	return sha256(await readFile(path));
}
export function toolsMirror(value: string): string {
	const mirror = value.trim();
	if (mirror === "github" || mirror === "npmmirror") return mirror;
	try {
		const url = new URL(mirror);
		if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash)
			return url.href.replace(/\/+$/, "");
	} catch {
		/* Report one consistent validation error. */
	}
	throw new Error(
		"Tools mirror must be github, npmmirror, or an HTTPS base URL without credentials, query or fragment",
	);
}
export function mirrorUrl(github: string, mirror: string): string {
	const base = toolsMirror(mirror);
	if (base === "npmmirror") throw new Error("npmmirror requires its own manifest source");
	return base === "github" ? github : github.replace(/^https:\/\/github\.com(?=\/)/, base);
}
/** "fetch failed" hides the useful part (DNS, TLS, timeout) in `cause`. */
export function errorChain(error: unknown): string {
	const messages: string[] = [];
	for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++)
		if (!messages.includes(current.message)) messages.push(current.message);
	return messages.length ? messages.join(": ") : String(error);
}
export async function downloadTool(
	url: string,
	destination: string,
	progress: (received: number, total?: number) => void = () => {},
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);
	try {
		const response = await fetcher(url, { signal: controller.signal });
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		const total = Number(response.headers.get("content-length")) || undefined;
		if (total && total > MAX_TOOL_BYTES) throw new Error("Download exceeds 40 MiB");
		const file = await open(destination, "wx", 0o600);
		let received = 0;
		let last = 0;
		try {
			for await (const chunk of response.body) {
				received += chunk.length;
				if (received > MAX_TOOL_BYTES) throw new Error("Download exceeds 40 MiB");
				await file.writeFile(chunk);
				if (Date.now() - last >= 150) {
					progress(received, total);
					last = Date.now();
				}
			}
			progress(received, total);
		} finally {
			await file.close();
		}
	} catch (error) {
		throw new Error(`${url}: ${errorChain(error)}`);
	} finally {
		controller.abort();
		clearTimeout(timeout);
	}
}

/** Extract only the named regular binary to stdout, never archive paths onto the filesystem.
 * This bounds decompressed size and avoids archive traversal/symlink writes for uploaded archives. */
export async function extractTool(archive: string, name: string, binary: string, destination: string): Promise<void> {
	if (!/\.(tar\.gz|tgz|zip)$/i.test(name)) {
		const data = await readFile(archive);
		if (data.length > MAX_TOOL_BYTES) throw new Error("Binary exceeds 40 MiB");
		await writeFile(destination, data, { mode: 0o600 });
		return;
	}
	const tar =
		process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
	const zip = /\.zip$/i.test(name) && process.platform !== "win32";
	const extract = async (unzip: boolean) => {
		const command = unzip ? "unzip" : tar;
		const listed = await exec(command, unzip ? ["-Z1", archive] : ["-tf", archive], {
			timeout: 30_000,
			maxBuffer: MAX_TOOL_BYTES,
		});
		const entries = listed.stdout.split(/\r?\n/).filter((entry) => basename(entry) === binary && !entry.endsWith("/"));
		if (entries.length !== 1) throw new Error(`Expected exactly one ${binary} in ${name}`);
		const member = entries[0]!;
		if (member.startsWith("/") || member.split(/[\\/]/).includes("..") || member.startsWith("-"))
			throw new Error("Unsafe archive member");
		const result = await exec(command, unzip ? ["-p", archive, member] : ["-xOf", archive, "--", member], {
			encoding: "buffer",
			timeout: 30_000,
			maxBuffer: MAX_TOOL_BYTES,
		});
		if (!result.stdout.length) throw new Error(`Empty binary in ${name}`);
		await writeFile(destination, result.stdout, { mode: 0o600 });
	};
	if (zip) {
		try {
			await extract(true);
			return;
		} catch {
			/* BSD tar also supports zip. */
		}
	}
	await extract(false);
}
