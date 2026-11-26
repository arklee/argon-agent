import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionIndex } from "../src/session-index.ts";

let root: string;
let file: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "argon-session-index-"));
	mkdirSync(join(root, "project"));
	file = join(root, "project", "session.jsonl");
	writeFileSync(file, "{}\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("SessionIndex", () => {
	it("reuses the cached listing when files have not changed", async () => {
		const infos: SessionInfo[] = [];
		const listAll = vi.fn(async () => infos);
		const index = new SessionIndex(root, listAll);
		expect(await index.list()).toBe(infos);
		expect(await index.list()).toBe(infos);
		expect(listAll).toHaveBeenCalledTimes(1);
	});

	it.each(["append", "add"])("reloads after %s changes the fingerprint", async (change) => {
		const first: SessionInfo[] = [];
		const second: SessionInfo[] = [];
		const listAll = vi.fn<() => Promise<SessionInfo[]>>().mockResolvedValueOnce(first).mockResolvedValue(second);
		const index = new SessionIndex(root, listAll);
		expect(await index.list()).toBe(first);
		if (change === "append") appendFileSync(file, '{"message":"new"}\n');
		else writeFileSync(join(root, "project", "new.jsonl"), "{}\n");
		expect(await index.list()).toBe(second);
		expect(await index.list()).toBe(second);
		expect(listAll).toHaveBeenCalledTimes(2);
	});

	it("shares one pending load between concurrent callers", async () => {
		let release!: (infos: SessionInfo[]) => void;
		let started!: () => void;
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		const pending = new Promise<SessionInfo[]>((resolve) => {
			release = resolve;
		});
		const listAll = vi.fn(() => {
			started();
			return pending;
		});
		const index = new SessionIndex(root, listAll);
		const first = index.list();
		await entered;
		const second = index.list();
		expect(second).toBe(first);
		expect(listAll).toHaveBeenCalledTimes(1);
		const infos: SessionInfo[] = [];
		release(infos);
		expect(await Promise.all([first, second])).toEqual([infos, infos]);
	});

	it("invalidate forces a reload without file changes", async () => {
		const listAll = vi.fn(async (): Promise<SessionInfo[]> => []);
		const index = new SessionIndex(root, listAll);
		await index.list();
		index.invalidate();
		await index.list();
		expect(listAll).toHaveBeenCalledTimes(2);
	});
});
