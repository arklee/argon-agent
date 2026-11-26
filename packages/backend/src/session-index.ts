/**
 * Cached session listing. pi's SessionManager.listAll() parses every session file; doing that on each
 * `sessions.list` gets slow with many sessions. The cache is reused while a cheap fingerprint of the
 * session directory (file paths, sizes and mtimes) is unchanged: sessions only append to their files,
 * so any change to a session shows up in the fingerprint, whoever made it.
 */

import { stat } from "node:fs/promises";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { listSessionFiles } from "./uploads-gc.ts";

export class SessionIndex {
	private cached: { fingerprint: string; infos: SessionInfo[] } | undefined;
	private inflight: Promise<SessionInfo[]> | undefined;

	constructor(
		private readonly sessionsDir: string,
		private readonly listAll: () => Promise<SessionInfo[]> = () => SessionManager.listAll(),
	) {}

	/** Forget the cached listing (e.g. after deleting a file in the same millisecond it was written). */
	invalidate(): void {
		this.cached = undefined;
	}

	list(): Promise<SessionInfo[]> {
		// Concurrent callers share one scan.
		this.inflight ??= this.load().finally(() => {
			this.inflight = undefined;
		});
		return this.inflight;
	}

	private async load(): Promise<SessionInfo[]> {
		// Fingerprint first: a file changing while pi lists makes the next call list again.
		const fingerprint = await fingerprintSessions(this.sessionsDir);
		if (this.cached?.fingerprint === fingerprint) return this.cached.infos;
		const infos = await this.listAll();
		this.cached = { fingerprint, infos };
		return infos;
	}
}

export async function fingerprintSessions(root: string): Promise<string> {
	const files = (await listSessionFiles(root).catch(() => [])).sort();
	const parts = await Promise.all(
		files.map(async (path) => {
			const info = await stat(path).catch(() => undefined);
			return info ? `${path}\0${info.size}\0${info.mtimeMs}` : "";
		}),
	);
	return parts.join("\n");
}
