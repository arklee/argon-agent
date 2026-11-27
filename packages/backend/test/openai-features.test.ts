import { expect, it } from "vitest";
import { openaiFeaturesEnabled } from "../src/openai-features.ts";

it("matches provider IDs exactly and lets forced modes override the provider", () => {
	for (const provider of [
		undefined,
		"openai",
		"openai-codex",
		"azure-openai",
		"openrouter",
		"anthropic",
		"custom-openai",
	]) {
		expect(openaiFeaturesEnabled("on", provider)).toBe(true);
		expect(openaiFeaturesEnabled("off", provider)).toBe(false);
		expect(openaiFeaturesEnabled("openai", provider)).toBe(provider === "openai" || provider === "openai-codex");
	}
});
