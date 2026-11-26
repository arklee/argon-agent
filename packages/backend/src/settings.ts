/**
 * Settings shown in the GUI.
 *
 * - pi settings: a curated, agent-relevant subset read and written through pi's SettingsManager (its
 *   own validation and file locking), using Argon’s private agent directory. Resource lists are read-only.
 * - Argon settings: $ARGON_HOME/settings.json (default permission mode, persisted "always allow" rules).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	ArgonSettings,
	PermissionMode,
	PermissionRule,
	PiSettings,
	ProjectPiSettings,
	ProjectSettingsInfo,
	ResourceSettings,
} from "@argon/shared";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

import { resolveToolPreset } from "./tool-presets.ts";

type ThinkingArg = Parameters<SettingsManager["setDefaultThinkingLevel"]>[0];
type TrustArg = Parameters<SettingsManager["setDefaultProjectTrust"]>[0];

function sources(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	return list.map((entry) =>
		typeof entry === "string" ? entry : String((entry as { source?: unknown })?.source ?? JSON.stringify(entry)),
	);
}

export function readPiSettings(
	agentDir: string,
	cwd: string | undefined,
): { pi: PiSettings; resources: ResourceSettings[] } {
	const manager = SettingsManager.create(cwd ?? process.cwd(), agentDir);
	const provider = manager.getDefaultProvider();
	const model = manager.getDefaultModel();
	const pi: PiSettings = {
		defaultModel: provider && model ? { provider, id: model } : undefined,
		defaultThinkingLevel: manager.getDefaultThinkingLevel(),
		enabledModels: manager.getEnabledModels(),
		steeringMode: manager.getSteeringMode(),
		followUpMode: manager.getFollowUpMode(),
		compaction: manager.getCompactionEnabled(),
		retry: manager.getRetryEnabled(),
		shellPath: manager.getShellPath(),
		shellCommandPrefix: manager.getShellCommandPrefix(),
		imageAutoResize: manager.getImageAutoResize(),
		blockImages: manager.getBlockImages(),
		enableSkillCommands: manager.getEnableSkillCommands(),
		defaultProjectTrust: String(manager.getDefaultProjectTrust()),
	};
	const scope = (name: "global" | "project", settings: Record<string, unknown>, path: string): ResourceSettings => ({
		scope: name,
		path,
		packages: sources(settings.packages),
		extensions: sources(settings.extensions),
		skills: sources(settings.skills),
		prompts: sources(settings.prompts),
	});
	const resources = [
		scope("global", manager.getGlobalSettings() as Record<string, unknown>, join(agentDir, "settings.json")),
	];
	if (cwd) {
		resources.push(
			scope("project", manager.getProjectSettings() as Record<string, unknown>, join(cwd, ".argon", "settings.json")),
		);
	}
	return { pi, resources };
}

/** Apply a partial update to pi's global settings and wait until it is written. */
export async function writePiSettings(agentDir: string, patch: Partial<PiSettings>): Promise<void> {
	const manager = SettingsManager.create(process.cwd(), agentDir);
	if (patch.defaultModel) manager.setDefaultModelAndProvider(patch.defaultModel.provider, patch.defaultModel.id);
	if (patch.defaultThinkingLevel) manager.setDefaultThinkingLevel(patch.defaultThinkingLevel as ThinkingArg);
	if ("enabledModels" in patch) manager.setEnabledModels(patch.enabledModels?.length ? patch.enabledModels : undefined);
	if (patch.steeringMode) manager.setSteeringMode(patch.steeringMode);
	if (patch.followUpMode) manager.setFollowUpMode(patch.followUpMode);
	if (patch.compaction !== undefined) manager.setCompactionEnabled(patch.compaction);
	if (patch.retry !== undefined) manager.setRetryEnabled(patch.retry);
	if ("shellPath" in patch) manager.setShellPath(patch.shellPath || undefined);
	if ("shellCommandPrefix" in patch) manager.setShellCommandPrefix(patch.shellCommandPrefix || undefined);
	if (patch.imageAutoResize !== undefined) manager.setImageAutoResize(patch.imageAutoResize);
	if (patch.blockImages !== undefined) manager.setBlockImages(patch.blockImages);
	if (patch.enableSkillCommands !== undefined) manager.setEnableSkillCommands(patch.enableSkillCommands);
	if (patch.defaultProjectTrust) manager.setDefaultProjectTrust(patch.defaultProjectTrust as TrustArg);
	// reload() waits for queued writes before re-reading.
	await manager.reload();
}

// ---------------------------------------------------------------------------
// Project-level pi settings (<cwd>/.argon/settings.json)
// ---------------------------------------------------------------------------

/**
 * Where each project-overridable setting lives in pi's settings JSON. pi's SettingsManager only has
 * project setters for resource lists, so Argon edits the file itself, under the same lock pi uses.
 */
const PROJECT_KEYS: { [K in keyof ProjectPiSettings]-?: readonly string[] } = {
	defaultModel: ["defaultModel"],
	defaultThinkingLevel: ["defaultThinkingLevel"],
	enabledModels: ["enabledModels"],
	steeringMode: ["steeringMode"],
	followUpMode: ["followUpMode"],
	compaction: ["compaction", "enabled"],
	retry: ["retry", "enabled"],
	shellPath: ["shellPath"],
	shellCommandPrefix: ["shellCommandPrefix"],
	imageAutoResize: ["images", "autoResize"],
	blockImages: ["images", "blockImages"],
	enableSkillCommands: ["enableSkillCommands"],
};

export const PROJECT_SETTING_KEYS = Object.keys(PROJECT_KEYS) as (keyof ProjectPiSettings)[];

/** Project settings file of `cwd` (pi's CONFIG_DIR_NAME is `.argon` in Argon, see decisions D10). */
export function projectSettingsPath(cwd: string): string {
	return join(cwd, ".argon", "settings.json");
}

type Json = Record<string, unknown>;

function getPath(data: Json, path: readonly string[]): unknown {
	let current: unknown = data;
	for (const key of path) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Json)[key];
	}
	return current;
}

function setPath(data: Json, path: readonly string[], value: unknown): void {
	let current = data;
	for (const key of path.slice(0, -1)) {
		const next = current[key];
		if (!next || typeof next !== "object" || Array.isArray(next)) current[key] = {};
		current = current[key] as Json;
	}
	const last = path.at(-1)!;
	if (value === undefined) delete current[last];
	else current[last] = value;
}

/** Remove `path`, then any parent objects it left empty. */
function unsetPath(data: Json, path: readonly string[]): void {
	setPath(data, path, undefined);
	for (let depth = path.length - 1; depth > 0; depth--) {
		const parent = getPath(data, path.slice(0, depth));
		if (parent && typeof parent === "object" && Object.keys(parent).length === 0) {
			setPath(data, path.slice(0, depth), undefined);
		} else break;
	}
}

function parseSettingsFile(text: string | undefined): Json {
	if (text === undefined || !text.trim()) return {};
	const data = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error("Settings file must hold a JSON object");
	return data as Json;
}

/** The keys the project file sets, as Argon values (`defaultModel` needs both provider and model). */
export function readProjectSettings(cwd: string, trusted: boolean): ProjectSettingsInfo {
	const path = projectSettingsPath(cwd);
	const info: ProjectSettingsInfo = { cwd, path, values: {}, trusted };
	let data: Json;
	try {
		data = parseSettingsFile(existsSync(path) ? readFileSync(path, "utf8") : undefined);
	} catch (error) {
		return { ...info, error: error instanceof Error ? error.message : String(error) };
	}
	const values: Partial<ProjectPiSettings> = {};
	for (const key of PROJECT_SETTING_KEYS) {
		if (key === "defaultModel") {
			const provider = data.defaultProvider;
			const id = data.defaultModel;
			if (typeof provider === "string" && typeof id === "string") values.defaultModel = { provider, id };
			continue;
		}
		const value = getPath(data, PROJECT_KEYS[key]);
		if (value !== undefined) (values as Record<string, unknown>)[key] = value;
	}
	return { ...info, values };
}

/** Run `update` on the parsed project file under pi's settings lock and write the result. */
function withProjectFile(cwd: string, update: (data: Json) => void): void {
	const path = projectSettingsPath(cwd);
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "{}\n", { flag: "wx" });
	}
	const release = lockWithRetry(path);
	try {
		const data = parseSettingsFile(readFileSync(path, "utf8"));
		update(data);
		writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	} finally {
		release();
	}
}

function lockWithRetry(path: string): () => void {
	for (let attempt = 1; ; attempt++) {
		try {
			// Same options as pi's FileSettingsStorage, so both lock the same file.
			return lockfile.lockSync(path, { realpath: false });
		} catch (error) {
			if ((error as { code?: string }).code !== "ELOCKED" || attempt >= 10) throw error;
			const until = Date.now() + 20;
			while (Date.now() < until) {
				// pi waits synchronously too; the lock is held only for a read-modify-write.
			}
		}
	}
}

const BOOLEAN_KEYS = new Set(["compaction", "retry", "imageAutoResize", "blockImages", "enableSkillCommands"]);

function checkProjectValue(key: keyof ProjectPiSettings, value: unknown): void {
	const ok =
		key === "enabledModels"
			? Array.isArray(value) && value.every((v) => typeof v === "string")
			: key === "steeringMode" || key === "followUpMode"
				? value === "all" || value === "one-at-a-time"
				: BOOLEAN_KEYS.has(key)
					? typeof value === "boolean"
					: typeof value === "string";
	if (!ok) throw new Error(`Invalid value for ${key}`);
}

export function writeProjectSettings(
	cwd: string,
	set: Partial<ProjectPiSettings> = {},
	unset: readonly (keyof ProjectPiSettings)[] = [],
): void {
	const unknown = [...Object.keys(set), ...unset].filter((key) => !(key in PROJECT_KEYS));
	if (unknown.length > 0) throw new Error(`Not a project setting: ${unknown.join(", ")}`);
	withProjectFile(cwd, (data) => {
		for (const key of unset) {
			if (key === "defaultModel") {
				delete data.defaultProvider;
				delete data.defaultModel;
			} else unsetPath(data, PROJECT_KEYS[key]);
		}
		for (const [key, value] of Object.entries(set) as [keyof ProjectPiSettings, unknown][]) {
			if (value === undefined) continue;
			if (key === "defaultModel") {
				const model = value as PiSettings["defaultModel"];
				if (typeof model?.provider !== "string" || !model.provider || typeof model.id !== "string" || !model.id)
					throw new Error("defaultModel needs a provider and an id");
				data.defaultProvider = model.provider;
				data.defaultModel = model.id;
			} else {
				checkProjectValue(key, value);
				setPath(data, PROJECT_KEYS[key], value);
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Argon settings
// ---------------------------------------------------------------------------

const DEFAULT_ARGON: ArgonSettings = { defaultToolPreset: "classic", permissions: { defaultMode: "ask", rules: [] } };

export class ArgonSettingsStore {
	private current: ArgonSettings = DEFAULT_ARGON;
	private readonly path: string;

	constructor(
		argonHome: string,
		/** ARGON_PERMISSION_MODE, when set, wins over the stored default. */
		private readonly envMode?: PermissionMode,
	) {
		this.path = join(argonHome, "settings.json");
	}

	async load(): Promise<void> {
		try {
			const data = JSON.parse(await readFile(this.path, "utf8")) as Partial<ArgonSettings>;
			const permissions = (data.permissions ?? {}) as Partial<ArgonSettings["permissions"]>;
			this.current = {
				defaultToolPreset: resolveToolPreset(data.defaultToolPreset).id,
				permissions: {
					defaultMode: permissions.defaultMode === "auto" ? "auto" : "ask",
					rules: Array.isArray(permissions.rules)
						? permissions.rules.filter((r): r is PermissionRule => typeof r?.tool === "string")
						: [],
				},
			};
		} catch {
			this.current = DEFAULT_ARGON;
		}
	}

	get(): ArgonSettings {
		return this.current;
	}

	get defaultPermissionMode(): PermissionMode {
		return this.envMode ?? this.current.permissions.defaultMode;
	}

	async update(patch: Partial<ArgonSettings>): Promise<void> {
		this.current = {
			...this.current,
			...patch,
			defaultToolPreset: resolveToolPreset(patch.defaultToolPreset ?? this.current.defaultToolPreset).id,
			permissions: { ...this.current.permissions, ...patch.permissions },
		};
		const tmp = `${this.path}.tmp`;
		await writeFile(tmp, `${JSON.stringify(this.current, null, 2)}\n`, { mode: 0o600 });
		await rename(tmp, this.path);
	}

	async addRule(rule: PermissionRule): Promise<void> {
		const rules = this.current.permissions.rules;
		if (rules.some((r) => r.tool === rule.tool && r.command === rule.command)) return;
		await this.update({ permissions: { ...this.current.permissions, rules: [...rules, rule] } });
	}

	allows(toolName: string, input: unknown): boolean {
		const command = toolName === "bash" ? commandOf(input) : undefined;
		// "npm test && rm -rf ~" starts with "npm test ": never let a prefix rule cover a compound command.
		if (command !== undefined && SHELL_META.test(command)) return false;
		return this.current.permissions.rules.some((rule) => {
			if (rule.tool !== toolName) return false;
			if (rule.command === undefined) return toolName !== "bash";
			return command !== undefined && (command === rule.command || command.startsWith(`${rule.command} `));
		});
	}
}

/** Chaining, pipes, redirection, substitution, subshells, newlines. */
const SHELL_META = /[;&|`$<>()\n]/;

function commandOf(input: unknown): string | undefined {
	const command = (input as { command?: unknown } | undefined)?.command;
	return typeof command === "string" ? command.trim() : undefined;
}

/**
 * The rule "Always allow" proposes. bash: program plus subcommand ("npm test", "git status") unless
 * the command chains or substitutes (then nothing is suggested: too easy to over-allow). Others: the tool.
 */
export function suggestRule(toolName: string, input: unknown): PermissionRule | undefined {
	if (toolName !== "bash") return { tool: toolName };
	const command = commandOf(input);
	if (!command || SHELL_META.test(command)) return undefined;
	const [program, sub] = command.split(/\s+/);
	if (!program) return undefined;
	const withSub = sub && /^[a-z][\w:-]*$/i.test(sub) ? `${program} ${sub}` : program;
	return { tool: "bash", command: withSub };
}
