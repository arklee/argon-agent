import { create } from "zustand";

/**
 * Sidebar layout: whether it is shown and how wide. A per-browser display preference like the theme
 * (decisions D12), kept in localStorage.
 */
export const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

const storageKey = "argon.sidebar";

interface Stored {
	collapsed: boolean;
	width: number;
}

export function clampSidebarWidth(width: number): number {
	return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function read(): Stored {
	try {
		const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Stored>;
		return {
			collapsed: stored.collapsed === true,
			width: typeof stored.width === "number" ? clampSidebarWidth(stored.width) : SIDEBAR_DEFAULT_WIDTH,
		};
	} catch {
		return { collapsed: false, width: SIDEBAR_DEFAULT_WIDTH };
	}
}

interface SidebarState extends Stored {
	/** A resize drag is in progress (width changes apply without animation). */
	resizing: boolean;
	setCollapsed(collapsed: boolean): void;
	toggle(): void;
	setWidth(width: number): void;
	setResizing(resizing: boolean): void;
}

export const useSidebar = create<SidebarState>((set, get) => {
	const save = () => {
		const { collapsed, width } = get();
		try {
			localStorage.setItem(storageKey, JSON.stringify({ collapsed, width }));
		} catch {
			// Kept for this page only.
		}
	};
	return {
		...read(),
		resizing: false,
		setCollapsed(collapsed) {
			set({ collapsed });
			save();
		},
		toggle() {
			set({ collapsed: !get().collapsed });
			save();
		},
		setWidth(width) {
			set({ width: clampSidebarWidth(width) });
			save();
		},
		setResizing(resizing) {
			set({ resizing });
		},
	};
});
