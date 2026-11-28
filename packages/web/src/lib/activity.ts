/**
 * What the agent is doing right now, for the one live status line under a running turn. A pure view of
 * SessionState: the line only changes its words while the turn runs, it never comes and goes between
 * model calls (an empty streaming reply, a tool that just ended, a thought that arrived in one burst).
 */

import type { AssistantBlock, SessionState } from "@argon/shared";

type ToolCallBlock = Extract<AssistantBlock, { type: "toolCall" }>;

export type Activity =
	/** Waiting for the model (or between steps); `message` is an extension's working message. */
	| { kind: "waiting"; message?: string }
	/** `title` is the thought's latest heading, when the model writes summaries with headings. */
	| { kind: "thinking"; title?: string }
	/** The model is still writing a tool call's arguments. */
	| { kind: "preparing"; call: ToolCallBlock }
	| { kind: "tool"; call: ToolCallBlock }
	| { kind: "compacting" };

/**
 * The live activity, or undefined when nothing runs or something else already speaks for the turn:
 * a retry banner, a pending interaction (its card asks the user), or the reply's own text as it streams.
 */
export function liveActivity(state: SessionState, sending = false): Activity | undefined {
	if (state.retry || state.pendingInteractions.length > 0) return undefined;
	if (state.compacting) return { kind: "compacting" };
	if (state.status !== "running") return sending ? { kind: "waiting" } : undefined;
	const waiting: Activity = { kind: "waiting", message: state.workingMessage };
	const last = state.items.at(-1);
	if (last?.kind !== "assistant") return waiting;
	if (last.streaming) {
		const block = last.blocks.at(-1);
		// The reply has begun but says nothing yet: with reasoning on, the model is thinking (many
		// providers only send a summary of the thought at its end, or nothing at all).
		if (!block) return state.thinkingLevel !== "off" ? { kind: "thinking" } : waiting;
		if (block.type === "thinking") return { kind: "thinking", title: thoughtTitle(block.text) };
		if (block.type === "text") return block.text.trim() ? undefined : waiting;
		return { kind: "preparing", call: block };
	}
	// The reply ended: its tool calls run now (the latest running one is the most telling).
	const calls = last.blocks.filter((block): block is ToolCallBlock => block.type === "toolCall");
	const status = (call: ToolCallBlock) => state.tools[call.toolCallId]?.status;
	const active =
		calls.findLast((call) => status(call) === "running") ?? calls.find((call) => status(call) === "pending");
	if (active) return { kind: "tool", call: active };
	// A reply that ended on its text is the answer; the turn is only settling.
	const tail = last.blocks.at(-1);
	return tail?.type === "text" && tail.text.trim() ? undefined : waiting;
}

/** The last `**Heading**` line of a thought (reasoning summaries are written as headed sections). */
export function thoughtTitle(text: string): string | undefined {
	const matches = [...text.matchAll(/^\s*\*\*(.+?)\*\*\s*$/gm)];
	const title = matches.at(-1)?.[1]?.trim();
	return title || undefined;
}

/** When the running turn started: its user message's time, if it has one. */
export function turnStartedAt(state: SessionState): number | undefined {
	return state.items.findLast((item) => item.kind === "user")?.timestamp;
}

/** Kinds of the built-in tools, for a call whose arguments still stream (the backend's display comes later). */
const KIND_BY_NAME: Record<string, ToolKind> = {
	bash: "shell",
	powershell: "shell",
	read: "file_read",
	edit: "file_change",
	write: "file_change",
	apply_patch: "file_change",
	grep: "search",
	find: "search",
	ls: "search",
	codemode: "script",
};

type ToolKind = "shell" | "file_read" | "file_change" | "search" | "script";
/** What a shell command does, when its words say so plainly. */
type CommandKind = "test" | "check" | "build" | "install" | "dev" | "changes" | "commit";
export type CallKind = ToolKind | CommandKind;

const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>(["shell", "file_read", "file_change", "search", "script"]);

/**
 * The plain-language kind of a running call ("shell", "test", "file_read", ...), or undefined for other
 * tools. A shell command is only classified once it runs: while it streams, its words are not final.
 */
export function callKind(call: ToolCallBlock, running = true): CallKind | undefined {
	const kind = call.display?.kind ?? KIND_BY_NAME[call.name];
	if (!kind || !TOOL_KINDS.has(kind)) return undefined;
	if (kind === "shell" && running) return commandKind(shellCommand(call)) ?? "shell";
	return kind as ToolKind;
}

function shellCommand(call: ToolCallBlock): string | undefined {
	if (call.display?.kind === "shell") return call.display.command;
	const args = call.args;
	if (args && typeof args === "object" && "command" in args && typeof args.command === "string") return args.command;
	return undefined;
}

/** One plain word, or a quoted string without expansions. */
const WORD = /^(?:[\w./@:=+,%-]+|"[^"$`\\]*"|'[^'\\]*')$/;

/**
 * Classify a shell command by its program and first words. Only plain commands are read: words, quotes
 * without expansions, and `&&` chains whose leading steps are `cd`. Anything else (pipes, redirects,
 * variables, subshells) stays a generic command, so the label never claims more than the words say.
 */
export function commandKind(command: string | undefined): CommandKind | undefined {
	if (!command) return undefined;
	const steps = command.trim().split(/\s*&&\s*/);
	while (steps.length > 1 && /^cd(\s|$)/.test(steps[0] ?? "")) steps.shift();
	if (steps.length !== 1) return undefined;
	const words = (steps[0] ?? "").split(/\s+/).filter(Boolean);
	if (!words.length || !words.every((word) => WORD.test(word))) return undefined;
	let [program, ...rest] = words.map((word) => (/^["']/.test(word) ? word.slice(1, -1) : word));
	if (program === "npx" || program === "bunx") {
		if (rest[0] === "--yes" || rest[0] === "-y") rest.shift();
		[program, ...rest] = rest;
	}
	switch (program) {
		case undefined:
			return undefined;
		case "git":
			if (rest[0] === "status" || rest[0] === "diff" || rest[0] === "log" || rest[0] === "show") return "changes";
			return rest[0] === "commit" ? "commit" : undefined;
		case "npm":
		case "pnpm":
		case "yarn":
		case "bun": {
			const script = rest[0] === "run" || rest[0] === "run-script";
			const action = (script ? rest[1] : rest[0]) ?? "";
			if (action === "test" || action === "t" || action.startsWith("test:")) return "test";
			if (["lint", "typecheck", "type-check", "format", "check"].includes(action)) return "check";
			if (action === "build") return "build";
			if (!script && ["install", "i", "ci", "add"].includes(action)) return "install";
			if (action === "dev" || action === "start") return "dev";
			return undefined;
		}
		case "vitest":
		case "jest":
		case "mocha":
		case "pytest":
			return "test";
		case "playwright":
			return rest[0] === "test" ? "test" : undefined;
		case "cargo":
			if (rest[0] === "test") return "test";
			if (rest[0] === "build") return "build";
			return rest[0] === "check" || rest[0] === "clippy" || rest[0] === "fmt" ? "check" : undefined;
		case "go":
			if (rest[0] === "test") return "test";
			if (rest[0] === "build") return "build";
			return rest[0] === "vet" ? "check" : undefined;
		case "vite":
			if (rest[0] === "build") return "build";
			return !rest[0] || rest[0] === "dev" || rest[0] === "serve" ? "dev" : undefined;
		case "biome":
		case "ruff":
			return ["check", "lint", "format"].includes(rest[0] ?? "") ? "check" : undefined;
		case "tsc":
			return rest.includes("--build") || rest.includes("-b") ? "build" : "check";
		case "eslint":
		case "prettier":
		case "mypy":
			return "check";
		default:
			return undefined;
	}
}
