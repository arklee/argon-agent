/**
 * Settings shown in the GUI.
 *
 * - pi settings: a curated, agent-relevant subset read and written through pi's SettingsManager (its
 *   own validation and file locking), so the pi CLI sees the same values. Resource lists are read-only.
 * - Argon settings: $ARGON_HOME/settings.json (default permission mode, persisted "always allow" rules).
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArgonSettings, PermissionMode, PermissionRule, PiSettings, ResourceSettings } from "@argon/shared";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

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
			scope("project", manager.getProjectSettings() as Record<string, unknown>, join(cwd, ".pi", "settings.json")),
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
// Argon settings
// ---------------------------------------------------------------------------

const DEFAULT_ARGON: ArgonSettings = { permissions: { defaultMode: "ask", rules: [] } };

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
		this.current = { ...this.current, ...patch, permissions: { ...this.current.permissions, ...patch.permissions } };
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
