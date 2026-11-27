import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileDiff } from "@argon/shared";
import { type ExtensionFactory, generateDiffString } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { APPLY_PATCH_LARK } from "./apply-patch-grammar.ts";
import { capDiff } from "./diff-preview.ts";
import { log } from "./log.ts";
import { derive, joinBom, parse } from "./patch-parser.ts";
import { resolveToolPath } from "./sandbox-policy.ts";

export interface PlannedFileChange {
	path: string;
	absolutePath: string;
	op: "add" | "update" | "delete" | "move";
	movePath?: string;
	absoluteMovePath?: string;
	before: string;
	after: string;
}

/** Validates syntax without reading files; shared by display and path authorization. */
export function patchedPaths(input: string): Pick<PlannedFileChange, "path" | "op" | "movePath">[] | undefined {
	try {
		return parse(input).map((hunk) => ({
			path: hunk.path,
			op: hunk.type === "update" && hunk.movePath ? "move" : hunk.type,
			...(hunk.type === "update" && hunk.movePath ? { movePath: hunk.movePath } : {}),
		}));
	} catch {
		return undefined;
	}
}

/** Plans the entire patch, including sequential operations on the same file, without writing. */
export async function planPatch(input: string, cwd: string): Promise<PlannedFileChange[]> {
	const hunks = parse(input);
	if (!hunks.length) throw new Error("Patch rejected: empty patch");
	const contents = new Map<string, string | null>();
	const plan: PlannedFileChange[] = [];
	for (const hunk of hunks) {
		if (!hunk.path) throw new Error("File path must not be empty");
		const absolutePath = resolveToolPath(hunk.path, cwd);
		let before = "";
		if (hunk.type !== "add") {
			try {
				const previous = contents.get(absolutePath);
				if (previous === null) throw new Error("file does not exist");
				before = previous ?? (await readFile(absolutePath, "utf8"));
			} catch (error) {
				throw new Error(`Failed to ${hunk.type} ${hunk.path}: ${error instanceof Error ? error.message : error}`);
			}
		}
		let after = "";
		if (hunk.type === "add") after = hunk.contents;
		if (hunk.type === "update") {
			const crlf = before.includes("\r\n");
			const update = derive(hunk.path, hunk.chunks, before.replace(/\r\n/g, "\n"));
			after = joinBom(crlf ? update.content.replace(/\n/g, "\r\n") : update.content, update.bom);
		}
		const movePath = hunk.type === "update" ? hunk.movePath : undefined;
		const absoluteMovePath = movePath ? resolveToolPath(movePath, cwd) : undefined;
		plan.push({
			path: hunk.path,
			absolutePath,
			op: movePath ? "move" : hunk.type,
			movePath,
			absoluteMovePath,
			before,
			after,
		});
		contents.set(
			absolutePath,
			hunk.type === "delete" || (absoluteMovePath && absoluteMovePath !== absolutePath) ? null : after,
		);
		if (absoluteMovePath) contents.set(absoluteMovePath, after);
	}
	return plan;
}

export function patchFileDiffs(plan: PlannedFileChange[]): FileDiff[] {
	return plan.map(({ path, before, after }) => ({
		path,
		diff: capDiff(generateDiffString(before.replace(/\r\n/g, "\n"), after.replace(/\r\n/g, "\n")).diff),
	}));
}

export async function applyPlan(plan: PlannedFileChange[], signal?: AbortSignal): Promise<void> {
	for (const change of plan) {
		signal?.throwIfAborted();
		if (change.op === "delete") await unlink(change.absolutePath);
		else {
			const target = change.absoluteMovePath ?? change.absolutePath;
			await mkdir(dirname(target), { recursive: true });
			signal?.throwIfAborted();
			await writeFile(target, change.after, "utf8");
			signal?.throwIfAborted();
			if (change.op === "move" && target !== change.absolutePath) await unlink(change.absolutePath);
		}
		signal?.throwIfAborted();
	}
}

type MutationQueue = <T>(path: string, fn: () => Promise<T>) => Promise<T>;

/**
 * pi's per-file mutation queue, shared with its edit / write tools so they never interleave with a patch.
 * pi does not export it, so it is imported by file; if a pi upgrade moves it, patches only queue
 * against each other.
 */
async function loadMutationQueue(): Promise<MutationQueue> {
	try {
		const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
		const module = (await import(new URL("./core/tools/file-mutation-queue.js", entry).href)) as {
			withFileMutationQueue?: unknown;
		};
		if (typeof module.withFileMutationQueue === "function") return module.withFileMutationQueue as MutationQueue;
		log.warn("pi's file mutation queue has no withFileMutationQueue export; apply_patch uses its own");
	} catch (error) {
		log.warn(`pi's file mutation queue could not be loaded: ${error instanceof Error ? error.message : error}`);
	}
	const tails = new Map<string, Promise<unknown>>();
	return (path, fn) => {
		const run = (tails.get(path) ?? Promise.resolve()).then(fn, fn);
		const tail = run.catch(() => {});
		tails.set(path, tail);
		void tail.then(() => tails.get(path) === tail && tails.delete(path));
		return run;
	};
}

const withFileMutationQueue = await loadMutationQueue();

async function withPatchQueues<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
	// Canonicalize before sorting/deduplicating, avoiding deadlocks through symlink aliases.
	const keys = [
		...new Set(
			await Promise.all(
				paths.map(async (path) => {
					try {
						return await realpath(path);
					} catch {
						return path;
					}
				}),
			),
		),
	].sort();
	const lock = (index: number): Promise<T> =>
		index === keys.length ? fn() : withFileMutationQueue(keys[index]!, () => lock(index + 1));
	return lock(0);
}

export const applyPatchExtension: ExtensionFactory = (pi) => {
	pi.registerTool({
		name: "apply_patch",
		label: "apply_patch",
		description:
			"Apply a patch to add, update, move, or delete files. Supply the patch text directly in input: *** Begin Patch, file hunks, *** End Patch. Add-file lines start with +; update lines start with space (context), - (remove), or + (add).",
		promptSnippet: "Edit files with apply_patch",
		promptGuidelines: [
			"Use apply_patch for file changes. Include enough context to uniquely identify each change; use @@ context headers to locate sections. Paths may be relative to the working directory or absolute. Do not wrap patches in Markdown fences.",
		],
		parameters: Type.Object({ input: Type.String() }, { additionalProperties: false }),
		constrainedSampling: { type: "grammar", variants: { openai_lark: APPLY_PATCH_LARK } },
		async execute(_id, { input }, signal, _onUpdate, ctx) {
			const paths = patchedPaths(input);
			if (!paths?.length) throw new Error("Invalid or empty patch");
			return withPatchQueues(
				paths.flatMap(({ path, movePath }) => [
					resolveToolPath(path, ctx.cwd),
					...(movePath ? [resolveToolPath(movePath, ctx.cwd)] : []),
				]),
				async () => {
					signal?.throwIfAborted();
					const plan = await planPatch(input, ctx.cwd);
					signal?.throwIfAborted();
					await applyPlan(plan, signal);
					return {
						content: [
							{
								type: "text",
								text: `Success. Updated the following files:\n${plan.map((change) => `${change.op === "add" ? "A" : change.op === "delete" ? "D" : "M"} ${change.movePath ?? change.path}`).join("\n")}`,
							},
						],
						details: { diffs: patchFileDiffs(plan) },
					};
				},
			);
		},
	});
};
