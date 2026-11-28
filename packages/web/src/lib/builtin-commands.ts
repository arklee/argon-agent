/**
 * pi's built-in slash commands (`/compact`, `/model`, ...) live in its TUI, not in the SDK's
 * `prompt()`: sent to the backend they would reach the model as plain text. The composer handles the
 * ones Argon supports and stops the others. Names follow pi 1.7.0 (core/slash-commands.ts).
 *
 * An extension command with the same name wins (it is sent to pi, which runs it).
 */

/** Built-ins Argon implements natively. */
export const ARGON_COMMANDS = ["compact", "name", "new"] as const;

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
	if (ARGON_COMMANDS.some((command) => command === name))
		return { kind: "argon", name, argument: (match[2] ?? "").trim() };
	if (PI_TUI_ONLY.has(name)) return { kind: "unsupported", name };
	return undefined;
}
