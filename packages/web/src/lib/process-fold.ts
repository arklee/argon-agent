import { useSyncExternalStore } from "react";

/**
 * When a turn's process (thinking, commentary, tool calls) is folded. A per-browser display preference
 * like the theme (decisions D12), kept in localStorage.
 *
 * - "auto": shown while the turn runs, folded once it ends with an answer (like Codex).
 * - "expanded": always shown (like Claude Code).
 * - "collapsed": folded from the start; the fold line shows what the agent is doing.
 */
export type ProcessFold = "auto" | "expanded" | "collapsed";

const storageKey = "argon.processFold";
const listeners = new Set<() => void>();

function isProcessFold(value: unknown): value is ProcessFold {
	return value === "auto" || value === "expanded" || value === "collapsed";
}

function read(): ProcessFold {
	try {
		const stored = localStorage.getItem(storageKey);
		if (isProcessFold(stored)) return stored;
	} catch {
		// Storage can be unavailable in the browser.
	}
	return "auto";
}

let current: ProcessFold = read();

if (typeof window !== "undefined")
	window.addEventListener("storage", (event) => {
		if (event.key !== storageKey) return;
		current = read();
		for (const listener of listeners) listener();
	});

export function getProcessFold(): ProcessFold {
	return current;
}

export function setProcessFold(next: ProcessFold): void {
	current = next;
	try {
		localStorage.setItem(storageKey, next);
	} catch {
		// Kept for this page only.
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useProcessFold(): ProcessFold {
	return useSyncExternalStore(subscribe, getProcessFold);
}
