import type { ToolPresetInfo } from "@argon/shared";

export interface ToolPreset extends ToolPresetInfo {
	codemodeMode?: "on" | "only";
}

const classic: ToolPreset = {
	id: "classic",
	label: "Classic",
	description: "Separate tools (read, bash, edit, write, …)",
};

const presets: ToolPreset[] = [
	classic,
	{
		id: "codemode",
		label: "Codemode",
		description: "Codemode scripts alongside the separate tools",
		codemodeMode: "on",
	},
	{
		id: "codemode_only",
		label: "Codemode only",
		description: "Tools are reached through codemode scripts",
		codemodeMode: "only",
	},
];

export function listToolPresets(): ToolPresetInfo[] {
	return presets.map(({ id, label, description }) => ({ id, label, description }));
}

export function findToolPreset(id: unknown): ToolPreset | undefined {
	return presets.find((preset) => preset.id === id);
}

export function resolveToolPreset(id: unknown, defaultId?: string): ToolPreset {
	return findToolPreset(id) ?? findToolPreset(defaultId) ?? classic;
}
