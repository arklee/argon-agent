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

interface FilePanelState {
	file?: OpenFile;
	openFile(file: Omit<OpenFile, "nonce">): void;
	close(): void;
}

let nonce = 0;

export const useFilePanel = create<FilePanelState>((set) => ({
	file: undefined,
	openFile(file) {
		set({ file: { ...file, nonce: ++nonce } });
	},
	close() {
		set({ file: undefined });
	},
}));
