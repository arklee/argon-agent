import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { log } from "../src/log.ts";
import { listSessionFiles, UploadsGc } from "../src/uploads-gc.ts";

describe("upload cleanup", () => {
	let home: string;
	let uploadsRoot: string;
	let sessionsRoot: string;
	let memory: string[];
	let gc: UploadsGc;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "argon-uploads-gc-"));
		uploadsRoot = join(home, "uploads");
		sessionsRoot = join(home, "sessions");
		memory = [];
		gc = makeGc();
	});

	afterEach(async () => {
		await gc.dispose();
		vi.restoreAllMocks();
		await rm(home, { recursive: true, force: true });
	});

	function makeGc(readSessionFile?: (path: string) => Promise<string>): UploadsGc {
		return new UploadsGc({
			uploadsRoot,
			listSessionFiles: () => listSessionFiles(sessionsRoot),
			memoryReferences: () => memory,
			readSessionFile,
		});
	}

	async function upload(id: string, ageHours = 0, date = "2026-11-24"): Promise<string> {
		const dir = join(uploadsRoot, date, id);
		const path = join(dir, "attachment.txt");
		await mkdir(dir, { recursive: true });
		await writeFile(path, "attachment");
		const time = new Date(Date.now() - ageHours * 60 * 60 * 1000);
		await utimes(dir, time, time);
		return path;
	}

	function reference(path: string): string {
		return JSON.stringify({ type: "message", message: { content: `Read this @"${path}"` } });
	}

	async function session(name: string, ...uploads: string[]): Promise<string> {
		const path = join(sessionsRoot, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, uploads.map(reference).join("\n"));
		return path;
	}

	async function deleteSession(path: string): Promise<void> {
		const keys = await gc.readDeletedSession(path);
		await unlink(path);
		await gc.cleanDeletedSession(keys);
	}

	test("keeps an upload shared with a remaining session", async () => {
		const path = await upload("abcdef01");
		const deleted = await session("project/deleted.jsonl", path);
		await session("another-project/nested/remaining.jsonl", path);

		await deleteSession(deleted);

		expect(existsSync(path)).toBe(true);
	});

	test("removes uploads referenced only by the deleted session regardless of age", async () => {
		const info = vi.spyOn(log, "info");
		const path = await upload("abcdef01");
		const deleted = await session("project/deleted.jsonl", path);

		await deleteSession(deleted);

		expect(existsSync(dirname(path))).toBe(false);
		expect(info).toHaveBeenCalledWith("uploads cleanup removed 1 upload directories and freed 10 bytes");
	});

	test("keeps uploads referenced by an unsaved session", async () => {
		const path = await upload("abcdef01", 30);
		memory.push(reference(path));
		const deleted = await session("project/deleted.jsonl", path);

		await deleteSession(deleted);
		await gc.sweep();

		expect(existsSync(path)).toBe(true);
	});

	test("sweeps only old orphans and prunes empty date directories", async () => {
		const orphan = await upload("abcdef01", 25, "2026-11-23");
		const fresh = await upload("abcdef02", 23);
		const referenced = await upload("abcdef03", 48);
		const otherRoot = await upload("abcdef04", 48);
		await session("project/remaining.jsonl", referenced, join(home, "other", otherRoot));

		await gc.sweep();

		expect(existsSync(dirname(dirname(orphan)))).toBe(false);
		expect(existsSync(dirname(otherRoot))).toBe(false);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(referenced)).toBe(true);
	});

	test("recognizes plain and JSON-escaped Windows-style separators", async () => {
		const raw = await upload("abcdef01", 30);
		const escaped = await upload("abcdef02", 30);
		const existing = await session("project/remaining.jsonl", escaped.replaceAll("/", "\\"));
		await writeFile(existing, `\n${raw.replaceAll("/", "\\")}\n`, { flag: "a" });

		await gc.sweep();

		expect(existsSync(raw)).toBe(true);
		expect(existsSync(escaped)).toBe(true);
	});

	test("keeps symlinks at the date, upload and attachment levels", async () => {
		const outside = join(home, "outside");
		await mkdir(join(outside, "abcdef01"), { recursive: true });
		const outsideFile = join(outside, "abcdef01", "attachment.txt");
		await writeFile(outsideFile, "outside");
		const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
		await utimes(dirname(outsideFile), oldTime, oldTime);

		const dateLink = join(uploadsRoot, "2026-11-23");
		const uploadLink = join(uploadsRoot, "2026-11-24", "abcdef01");
		const regular = await upload("abcdef02", 48);
		const fileLink = join(dirname(regular), "link");
		await symlink(outside, dateLink, "junction");
		await symlink(dirname(outsideFile), uploadLink, "junction");
		await symlink(outsideFile, fileLink, "file");
		await utimes(dirname(regular), oldTime, oldTime);

		const deleted = await session("project/deleted.jsonl", join(uploadLink, "attachment.txt"));
		await deleteSession(deleted);
		await gc.sweep();

		for (const link of [dateLink, uploadLink, fileLink]) expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect(await readFile(outsideFile, "utf8")).toBe("outside");
	});

	test("aborts the whole cleanup on a session read error and can retry", async () => {
		const path = await upload("abcdef01", 30);
		const otherPath = await upload("abcdef02", 30);
		const blocked = await session("project/unreadable.jsonl");
		const deleted = await session("project/deleted.jsonl", path);
		gc = makeGc((file) => {
			if (file === blocked) return Promise.reject(Object.assign(new Error("Permission denied"), { code: "EACCES" }));
			return readFile(file, "utf8");
		});
		const errors = vi.spyOn(log, "error").mockImplementation(() => {});
		await deleteSession(deleted);
		await gc.sweep();

		expect(existsSync(path)).toBe(true);
		expect(existsSync(otherPath)).toBe(true);
		expect(errors).toHaveBeenCalledTimes(2);

		await unlink(blocked);
		await gc.sweep();

		expect(existsSync(dirname(path))).toBe(false);
		expect(existsSync(dirname(otherPath))).toBe(false);
	});

	test("rediscovers files when a session unloads during the scan", async () => {
		const path = await upload("abcdef01", 30);
		const first = await session("project/first.jsonl");
		let wroteSession = false;
		gc = makeGc(async (file) => {
			if (file === first && !wroteSession) {
				wroteSession = true;
				await session("project/newly-saved.jsonl", path);
				gc.sessionUnloaded();
			}
			return readFile(file, "utf8");
		});

		await gc.sweep();

		expect(existsSync(path)).toBe(true);
	});

	test("serializes the sweep and session-delete cleanup", async () => {
		const swept = await upload("abcdef01", 30);
		const deleted = await upload("abcdef02");
		await session("project/remaining.jsonl");
		let activeReads = 0;
		let maxActiveReads = 0;
		let reads = 0;
		gc = makeGc(async (path) => {
			activeReads++;
			maxActiveReads = Math.max(maxActiveReads, activeReads);
			try {
				return await readFile(path, "utf8");
			} finally {
				reads++;
				activeReads--;
			}
		});

		await Promise.all([gc.sweep(), gc.cleanDeletedSession(new Set(["2026-11-24/abcdef02"]))]);

		expect(reads).toBe(2);
		expect(maxActiveReads).toBe(1);
		expect(existsSync(swept)).toBe(false);
		expect(existsSync(deleted)).toBe(false);
	});
});
