import { describe, expect, it, vi } from "vitest";
import { resolveLanguage, setLanguagePreference, t } from "./index";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

describe("resolveLanguage", () => {
	it("uses the first supported system language", () => {
		expect(resolveLanguage("system", ["zh-TW", "en-US"])).toBe("zh-CN");
		expect(resolveLanguage("system", ["fr-FR", "ZH"])).toBe("zh-CN");
		expect(resolveLanguage("system", ["en-US", "zh-CN"])).toBe("en");
	});

	it("falls back to English for other or missing system languages", () => {
		expect(resolveLanguage("system", ["fr-CA", "en-US"])).toBe("en");
		expect(resolveLanguage("system", [])).toBe("en");
	});

	it("honors an explicit language preference", () => {
		expect(resolveLanguage("en", ["zh-HK"])).toBe("en");
		expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
	});
});

function leafKeys(catalog: Record<string, unknown>): string[] {
	return Object.entries(catalog)
		.flatMap(([key, value]) =>
			typeof value === "object" && value !== null
				? leafKeys(value as Record<string, unknown>).map((child) => `${key}.${child}`)
				: [key],
		)
		.sort();
}

it("gives both bundled locales the same keys", () => {
	expect(leafKeys(zhCN)).toEqual(leafKeys(en));
});

it("applies a bundled language immediately and persists the UI preference", async () => {
	const setItem = vi.fn();
	const documentElement = { lang: "" };
	vi.stubGlobal("localStorage", { setItem });
	vi.stubGlobal("document", { documentElement });

	try {
		const chinese = setLanguagePreference("zh-CN");
		expect(t("diagnostics.problemCount", { count: 1 })).toBe("1 个问题");
		expect(documentElement.lang).toBe("zh-CN");
		expect(setItem).toHaveBeenCalledWith("argon.language", "zh-CN");
		await chinese;

		await setLanguagePreference("en");
		expect(t("diagnostics.problemCount", { count: 1 })).toBe("1 problem");
		expect(t("diagnostics.problemCount", { count: 2 })).toBe("2 problems");
		expect(documentElement.lang).toBe("en");
	} finally {
		await setLanguagePreference("system");
		vi.unstubAllGlobals();
	}
});
