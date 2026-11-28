import type { FileDiff } from "@argon/shared";
import { create } from "zustand";

/** A file shown in the side panel (decisions D22). `target` is passed to fs.readFile as is. */
export interface OpenFile {
	sessionId: string;
	target: string;
	cwd?: string;
	/** Changes to this file known where it was opened from (a tool call or the turn's change list). */
	diffs?: FileDiff[];
	/** Bumped on every open, so opening the same file again scrolls back to its line. */
	nonce: number;
}

export const FILE_PANEL_MIN_WIDTH = 320;
/** Room the chat keeps beside the panel. */
export const FILE_PANEL_CHAT_MIN_WIDTH = 360;
const widthKey = "argon.filePanelWidth";

function readWidth(): number | undefined {
	try {
		const stored = Number(localStorage.getItem(widthKey));
		return stored >= FILE_PANEL_MIN_WIDTH ? stored : undefined;
	} catch {
		return undefined;
	}
}

interface FilePanelState {
	file?: OpenFile;
	/** Set by dragging the panel's edge (a per-browser preference, like the theme); unset is the CSS default. */
	width?: number;
	setWidth(width: number | undefined): void;
	openFile(file: Omit<OpenFile, "nonce">): void;
	close(): void;
}

let nonce = 0;

export const useFilePanel = create<FilePanelState>((set) => ({
	file: undefined,
	width: readWidth(),
	setWidth(width) {
		set({ width });
		try {
			if (width === undefined) localStorage.removeItem(widthKey);
			else localStorage.setItem(widthKey, String(width));
		} catch {
			// Kept for this page only.
		}
	},
	openFile(file) {
		set({ file: { ...file, nonce: ++nonce } });
	},
	close() {
		set({ file: undefined });
	},
}));
