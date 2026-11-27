import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionPrefs } from "../src/session-prefs.ts";

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "argon-session-prefs-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("SessionPrefs", () => {
	it("persists archive and unarchive across instances", async () => {
		const path = join(home, "session.jsonl");
		const prefs = new SessionPrefs(home);
		expect(prefs.isArchived(path)).toBe(false);
		await prefs.setArchived(path, true);
		const reopened = new SessionPrefs(home);
		expect(reopened.isArchived(path)).toBe(true);
		await reopened.setArchived(path, false);
		expect(new SessionPrefs(home).isArchived(path)).toBe(false);
	});

	it("deduplicates external sessions and retains more than 500", async () => {
		const prefs = new SessionPrefs(home);
		const paths = Array.from({ length: 501 }, (_, i) => join(home, `${i}.jsonl`));
		for (const path of paths.slice(0, 500)) await prefs.addExternalSession(path);
		await prefs.addExternalSession(paths[0]!);
		expect(prefs.externalSessions()).toEqual(paths.slice(0, 500));
		await prefs.addExternalSession(paths[500]!);
		expect(prefs.externalSessions()).toEqual(paths);
		expect(new SessionPrefs(home).externalSessions()).toEqual(paths);
	});

	it("prunes only missing files and persists the remaining references", async () => {
		const prefs = new SessionPrefs(home);
		const kept = join(home, "kept.jsonl");
		writeFileSync(kept, "");
		await prefs.addExternalSession(kept);
		await prefs.addExternalSession(join(home, "missing.jsonl"));
		await prefs.pruneExternalSessions();
		expect(new SessionPrefs(home).externalSessions()).toEqual([kept]);
		await prefs.addExternalSession(join(kept, "invalid.jsonl"));
		await expect(prefs.pruneExternalSessions()).rejects.toMatchObject({ code: "ENOTDIR" });
		expect(prefs.externalSessions()).toHaveLength(2);
	});

	it("uses independent temporary files for concurrent instances and flushes queued writes", async () => {
		const first = new SessionPrefs(home);
		const second = new SessionPrefs(home);
		void first.setArchived("first", true);
		void second.setArchived("second", true);
		await Promise.all([first.flush(), second.flush()]);
		expect(readdirSync(home)).toEqual(["session-prefs.json"]);
		const prefs = new SessionPrefs(home);
		expect(prefs.isArchived("first") || prefs.isArchived("second")).toBe(true);
	});

	it("removes temporary files when rename fails", async () => {
		mkdirSync(join(home, "session-prefs.json"));
		const prefs = new SessionPrefs(home);
		await prefs.setArchived("session", true);
		await prefs.flush();
		expect(readdirSync(home)).toEqual(["session-prefs.json"]);
	});

	it("forget removes the session from both persisted lists and preserves others", async () => {
		const prefs = new SessionPrefs(home);
		const removed = join(home, "removed.jsonl");
		const retained = join(home, "retained.jsonl");
		for (const path of [removed, retained]) {
			await prefs.setArchived(path, true);
			await prefs.addExternalSession(path);
		}
		await prefs.forget(removed);
		for (const instance of [prefs, new SessionPrefs(home)]) {
			expect(instance.isArchived(removed)).toBe(false);
			expect(instance.isArchived(retained)).toBe(true);
			expect(instance.externalSessions()).toEqual([retained]);
		}
	});

	it("loads corrupt JSON as empty preferences", () => {
		writeFileSync(join(home, "session-prefs.json"), '{"archived":[');
		const prefs = new SessionPrefs(home);
		expect(prefs.externalSessions()).toEqual([]);
		expect(prefs.isArchived(join(home, "session.jsonl"))).toBe(false);
	});
});

it("reads older prefs and persists pin, unpin, archive and deletion", async () => {
	writeFileSync(join(home, "session-prefs.json"), JSON.stringify({ archived: ["old"] }));
	const prefs = new SessionPrefs(home);
	expect(prefs.isArchived("old")).toBe(true);
	expect(prefs.pinnedAt("a")).toBeUndefined();
	for (const action of ["unpin", "archive", "forget"]) {
		await prefs.setPinned("a", true);
		const at = new SessionPrefs(home).pinnedAt("a");
		expect(at).toEqual(expect.any(Number));
		await prefs.setPinned("a", true);
		expect(prefs.pinnedAt("a")).toBe(at);
		if (action === "archive") await prefs.setArchived("a", true);
		else if (action === "forget") await prefs.forget("a");
		else await prefs.setPinned("a", false);
		expect(new SessionPrefs(home).pinnedAt("a")).toBeUndefined();
		await prefs.setArchived("a", false);
	}
});
