/**
 * Global extension policy, applied BEFORE imports (including project_trust bootstrap).
 * Discovery uses pi's package resolver without installation or extension execution.
 * Removal is a persistent exclusion, not arbitrary filesystem deletion: packages may share files.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ExtensionInfo } from "@argon/shared";
import { DefaultPackageManager, type DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { BUILTIN_EXTENSION_NAMES } from "./builtin-extensions.ts";
import { RequestError } from "./request-error.ts";

type Resource = Parameters<NonNullable<ConstructorParameters<typeof DefaultResourceLoader>[0]["extensionFilter"]>>[0];
type Policy = Record<string, { enabled: boolean; removed?: boolean }>;

export function extensionId(resource: Resource): string {
	if (resource.path.startsWith("builtin:")) return resource.path;
	const { source, packageRoot } = resource.metadata;
	// npm versions share an identity, as in pi. Keep package-relative IDs across project installations.
	if (packageRoot && /^(npm:|git:|https?:\/\/)/.test(source)) {
		const identity = source.startsWith("npm:") ? source.replace(/@[^/@]+$/, "") : source;
		return JSON.stringify([identity, relative(packageRoot, resource.path).replaceAll("\\", "/")]);
	}
	return `path:${resolve(resource.path)}`;
}

export class ExtensionConfigStore {
	private policy: Policy;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly idsByPath = new Map<string, string>();
	readonly path: string;
	revision = 0;

	constructor(private readonly agentDir: string) {
		this.path = join(agentDir, "extension-policy.json");
		this.policy = this.readPolicy();
	}

	/** Also used by the explicit Reload button after a policy file was edited outside the GUI. */
	refresh(): Promise<void> {
		const operation = this.queue
			.catch(() => {})
			.then(() => {
				this.policy = this.readPolicy();
				this.revision++;
			});
		this.queue = operation;
		return operation;
	}

	private readPolicy(): Policy {
		if (!existsSync(this.path)) return {};
		const data: unknown = JSON.parse(readFileSync(this.path, "utf8"));
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid extension policy");
		for (const entry of Object.values(data)) {
			if (
				!entry ||
				typeof entry.enabled !== "boolean" ||
				(entry.removed !== undefined && typeof entry.removed !== "boolean")
			)
				throw new Error("Invalid extension policy entry");
		}
		return data as Policy;
	}

	/** Undefined policy preserves pi's existing resource selection. Project settings cannot bypass a denial. */
	readonly filter = (resource: Resource): boolean => {
		const id = extensionId(resource);
		this.idsByPath.set(resource.path, id);
		const entry = this.policy[id];
		return entry?.removed ? false : (entry?.enabled ?? resource.enabled);
	};

	/** Do not invoke a disabled extension's old project_trust handler while preparing its reload. */
	allowsLoaded(path: string): boolean {
		const id = this.idsByPath.get(path) ?? (path.startsWith("builtin:") ? path : `path:${resolve(path)}`);
		const entry = this.policy[id];
		return !entry?.removed && entry?.enabled !== false;
	}

	async list(): Promise<{ items: ExtensionInfo[]; warnings: string[] }> {
		const settingsManager = SettingsManager.create(this.agentDir, this.agentDir, { projectTrusted: false });
		const manager = new DefaultPackageManager({
			cwd: this.agentDir,
			agentDir: this.agentDir,
			settingsManager,
			builtinExtensions: BUILTIN_EXTENSION_NAMES,
			commandOutput: "capture",
		});
		const resolved = await manager.resolve(async () => "skip");
		const items = new Map<string, ExtensionInfo>();
		for (const resource of resolved.extensions) {
			if (resource.metadata.scope !== "user") continue;
			const id = extensionId(resource);
			if (this.policy[id]?.removed) continue;
			const builtin = resource.path.startsWith("builtin:");
			items.set(id, {
				id,
				name: builtin ? resource.path.slice("builtin:".length) : basename(resource.path),
				path: resource.path,
				source: resource.metadata.source,
				builtin,
				enabled: this.filter(resource),
			});
		}
		const warnings = (resolved.installFailures ?? []).map((f) => `${f.source}: ${f.message}`);
		for (const diagnostic of settingsManager.drainErrors())
			warnings.push(`${diagnostic.path ?? diagnostic.scope}: ${String(diagnostic.error)}`);
		for (const pkg of manager.listConfiguredPackages()) {
			if (pkg.scope === "user" && (!pkg.installedPath || !existsSync(pkg.installedPath)))
				warnings.push(`Package not installed: ${pkg.source}`);
		}
		return { items: [...items.values()], warnings };
	}

	/** Serialize discovery/validation/write, including concurrent requests from different clients. */
	change(id: string, action: { enabled: boolean } | { remove: true }): Promise<void> {
		const operation = this.queue
			.catch(() => {})
			.then(async () => {
				if (typeof id !== "string" || !id) throw new RequestError("bad_request", "Invalid extension id");
				if ("enabled" in action && typeof action.enabled !== "boolean")
					throw new RequestError("bad_request", "Invalid enabled value");
				mkdirSync(dirname(this.path), { recursive: true });
				try {
					writeFileSync(this.path, "{}\n", { flag: "wx", mode: 0o600 });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
				const release = await lockfile.lock(this.path, { realpath: false, retries: 5 });
				try {
					this.policy = this.readPolicy();
					// Retrying a successful removal is harmless.
					if ("remove" in action && this.policy[id]?.removed) return;
					const item = (await this.list()).items.find((item) => item.id === id);
					if (!item) throw new RequestError("bad_request", "Unknown global extension");
					if ("remove" in action && item.builtin)
						throw new RequestError("bad_request", "Built-in extensions cannot be removed");
					const next = { ...this.policy, [id]: "remove" in action ? { enabled: false, removed: true } : action };
					const temp = `${this.path}.${randomUUID()}.tmp`;
					try {
						await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
						await rename(temp, this.path);
					} finally {
						await unlink(temp).catch(() => {});
					}
					this.policy = next;
					this.revision++;
				} finally {
					await release();
				}
			});
		this.queue = operation;
		return operation;
	}
}
