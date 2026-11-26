import { useEffect, useState } from "react";
import { groupByProject } from "@/lib/session-order";
import { useApp } from "@/stores/app";

const platform =
	(navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform;
const mac = /mac/i.test(platform);
export const shortcutLabels = {
	newSession: mac ? "⌘⇧O" : "Ctrl+Shift+O",
	switchSession: mac ? "⌘⌥↑ / ↓" : "Ctrl+Alt+↑ / ↓",
	focus: mac ? "⌘⇧L" : "Ctrl+Shift+L",
};

export function useGlobalShortcuts() {
	const [helpOpen, setHelpOpen] = useState(false);
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="select-content"]')
			)
				return;
			const composer = document.querySelector<HTMLTextAreaElement>("#argon-composer");
			const target = document.activeElement;
			const editable =
				target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable);
			const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			const state = useApp.getState();
			if (mod && event.shiftKey && !event.altKey) {
				if (event.key.toLowerCase() === "o" && state.environment) {
					event.preventDefault();
					state.setNewSessionDialog({ open: true });
				} else if (event.key.toLowerCase() === "l" && composer) {
					event.preventDefault();
					composer.focus();
				}
			} else if (mod && event.altKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
				event.preventDefault();
				const sessions = groupByProject(state.sessions).flatMap((group) => group.sessions);
				const index = sessions.findIndex((s) => s.sessionId === state.activeSessionId);
				const next = sessions[index + (event.key === "ArrowUp" ? -1 : 1)];
				if (next && !state.openingSession) void state.openSession(next);
			} else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
				if (
					event.key === "Escape" &&
					composer &&
					target === composer &&
					state.activeSessionId &&
					state.sessionStates[state.activeSessionId]?.status === "running"
				) {
					event.preventDefault();
					void state.abort();
				} else if (!editable && event.key === "?") {
					event.preventDefault();
					setHelpOpen(true);
				} else if ((!target || target === document.body) && [...event.key].length === 1 && event.key !== " ") {
					// Only when nothing is focused: a focused button or option must keep its own keys (Space, letters
					// for typeahead). Focus synchronously so the browser inserts the keystroke at the caret.
					composer?.focus();
				}
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	return { helpOpen, setHelpOpen };
}
