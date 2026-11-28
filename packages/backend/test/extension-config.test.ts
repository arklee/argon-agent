import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	DefaultResourceLoader,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_EXTENSION_NAMES } from "../src/builtin-extensions.ts";
import { ExtensionConfigStore, extensionId } from "../src/extension-config.ts";
import { ManagedSession } from "../src/managed-session.ts";
import { resolveProjectTrustWithExtensions } from "../src/project-trust.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

let root: string;
let agentDir: string;
let cwd: string;
let store: ExtensionConfigStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "argon-extensions-"));
	agentDir = join(root, "agent");
	cwd = join(root, "project");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
	store = new ExtensionConfigStore(agentDir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function addExtension(name: string): string {
	const path = join(agentDir, "extensions", `${name}.js`);
	// Importing this code is an error; listing and disabled loading must never execute it.
	writeFileSync(path, `throw new Error("SHOULD_NOT_EXECUTE"); export default function() {}`);
	return path;
}

describe("global extension configuration", () => {
	it("discovers builtins and user files without executing code or installing missing packages", async () => {
		const path = addExtension("custom");
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["npm:argon-nonexistent-test-package"] }),
		);
		const result = await store.list();
		expect(result.items).toContainEqual(expect.objectContaining({ path, builtin: false, enabled: true }));
		expect(result.items).toContainEqual(expect.objectContaining({ id: "builtin:mcp", builtin: true }));
		expect(result.warnings.join(" ")).toContain("argon-nonexistent-test-package");
		expect(existsSync(join(agentDir, "npm", "node_modules", "argon-nonexistent-test-package"))).toBe(false);
	});

	it("persists toggles and serializes concurrent writes without losing either change", async () => {
		await Promise.all([
			store.change("builtin:mcp", { enabled: false }),
			store.change("builtin:codemode", { enabled: false }),
		]);
		const reopened = new ExtensionConfigStore(agentDir);
		const { items } = await reopened.list();
		expect(items.find((item) => item.id === "builtin:mcp")?.enabled).toBe(false);
		expect(items.find((item) => item.id === "builtin:codemode")?.enabled).toBe(false);
		await reopened.change("builtin:mcp", { enabled: true });
		expect((await reopened.list()).items.find((item) => item.id === "builtin:mcp")?.enabled).toBe(true);
	});

	it("removes only discovered user entries, retaining source files and rejecting builtin/forged ids", async () => {
		const path = addExtension("custom");
		const item = (await store.list()).items.find((item) => item.path === path)!;
		await store.change(item.id, { remove: true });
		await store.change(item.id, { remove: true }); // idempotent
		expect((await store.list()).items.some((entry) => entry.id === item.id)).toBe(false);
		expect(readFileSync(path, "utf8")).toContain("SHOULD_NOT_EXECUTE");
		expect(store.allowsLoaded(path)).toBe(false);
		await expect(store.change("builtin:mcp", { remove: true })).rejects.toThrow("cannot be removed");
		await expect(store.change(`path:${join(root, "outside")}`, { remove: true })).rejects.toThrow("Unknown");
	});

	it("does not load a disabled file in the pre-trust or final pass; protected inline factories still load", async () => {
		const path = addExtension("custom");
		const item = (await store.list()).items.find((item) => item.path === path)!;
		await store.change(item.id, { enabled: false });
		let inlineLoads = 0;
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFilter: store.filter,
			extensionFactories: [
				() => {
					inlineLoads++;
				},
			],
		});
		const preTrust = await loader.loadProjectTrustExtensions();
		expect(preTrust.errors).toEqual([]);
		expect(preTrust.extensions.some((extension) => extension.path === path)).toBe(false);
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		expect(inlineLoads).toBeGreaterThan(0);
		// Without the policy the fixture's import does run, proving the filter is before execution.
		await store.change(item.id, { enabled: true });
		await loader.reload();
		expect(loader.getExtensions().errors.some((error) => error.error.includes("SHOULD_NOT_EXECUTE"))).toBe(true);
	});

	it("global builtin denial wins over an explicit project enable, and takes effect on reload", async () => {
		writeFileSync(join(cwd, CONFIG_DIR_NAME, "settings.json"), JSON.stringify({ extensions: ["+builtin:mcp"] }));
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		let loads = 0;
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			extensionFilter: store.filter,
			extensionFactories: [
				{
					name: "mcp",
					builtin: true,
					factory: () => {
						loads++;
					},
				},
			],
		});
		await store.change("builtin:mcp", { enabled: false });
		await loader.reload();
		expect(loads).toBe(0);
		await store.change("builtin:mcp", { enabled: true });
		await loader.reload();
		expect(loads).toBe(1);
		await store.change("builtin:mcp", { enabled: false });
		await loader.reload();
		expect(loader.getExtensions().extensions).toHaveLength(0);
	});

	it("uses a package-relative identity across versions and project installations", () => {
		const resource = (packageRoot: string, source: string) => ({
			path: join(packageRoot, "extensions", "tool.ts"),
			enabled: true,
			metadata: { source, packageRoot, scope: "user" as const, origin: "package" as const },
		});
		expect(extensionId(resource("/global/npm/pkg", "npm:@scope/pkg@1.0.0"))).toBe(
			extensionId(resource("/project/npm/pkg", "npm:@scope/pkg@2.0.0")),
		);
		expect(extensionId(resource("/global/npm/pkg", "npm:@scope/pkg"))).toBe(
			extensionId(resource("/global/npm/pkg", "npm:@scope/pkg@1.0.0")),
		);
	});

	it("removing one package extension preserves its sibling and package files", async () => {
		const pkg = join(root, "package");
		mkdirSync(pkg);
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ pi: { extensions: ["a.js", "b.js"] } }));
		writeFileSync(join(pkg, "a.js"), 'throw new Error("REMOVED_EXTENSION_EXECUTED"); export default function() {}');
		writeFileSync(join(pkg, "b.js"), "export default function() {}");
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
		const removed = (await store.list()).items.find((item) => item.path === join(pkg, "a.js"))!;
		await store.change(removed.id, { remove: true });
		const loader = new DefaultResourceLoader({ cwd, agentDir, extensionFilter: store.filter });
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		expect(loader.getExtensions().extensions.map((extension) => extension.path)).toContain(join(pkg, "b.js"));
		expect(existsSync(join(pkg, "a.js"))).toBe(true);
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([pkg]);
	});

	it("explicit reload re-reads external edits, allowing removed items to be restored", async () => {
		const path = addExtension("custom");
		const item = (await store.list()).items.find((item) => item.path === path)!;
		await store.change(item.id, { remove: true });
		writeFileSync(store.path, "{}");
		await store.refresh();
		expect((await store.list()).items.some((entry) => entry.id === item.id)).toBe(true);
		expect(store.allowsLoaded(path)).toBe(true);
	});

	it("re-evaluates a newly enabled trust extension BEFORE importing project code on a real SDK reload", async () => {
		const guard = join(agentDir, "extensions", "guard.js");
		writeFileSync(guard, 'export default pi => { pi.on("project_trust", () => ({ trusted: "no" })); };');
		const item = (await store.list()).items.find((entry) => entry.path === guard)!;
		await store.change(item.id, { enabled: false });
		for (const name of BUILTIN_EXTENSION_NAMES) await store.change(`builtin:${name}`, { enabled: false });
		const projectExtensions = join(cwd, CONFIG_DIR_NAME, "extensions");
		mkdirSync(projectExtensions);
		const marker = join(root, "project-executed");
		writeFileSync(
			join(projectExtensions, "probe.js"),
			`
			import { writeFileSync } from "node:fs";
			writeFileSync(${JSON.stringify(marker)}, "executed");
			export default function() {}
		`,
		);
		const trustStore = new ProjectTrustStore(agentDir);
		trustStore.set(cwd, true);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
		});
		const create = vi.spyOn(SessionManager, "create").mockReturnValue(SessionManager.inMemory(cwd));
		let session: ManagedSession | undefined;
		try {
			session = await ManagedSession.load(
				{ kind: "new", cwd },
				{
					agentDir,
					modelRuntime,
					settings: new ArgonSettingsStore(root),
					extensionConfig: store,
					resolveProjectTrust: (cwd, defaultTrust, extensions, onError) =>
						resolveProjectTrustWithExtensions(cwd, trustStore, new Map(), defaultTrust, extensions, onError),
				},
			);
			expect(existsSync(marker)).toBe(true);
			unlinkSync(marker);
			await store.change(item.id, { enabled: true });
			await session.refreshProjectTrust(true);
			expect(session.snapshot().state.projectTrust?.status).toBe("untrusted");
			expect(existsSync(marker)).toBe(false);
		} finally {
			await session?.dispose();
			await modelRuntime.settleCredentialWrites();
			create.mockRestore();
		}
	});
});
