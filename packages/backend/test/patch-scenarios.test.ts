import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { applyPlan, planPatch } from "../src/apply-patch.ts";

const root = fileURLToPath(new URL("./fixtures/patch-scenarios/", import.meta.url));
async function snapshot(dir: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			result[`${entry.name}/`] = "";
			for (const [path, content] of Object.entries(await snapshot(join(dir, entry.name))))
				result[`${entry.name}/${path}`] = content;
		} else result[entry.name] = (await readFile(join(dir, entry.name))).toString("base64");
	}
	return result;
}
for (const scenario of await readdir(root, { withFileTypes: true })) {
	if (!scenario.isDirectory()) continue;
	it(`patch fixture: ${scenario.name}`, async () => {
		const dir = await mkdtemp(join(tmpdir(), "argon-scenario-"));
		const source = join(root, scenario.name);
		try {
			await cp(join(source, "input"), dir, { recursive: true });
			const patch = await readFile(join(source, "patch.txt"), "utf8");
			let error: unknown;
			try {
				await applyPlan(await planPatch(patch, dir));
			} catch (caught) {
				error = caught;
			}
			if (scenario.name.includes("rejects")) expect(error).toBeInstanceOf(Error);
			else expect(error).toBeUndefined();
			expect(await snapshot(dir)).toEqual(await snapshot(join(source, "expected")));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
}
