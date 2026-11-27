/**
 * Argon's per-session preferences, per backend environment ($ARGON_HOME/session-prefs.json):
 * - pinned: pin timestamps keyed by session path;
 * - archived: session paths hidden from the main list (pi has no archive concept);
 * - externalSessions: session files outside pi's session directory that Argon has opened, so the
 *   uploads cleanup still sees their references after they are unloaded.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./log.ts";

interface Data {
	pinned: Record<string, number>;
	archived: string[];
	externalSessions: string[];
}

export class SessionPrefs {
	private readonly path: string;
	private readonly archived: Set<string>;
	private readonly pinned: Map<string, number>;
	private readonly external: Set<string>;
	private writing = Promise.resolve();

	constructor(argonHome: string) {
		this.path = join(argonHome, "session-prefs.json");
		const data = this.read();
		this.archived = new Set(data.archived);
		this.pinned = new Map(Object.entries(data.pinned).filter(([, at]) => Number.isFinite(at)));
		this.external = new Set(data.externalSessions);
	}

	isArchived(sessionPath: string): boolean {
		return this.archived.has(sessionPath);
	}

	pinnedAt(path: string) {
		return this.pinned.get(path);
	}

	async setPinned(path: string, pinned: boolean) {
		if (this.pinned.has(path) === pinned || (pinned && this.isArchived(path))) return;
		if (pinned) this.pinned.set(path, Date.now());
		else this.pinned.delete(path);
		await this.save();
	}

	async setArchived(sessionPath: string, archived: boolean): Promise<void> {
		if (this.archived.has(sessionPath) === archived) return;
		if (archived) {
			this.archived.add(sessionPath);
			this.pinned.delete(sessionPath);
		} else this.archived.delete(sessionPath);
		await this.save();
	}

	/** Remember a session file that lives outside pi's session directory. */
	async addExternalSession(sessionPath: string): Promise<void> {
		if (this.external.has(sessionPath)) return;
		this.external.add(sessionPath);
		await this.save();
	}

	async pruneExternalSessions(): Promise<void> {
		const missing: string[] = [];
		for (const path of this.external) {
			try {
				await access(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				missing.push(path);
			}
		}
		for (const path of missing) this.external.delete(path);
		if (missing.length > 0) await this.save();
	}

	async flush(): Promise<void> {
		await this.writing;
	}

	externalSessions(): string[] {
		return [...this.external];
	}

	/** Remove all private preferences for a deleted session. */
	async forget(sessionPath: string): Promise<void> {
		const wasArchived = this.archived.delete(sessionPath);
		const wasExternal = this.external.delete(sessionPath);
		if (this.pinned.delete(sessionPath) || wasArchived || wasExternal) await this.save();
	}

	private read(): Data {
		try {
			const data = JSON.parse(readFileSync(this.path, "utf8")) as Partial<Data>;
			const strings = (list: unknown) =>
				Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
			return {
				pinned: data.pinned ?? {},
				archived: strings(data.archived),
				externalSessions: strings(data.externalSessions),
			};
		} catch {
			return { pinned: {}, archived: [], externalSessions: [] };
		}
	}

	private save(): Promise<void> {
		const data: Data = {
			pinned: Object.fromEntries(this.pinned),
			archived: [...this.archived],
			externalSessions: [...this.external],
		};
		this.writing = this.writing.then(async () => {
			const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
			try {
				await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
				await rename(tmp, this.path);
			} catch (error) {
				await unlink(tmp).catch(() => undefined);
				log.error("could not save session preferences", error);
			}
		});
		return this.writing;
	}
}
