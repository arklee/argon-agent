/**
 * ExtensionUIContext implementation that maps pi extension UI calls onto Argon interactions and
 * events. Mirrors what pi's own RPC mode supports; TUI-only features degrade to no-ops.
 */

import type { InteractionResponse, SessionEvent } from "@argon/shared";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { InteractionBroker } from "./interactions.ts";

/**
 * A theme stand-in for a GUI host: every styling method returns its text argument unchanged, so
 * extensions that format strings with `ctx.ui.theme.fg(...)` keep working without ANSI codes.
 */
function createPlainTheme(): ExtensionUIContext["theme"] {
	const passthrough = (...args: unknown[]) => {
		for (let i = args.length - 1; i >= 0; i--) {
			if (typeof args[i] === "string") return args[i];
		}
		return "";
	};
	return new Proxy(
		{},
		{
			get: (_target, prop) => {
				if (prop === "then") return undefined;
				if (prop === "name") return "argon-plain";
				return passthrough;
			},
		},
	) as ExtensionUIContext["theme"];
}

function dialogOptions(opts: ExtensionUIDialogOptions | undefined) {
	return { timeoutMs: opts?.timeout, signal: opts?.signal };
}

export function createUIBridge(broker: InteractionBroker, emit: (event: SessionEvent) => void): ExtensionUIContext {
	const theme = createPlainTheme();
	const valueFrom = (r: InteractionResponse) => ("value" in r ? r.value : undefined);

	const ui: ExtensionUIContext = {
		async select(title, options, opts) {
			const r = await broker.request(
				{ kind: "select", title, options },
				{ ...dialogOptions(opts), fallback: { cancelled: true } },
			);
			return valueFrom(r);
		},
		async confirm(title, message, opts) {
			const r = await broker.request(
				{ kind: "confirm", title, message },
				{ ...dialogOptions(opts), fallback: { confirmed: false } },
			);
			return "confirmed" in r ? r.confirmed : false;
		},
		async input(title, placeholder, opts) {
			const r = await broker.request(
				{ kind: "input", title, placeholder },
				{ ...dialogOptions(opts), fallback: { cancelled: true } },
			);
			return valueFrom(r);
		},
		async editor(title, prefill) {
			const r = await broker.request({ kind: "editor", title, prefill }, { fallback: { cancelled: true } });
			return valueFrom(r);
		},
		notify(message, type) {
			emit({ type: "notification", level: type ?? "info", message });
		},
		setStatus(key, text) {
			emit({ type: "status_entry", key, text });
		},
		setWidget(key: string, content: unknown) {
			// Only string widgets can cross the wire; component factories are TUI-only.
			if (content === undefined) emit({ type: "status_entry", key: `widget:${key}`, text: undefined });
			else if (Array.isArray(content)) emit({ type: "status_entry", key: `widget:${key}`, text: content.join("\n") });
		},
		onTerminalInput: () => () => {},
		setWorkingMessage() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setHiddenThinkingLabel() {},
		setFooter() {},
		setHeader() {},
		setTitle() {},
		async custom() {
			return undefined as never;
		},
		pasteToEditor() {},
		setEditorText() {},
		getEditorText: () => "",
		addAutocompleteProvider() {},
		setEditorComponent() {},
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Theme switching is not supported in Argon" }),
		getToolsExpanded: () => false,
		setToolsExpanded() {},
	} as ExtensionUIContext;
	return ui;
}
