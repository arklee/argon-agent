/**
 * pi's built-in slash commands (`/compact`, `/model`, ...) live in its TUI, not in the SDK's
 * `prompt()`: sent to the backend they would reach the model as plain text. The composer handles the
 * ones Argon supports and stops the others. Names follow pi 1.6.1 (core/slash-commands.ts).
 *
 * An extension command with the same name wins (it is sent to pi, which runs it).
 */

export interface ArgonCommand {
	name: string;
	description: string;
	/** Whether text after the name is passed on. */
	takesArgument?: boolean;
}

/** Built-ins Argon implements natively. */
export const ARGON_COMMANDS: ArgonCommand[] = [
	{ name: "compact", description: "Compact the context now (optional: focus instructions)", takesArgument: true },
	{ name: "name", description: "Rename this session", takesArgument: true },
	{ name: "new", description: "Start a new session in this project" },
];

/** pi TUI built-ins Argon does not support (yet); typing them must not reach the model. */
const PI_TUI_ONLY = new Set([
	"settings",
	"model",
	"tree",
	"thinking",
	"scoped-models",
	"export",
	"import",
	"share",
	"bug",
	"copy",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"trust",
	"login",
	"logout",
	"resume",
	"reload",
	"quit",
]);

export type BuiltinMatch =
	| { kind: "argon"; name: string; argument: string }
	| { kind: "unsupported"; name: string }
	| undefined;

export function matchBuiltin(text: string, extensionCommands: ReadonlySet<string>): BuiltinMatch {
	const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!match) return undefined;
	const name = match[1] ?? "";
	if (extensionCommands.has(name)) return undefined;
	if (ARGON_COMMANDS.some((c) => c.name === name)) return { kind: "argon", name, argument: (match[2] ?? "").trim() };
	if (PI_TUI_ONLY.has(name)) return { kind: "unsupported", name };
	return undefined;
}
