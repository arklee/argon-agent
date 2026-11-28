/**
 * Font preferences: interface, conversation content and code each have a family and a size. Per-browser
 * like the UI language (decisions D12): saved in localStorage and applied as CSS variables
 * (--ui-font, --content-font, --code-font and their -size twins, see index.css).
 */

export type FontRole = "ui" | "content" | "code";

export interface FontPref {
	/** CSS font-family list; empty means the default stack. */
	family: string;
	/** px, in steps of 0.5. */
	size: number;
}

export type FontPrefs = Record<FontRole, FontPref>;

export const FONT_ROLES: readonly FontRole[] = ["ui", "content", "code"];
export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 32;

const SANS =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "PingFang SC", monospace';

export const DEFAULT_FAMILY: Record<FontRole, string> = { ui: SANS, content: SANS, code: MONO };
export const DEFAULT_SIZE: Record<FontRole, number> = { ui: 13, content: 13, code: 12.5 };

/** Families offered in the settings list (any installed font can still be typed). */
export const FONT_SUGGESTIONS: Record<FontRole, string[]> = {
	ui: ["Geist Variable", "Inter", "PingFang SC", "Microsoft YaHei"],
	content: ["Geist Variable", "Inter", "PingFang SC", "Source Han Serif SC", "Georgia", "Microsoft YaHei"],
	code: ["JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", "Menlo", "Consolas"],
};

const storageKey = "argon.fonts";
const legacyKey = "argon.textSize";

/** Round to 0.5 px and clamp into the supported range. */
export function clampFontSize(value: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value * 2) / 2));
}

export function defaultFonts(): FontPrefs {
	return {
		ui: { family: "", size: DEFAULT_SIZE.ui },
		content: { family: "", size: DEFAULT_SIZE.content },
		code: { family: "", size: DEFAULT_SIZE.code },
	};
}

export function getFonts(): FontPrefs {
	const prefs = defaultFonts();
	try {
		const raw = localStorage.getItem(storageKey);
		const stored = raw ? (JSON.parse(raw) as Partial<Record<FontRole, Partial<FontPref>>>) : {};
		for (const role of FONT_ROLES) {
			const value = stored[role];
			if (typeof value?.family === "string") prefs[role].family = value.family.trim();
			if (typeof value?.size === "number") prefs[role].size = clampFontSize(value.size, DEFAULT_SIZE[role]);
		}
	} catch {
		// Unavailable storage or bad JSON: defaults.
	}
	return prefs;
}

/** A family as typed, quoted where needed, falling back to the default stack. */
export function familyStack(role: FontRole, family: string): string {
	const typed = family.trim();
	if (!typed) return DEFAULT_FAMILY[role];
	const names = typed
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean)
		.map((name) => (/^["'].*["']$/.test(name) || /^[\w-]+$/.test(name) ? name : `"${name.replace(/"/g, "")}"`));
	return `${names.join(", ")}, ${DEFAULT_FAMILY[role]}`;
}

export function applyFonts(prefs: FontPrefs = getFonts()): void {
	const style = document.documentElement.style;
	for (const role of FONT_ROLES) {
		style.setProperty(`--${role}-font`, familyStack(role, prefs[role].family));
		style.setProperty(`--${role}-font-size`, `${prefs[role].size}px`);
	}
}

export function setFont(role: FontRole, pref: FontPref): FontPrefs {
	const prefs = getFonts();
	prefs[role] = { family: pref.family.trim(), size: clampFontSize(pref.size, DEFAULT_SIZE[role]) };
	try {
		const isDefault = FONT_ROLES.every((r) => !prefs[r].family && prefs[r].size === DEFAULT_SIZE[r]);
		if (isDefault) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, JSON.stringify(prefs));
		// The single text size it replaces no longer applies.
		localStorage.removeItem(legacyKey);
	} catch {
		// Not persisted; still applied for this page.
	}
	applyFonts(prefs);
	return prefs;
}
