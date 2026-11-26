/**
 * Conversation text size in px (messages, tool cards, composer). A per-browser preference like the UI
 * language (decisions D12): it lives in localStorage and sets the --chat-font-size CSS variable.
 */

export const MIN_TEXT_SIZE = 9;
export const MAX_TEXT_SIZE = 32;
export const DEFAULT_TEXT_SIZE = 15;

const storageKey = "argon.textSize";

function isTextSize(value: number): boolean {
	return Number.isInteger(value) && value >= MIN_TEXT_SIZE && value <= MAX_TEXT_SIZE;
}

/** Round and clamp typed input into the supported range. */
export function clampTextSize(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_TEXT_SIZE;
	return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(value)));
}

export function getTextSize(): number {
	try {
		const stored = localStorage.getItem(storageKey);
		const value = Number(stored);
		if (stored && isTextSize(value)) return value;
	} catch {
		// Storage can be unavailable in the browser.
	}
	return DEFAULT_TEXT_SIZE;
}

export function applyTextSize(size: number = getTextSize()): void {
	document.documentElement.style.setProperty("--chat-font-size", `${size}px`);
}

export function setTextSize(size: number): void {
	if (!isTextSize(size)) return;
	try {
		if (size === DEFAULT_TEXT_SIZE) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, String(size));
	} catch {
		// Not persisted; still applied for this page.
	}
	applyTextSize(size);
}
