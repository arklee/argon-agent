import { lstatSync, rmdirSync, rmSync, type Stats } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { log } from "./log.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const ID = "[0-9a-fA-F]{8}";
const datePattern = new RegExp(`^${DATE}$`);
const idPattern = new RegExp(`^${ID}$`);
const keyPattern = new RegExp(`^${DATE}/${ID}$`);
const separator = String.raw`(?:/|\\{1,2})`;

interface Options {
	uploadsRoot: string;
	listSessionFiles: () => Promise<Iterable<string>>;
	memoryReferences: () => Iterable<string>;
	readSessionFile?: (path: string) => Promise<string>;
}

interface Candidate {
	key: string;
	path: string;
	info: Stats;
	dateInfo: Stats;
	bytes: number;
}

export class UploadsGc {
	private readonly root: string;
	private readonly referencePattern: RegExp;
	private readonly readSessionFile: NonNullable<Options["readSessionFile"]>;
	private sessionRevision = 0;
	private pending = Promise.resolve();
	private timer?: NodeJS.Timeout;

	constructor(private readonly options: Options) {
		this.root = resolve(options.uploadsRoot);
		const rootPattern = this.root
			.split(process.platform === "win32" ? /[/\\]/ : "/")
			.map((part) => {
				const escaped = JSON.stringify(part).slice(1, -1);
				const literal = escapeRegex(part);
				return escaped === part ? literal : `(?:${literal}|${escapeRegex(escaped)})`;
			})
			.join(separator);
		this.referencePattern = new RegExp(
			String.raw`(?<![\w./\\~-])${rootPattern}${separator}(${DATE})${separator}(${ID})(?![\w.-])`,
			process.platform === "win32" ? "gi" : "g",
		);
		this.readSessionFile = options.readSessionFile ?? ((path) => readFile(path, "utf8"));
	}

	/** Capture candidates before the session file is unlinked. A read failure only skips cleanup. */
	async readDeletedSession(path: string): Promise<Set<string>> {
		try {
			return this.collectReferences(await this.readSessionFile(path));
		} catch (error) {
			if (!isMissing(error)) log.error("could not read deleted session for uploads cleanup", error);
			return new Set();
		}
	}

	cleanDeletedSession(keys: ReadonlySet<string>): Promise<void> {
		return keys.size ? this.enqueue(() => this.clean(keys)) : Promise.resolve();
	}

	sweep(): Promise<void> {
		return this.enqueue(() => this.clean());
	}

	sessionUnloaded(): void {
		this.sessionRevision++;
	}

	start(): void {
		const schedule = (delay: number) => {
			this.timer = setTimeout(() => {
				void this.sweep();
				schedule(DAY_MS);
			}, delay).unref();
		};
		schedule(5_000);
	}

	async dispose(): Promise<void> {
		clearTimeout(this.timer);
		await this.pending;
	}

	private enqueue(run: () => Promise<void>): Promise<void> {
		this.pending = this.pending.then(run).catch((error) => log.error("uploads cleanup failed", error));
		return this.pending;
	}

	private collectReferences(text: string, keys = new Set<string>()): Set<string> {
		for (const [, date, id] of text.matchAll(this.referencePattern)) {
			keys.add(referenceKey(`${date}/${id}`));
		}
		return keys;
	}

	private async collectSessionReferences(): Promise<Set<string>> {
		const references = new Set<string>();
		for (const text of this.options.memoryReferences()) this.collectReferences(text, references);
		for (const path of new Set(await this.options.listSessionFiles())) {
			try {
				this.collectReferences(await this.readSessionFile(path), references);
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
		}
		return references;
	}

	private async clean(keys?: ReadonlySet<string>): Promise<void> {
		const cutoff = Date.now() - DAY_MS;
		const rootInfo = await directoryInfo(this.root);
		if (!rootInfo) return;

		const dates = new Map<string, Stats>();
		const candidates: Candidate[] = [];
		const dateNames = keys
			? new Set([...keys].filter((key) => keyPattern.test(key)).map((key) => key.slice(0, 10)))
			: await directoryNames(this.root, datePattern);
		for (const date of dateNames) {
			const datePath = join(this.root, date);
			const dateInfo = await directoryInfo(datePath);
			if (!dateInfo) continue;
			dates.set(datePath, dateInfo);
			for (const id of await directoryNames(datePath, idPattern)) {
				const key = referenceKey(`${date}/${id}`);
				if (keys && !keys.has(key)) continue;
				const path = resolve(this.root, date, id);
				const info = await directoryInfo(path);
				if (!info || (!keys && info.mtimeMs >= cutoff)) continue;
				const bytes = await uploadBytes(path);
				if (bytes !== undefined) candidates.push({ key, path, info, dateInfo, bytes });
			}
		}

		// Nothing old enough or unreferenced by the deleted session: skip reading every session file.
		if (!candidates.length) return;
		let revision: number;
		let references: Set<string>;
		do {
			revision = this.sessionRevision;
			references = await this.collectSessionReferences();
			// A session may have written a file and unloaded after disk discovery.
		} while (revision !== this.sessionRevision);
		// Capture references added while doing disk I/O. Do not yield between this
		// snapshot and removal, so loaded sessions cannot gain a reference meanwhile.
		for (const text of this.options.memoryReferences()) this.collectReferences(text, references);

		let removed = 0;
		let bytesFreed = 0;
		for (const { key, path, info, dateInfo, bytes } of candidates) {
			if (references.has(key)) continue;
			try {
				if (!sameDirectory(this.root, rootInfo) || !sameDirectory(join(this.root, key.slice(0, 10)), dateInfo, false))
					continue;
				if (!sameDirectory(path, info)) continue;
				rmSync(path, { recursive: true });
				removed++;
				bytesFreed += bytes;
			} catch (error) {
				if (!isMissing(error)) log.error(`could not remove upload directory ${path}`, error);
			}
		}
		for (const [path, info] of dates) {
			try {
				if (sameDirectory(this.root, rootInfo, false) && sameDirectory(path, info, false)) rmdirSync(path);
			} catch (error) {
				if (!isMissing(error) && errorCode(error) !== "ENOTEMPTY") {
					log.error(`could not remove upload date directory ${path}`, error);
				}
			}
		}
		log.info(`uploads cleanup removed ${removed} upload directories and freed ${bytesFreed} bytes`);
	}
}

/** Walk independently of pi's listing, which can silently omit unreadable sessions. */
export async function listSessionFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const visited = new Set<string>();
	async function walk(dir: string): Promise<void> {
		const canonical = await ignoreMissing(() => realpath(dir));
		if (!canonical || visited.has(canonical)) return;
		visited.add(canonical);
		for (const entry of (await ignoreMissing(() => readdir(dir, { withFileTypes: true }))) ?? []) {
			const path = join(dir, entry.name);
			// pi also lists sessions in symlinked project directories.
			const info = entry.isSymbolicLink() ? await ignoreMissing(() => stat(path)) : entry;
			if (info?.isDirectory()) await walk(path);
			else if (info && entry.name.endsWith(".jsonl")) {
				if (!info.isFile()) throw new Error(`Not a regular session file: ${path}`);
				files.push(path);
			}
		}
	}
	await walk(root);
	return files;
}

async function directoryInfo(path: string): Promise<Stats | undefined> {
	const info = await ignoreMissing(() => lstat(path));
	return info?.isDirectory() ? info : undefined;
}

async function directoryNames(path: string, pattern: RegExp): Promise<string[]> {
	const entries = await ignoreMissing(() => readdir(path, { withFileTypes: true }));
	return (entries ?? []).filter((entry) => entry.isDirectory() && pattern.test(entry.name)).map((entry) => entry.name);
}

function sameDirectory(path: string, previous: Stats, checkTimes = true): boolean {
	const current = lstatSync(path);
	return (
		current.isDirectory() &&
		current.dev === previous.dev &&
		current.ino === previous.ino &&
		(!checkTimes || (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs))
	);
}

async function uploadBytes(path: string): Promise<number | undefined> {
	const info = await ignoreMissing(() => lstat(path));
	if (info?.isFile()) return info.size;
	if (!info?.isDirectory()) return undefined;
	const names = await ignoreMissing(() => readdir(path));
	if (!names) return undefined;
	let bytes = 0;
	for (const name of names) {
		const size = await uploadBytes(join(path, name));
		if (size === undefined) return undefined;
		bytes += size;
	}
	return bytes;
}

function referenceKey(key: string): string {
	return process.platform === "win32" ? key.toLowerCase() : key;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorCode(error: unknown): unknown {
	return error instanceof Error && "code" in error ? error.code : undefined;
}

function isMissing(error: unknown): boolean {
	return errorCode(error) === "ENOENT";
}

async function ignoreMissing<T>(read: () => Promise<T>): Promise<T | undefined> {
	try {
		return await read();
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
}
