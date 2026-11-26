import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const languageKey = "argon.language";
const resources = { en: { translation: en }, "zh-CN": { translation: zhCN } };

export type Language = keyof typeof resources;
export type LanguagePreference = Language | "system";

declare module "i18next" {
	interface CustomTypeOptions {
		resources: (typeof resources)["en"];
		strictKeyChecks: true;
	}
}

export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): Language {
	if (preference !== "system") return preference;
	// The first system language Argon supports wins, so a Chinese fallback does not override English.
	const first = languages
		.map((language) => language.toLowerCase())
		.find((l) => l.startsWith("zh") || l.startsWith("en"));
	return first?.startsWith("zh") ? "zh-CN" : "en";
}

function readLanguagePreference(): LanguagePreference {
	try {
		const value = localStorage.getItem(languageKey);
		if (value === "en" || value === "zh-CN") return value;
	} catch {
		// Storage can be unavailable in the browser.
	}
	return "system";
}

let preference = readLanguagePreference();

export function getLanguagePreference(): LanguagePreference {
	return preference;
}

export function getLanguage(): Language {
	return i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
}

function preferredLanguage(): Language {
	return resolveLanguage(preference, globalThis.navigator?.languages ?? []);
}

export function setLanguagePreference(value: LanguagePreference) {
	preference = value;
	try {
		localStorage.setItem(languageKey, value);
	} catch {
		// Apply the preference for this page even if it cannot be saved.
	}
	return i18n.changeLanguage(preferredLanguage());
}

i18n.on("languageChanged", (language) => {
	if (typeof document !== "undefined") document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
	resources,
	lng: preferredLanguage(),
	fallbackLng: "en",
	supportedLngs: ["en", "zh-CN"],
	initAsync: false,
	interpolation: { escapeValue: false },
	showSupportNotice: false,
});

if (typeof window !== "undefined") {
	window.addEventListener("languagechange", () => {
		if (preference === "system") void i18n.changeLanguage(preferredLanguage());
	});
}

export const t = i18n.t.bind(i18n);
