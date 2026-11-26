/**
 * ExtensionUIContext implementation that maps pi extension UI calls onto Argon interactions and
 * events. Mirrors what pi's own RPC mode supports; TUI-only features degrade to no-ops.
 */

import type { ExtensionWidget, InteractionResponse, SessionEvent } from "@argon/shared";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { InteractionBroker } from "./interactions.ts";
import { log } from "./log.ts";

/** Columns component widgets are rendered at (the GUI shows them in a monospace block). */
export const WIDGET_COLUMNS = 100;
const MAX_WIDGET_LINES = 200;
const RENDER_DELAY_MS = 50;

// CSI sequences, OSC sequences (e.g. hyperlinks) and other two-byte escapes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI, "");
}

interface WidgetComponent {
	render(width: number): string[];
	invalidate?(): void;
	dispose?(): void;
}

type WidgetFactory = (tui: unknown, theme: ExtensionUIContext["theme"]) => WidgetComponent;

/**
 * Just enough of pi-tui's TUI for widget components: they call requestRender() when their content
 * changes and may read the terminal size. Anything else is a no-op.
 */
function createHeadlessTui(requestRender: () => void): unknown {
	const noop = () => undefined;
	const terminal = { columns: WIDGET_COLUMNS, rows: 40, write: noop };
	return new Proxy(
		{ requestRender, terminal, columns: WIDGET_COLUMNS, rows: 40 },
		{
			get: (target, prop) => {
				if (prop === "then") return undefined;
				return prop in target ? target[prop as keyof typeof target] : noop;
			},
		},
	);
}

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

export function createUIBridge(
	broker: InteractionBroker,
	emit: (event: SessionEvent) => void,
): ExtensionUIContext & { disposeWidgets(): void } {
	const theme = createPlainTheme();
	const valueFrom = (r: InteractionResponse) => ("value" in r ? r.value : undefined);
	const components = new Map<string, { component: WidgetComponent; timer?: NodeJS.Timeout }>();

	const emitWidget = (key: string, lines: string[] | undefined, placement: ExtensionWidget["placement"]) => {
		if (lines === undefined) {
			emit({ type: "widget_changed", key });
			return;
		}
		const clean = lines.slice(0, MAX_WIDGET_LINES).map((line) => stripAnsi(String(line)).trimEnd());
		emit({ type: "widget_changed", key, widget: { key, lines: clean, placement } });
	};

	const unmount = (key: string) => {
		const mounted = components.get(key);
		if (!mounted) return;
		components.delete(key);
		clearTimeout(mounted.timer);
		try {
			mounted.component.dispose?.();
		} catch (error) {
			log.warn(`widget ${key} dispose failed`, error);
		}
	};

	/** Component widgets are rendered here, as text, whenever they ask for a render. */
	const mount = (key: string, factory: WidgetFactory, placement: ExtensionWidget["placement"]) => {
		const entry: { component: WidgetComponent; timer?: NodeJS.Timeout } = { component: { render: () => [] } };
		const render = () => {
			entry.timer = undefined;
			if (components.get(key) !== entry) return;
			try {
				emitWidget(key, entry.component.render(WIDGET_COLUMNS), placement);
			} catch (error) {
				log.warn(`widget ${key} render failed`, error);
			}
		};
		const requestRender = () => {
			if (components.get(key) === entry && !entry.timer) entry.timer = setTimeout(render, RENDER_DELAY_MS);
		};
		try {
			entry.component = factory(createHeadlessTui(requestRender), theme);
		} catch (error) {
			log.warn(`widget ${key} could not be created`, error);
			return;
		}
		components.set(key, entry);
		render();
	};

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
		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions) {
			const placement = options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor";
			unmount(key);
			if (content === undefined) emitWidget(key, undefined, placement);
			else if (Array.isArray(content)) emitWidget(key, content as string[], placement);
			else if (typeof content === "function") mount(key, content as WidgetFactory, placement);
		},
		onTerminalInput: () => () => {},
		setWorkingMessage(message?: string) {
			emit({ type: "working_message_changed", message: message ? stripAnsi(message) : undefined });
		},
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
	return Object.assign(ui, {
		disposeWidgets() {
			for (const key of [...components.keys()]) unmount(key);
		},
	});
}
