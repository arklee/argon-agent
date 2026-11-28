import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => [] as (string | null)[]);
vi.mock("@earendil-works/pi-tui", () => ({
	CombinedAutocompleteProvider: class {
		constructor(_commands: unknown, _cwd: string, fd: string | null) {
			lookups.push(fd);
		}
		async getSuggestions() {
			return null;
		}
	},
}));

import { completeFile, resetFdCache } from "../src/file-completion.ts";

it("invalidates a cached missing fd after installation", async () => {
	const root = await mkdtemp(join(tmpdir(), "argon-fd-cache-"));
	vi.stubEnv("PATH", "");
	try {
		const complete = () => completeFile("@file", root, root, new AbortController().signal);
		await complete();
		const binary = join(root, "bin", process.platform === "win32" ? "fd.exe" : "fd");
		await mkdir(join(root, "bin"));
		await writeFile(binary, "test binary");
		await complete();
		expect(lookups).toEqual([null, null]);
		resetFdCache(root);
		await complete();
		expect(lookups.at(-1)).toBe(binary);
	} finally {
		vi.unstubAllEnvs();
		resetFdCache(root);
		await rm(root, { recursive: true, force: true });
	}
});
