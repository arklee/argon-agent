import type { ArgonSettings } from "@argon/shared";

export function openaiFeaturesEnabled(mode: ArgonSettings["openaiFeatures"], provider?: string): boolean {
	return mode === "on" || (mode === "openai" && (provider === "openai" || provider === "openai-codex"));
}
export function isOpenaiFeaturesMode(value: unknown): value is ArgonSettings["openaiFeatures"] {
	return value === "off" || value === "on" || value === "openai";
}
