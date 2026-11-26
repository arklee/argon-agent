import { useSyncExternalStore } from "react";

/**
 * Light / dark / follow-the-OS. A per-browser preference like the UI language (decisions D12): it lives in
 * localStorage and toggles `.dark` on <html>.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

declare global {
	interface Window {
		/** Present only in the desktop shell; presentation hints, no native capabilities. */
		argonDesktop?: { setTheme(theme: ThemePreference): void };
	}
}

const storageKey = "argon.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function isThemePreference(value: unknown): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function getThemePreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(storageKey);
		if (isThemePreference(stored)) return stored;
	} catch {
		// Storage can be unavailable in the browser.
	}
	return "system";
}

let preference: ThemePreference = getThemePreference();

export function getResolvedTheme(): ResolvedTheme {
	if (preference !== "system") return preference;
	return media.matches ? "dark" : "light";
}

function apply(): void {
	// Native chrome (Windows title bar buttons, macOS menus) follows the preference too. This also makes the
	// shell report the forced theme to prefers-color-scheme, which `getResolvedTheme` ignores unless on "system".
	window.argonDesktop?.setTheme(preference);
	const theme = getResolvedTheme();
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	// Native controls and scrollbars follow the chosen theme, not just the OS.
	root.style.colorScheme = theme;
	for (const listener of listeners) listener();
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initTheme(): void {
	apply();
	media.addEventListener("change", () => {
		if (preference === "system") apply();
	});
	// Keep other tabs of the same origin in sync.
	window.addEventListener("storage", (event) => {
		if (event.key !== storageKey) return;
		preference = getThemePreference();
		apply();
	});
}

export function setThemePreference(next: ThemePreference): void {
	preference = next;
	try {
		if (next === "system") localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, next);
	} catch {
		// Not persisted; still applied for this page.
	}
	apply();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
	return useSyncExternalStore(subscribe, () => preference);
}

export function useResolvedTheme(): ResolvedTheme {
	return useSyncExternalStore(subscribe, getResolvedTheme);
}
