import type { CompletionItem, SlashCommand } from "@argon/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ARGON_COMMANDS } from "@/lib/builtin-commands";
import { cn } from "@/lib/utils";
import { getClient } from "@/stores/app";

export interface Suggestion {
	key: string;
	label: string;
	description?: string;
	badge?: string;
	kind: "command" | "argument" | "file";
	/** Full composer text after accepting. */
	apply: string;
	/** Caret position after accepting (default: end of text). */
	cursor?: number;
}

/** An `@` reference ending at the caret: `@path` or `@"path with spaces`, starting a word. */
function atReferenceBefore(textBeforeCursor: string): boolean {
	return /(?:^|[\s(["'])@(?:"[^"]*|[^\s"]*)$/.test(textBeforeCursor);
}

/** `/name rest` → { name, args } when the text is a slash command; args undefined while typing the name. */
function parseCommand(text: string): { name: string; args: string | undefined } | undefined {
	const match = /^\/(\S*)(?:\s([\s\S]*))?$/.exec(text);
	if (!match) return undefined;
	return { name: match[1] ?? "", args: match[2] };
}

function rankCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	const q = query.toLowerCase();
	const scored: { command: SlashCommand; score: number }[] = [];
	for (const command of commands) {
		const name = command.name.toLowerCase();
		// Skills are addressed as skill:<name>; let "/foo" find "skill:foo" too.
		const bare = name.startsWith("skill:") ? name.slice(6) : name;
		let score: number;
		if (!q) score = command.source === "skill" ? 2 : 0;
		else if (name.startsWith(q) || bare.startsWith(q)) score = 0;
		else if (name.includes(q)) score = 1;
		else if (command.description?.toLowerCase().includes(q)) score = 3;
		else continue;
		scored.push({ command, score });
	}
	return scored.sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name)).map((s) => s.command);
}

/**
 * Suggestions for the composer text: command names while typing `/name`, then argument completions
 * from the backend for commands that offer them. Commands are fetched when a `/` is typed, so newly
 * loaded extensions show up without a refresh.
 */
export function useSlashCompletion(sessionId: string, text: string, cursor: number = text.length) {
	const [extensionCommands, setCommands] = useState<SlashCommand[]>([]);
	const extensionNames = useMemo(
		() => new Set(extensionCommands.filter((c) => c.source === "extension").map((c) => c.name)),
		[extensionCommands],
	);
	// Built-ins Argon handles itself, unless an extension overrides the name.
	const commands = useMemo<SlashCommand[]>(
		() => [
			...extensionCommands,
			...ARGON_COMMANDS.filter((c) => !extensionNames.has(c.name)).map((c) => ({
				name: c.name,
				description: c.description,
				source: "extension" as const,
				origin: "argon",
				completesArguments: false,
			})),
		],
		[extensionCommands, extensionNames],
	);
	const [argItems, setArgItems] = useState<{ forText: string; items: CompletionItem[] }>();
	const [dismissedFor, setDismissedFor] = useState<string>();
	const [fileResult, setFileResult] = useState<{
		forKey: string;
		prefix: string;
		items: (CompletionItem & { isDirectory: boolean })[];
	}>();
	const textBeforeCursor = text.slice(0, cursor);
	const fileKey = `${cursor}:${text}`;
	const wantsFiles = atReferenceBefore(textBeforeCursor);
	useEffect(() => {
		if (!wantsFiles) return;
		const timer = setTimeout(() => {
			getClient()
				.request("sessions.completeFile", { sessionId, textBeforeCursor })
				.then((result) => setFileResult(result ? { forKey: fileKey, ...result } : undefined))
				.catch(() => setFileResult(undefined));
		}, 100);
		return () => clearTimeout(timer);
	}, [wantsFiles, sessionId, textBeforeCursor, fileKey]);
	const parsed = parseCommand(text);
	const typingCommand = parsed !== undefined;
	const loadedFor = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!typingCommand) {
			loadedFor.current = undefined;
			return;
		}
		if (loadedFor.current === sessionId) return;
		loadedFor.current = sessionId;
		getClient()
			.request("sessions.commands", { sessionId })
			.then((result) => setCommands(result.commands))
			.catch(() => setCommands([]));
	}, [typingCommand, sessionId]);

	const command = parsed?.args !== undefined ? commands.find((c) => c.name === parsed.name) : undefined;
	const wantsArgs = command?.completesArguments === true && parsed?.args !== undefined;
	useEffect(() => {
		if (!wantsArgs || !command || parsed?.args === undefined) return;
		const forText = text;
		const timer = setTimeout(() => {
			getClient()
				.request("sessions.completeCommand", { sessionId, name: command.name, argumentPrefix: parsed.args ?? "" })
				.then((result) => setArgItems({ forText, items: result.items }))
				.catch(() => setArgItems({ forText, items: [] }));
		}, 80);
		return () => clearTimeout(timer);
	}, [wantsArgs, command, parsed?.args, sessionId, text]);

	const suggestions = useMemo<Suggestion[]>(() => {
		if (wantsFiles) {
			if (fileResult?.forKey !== fileKey) return [];
			const start = cursor - fileResult.prefix.length;
			return fileResult.items.map((item) => {
				// Like pi's editor: a space after files, none after directories so completion can continue.
				const inserted = item.value + (item.isDirectory ? "" : " ");
				const caret = start + (item.isDirectory && item.value.endsWith('"') ? item.value.length - 1 : inserted.length);
				return {
					key: item.value,
					label: item.label,
					description: item.description,
					kind: "file" as const,
					apply: text.slice(0, start) + inserted + text.slice(cursor),
					cursor: caret,
				};
			});
		}
		if (!parsed) return [];
		if (parsed.args === undefined) {
			return rankCommands(commands, parsed.name)
				.slice(0, 50)
				.map((c) => ({
					key: c.name,
					label: `/${c.name}`,
					description: c.description,
					badge: c.source === "extension" ? c.origin : c.source,
					kind: "command" as const,
					apply: `/${c.name} `,
				}));
		}
		if (!command || argItems?.forText !== text) return [];
		return argItems.items.map((item) => ({
			key: item.value,
			label: item.label,
			description: item.description,
			kind: "argument" as const,
			apply: `/${command.name} ${item.value}`,
		}));
	}, [parsed, commands, command, argItems, text, wantsFiles, fileResult, fileKey, cursor]);

	const open = suggestions.length > 0 && dismissedFor !== fileKey;
	return { suggestions: open ? suggestions : [], dismiss: () => setDismissedFor(fileKey), extensionNames };
}

export function SlashCompletionMenu({
	suggestions,
	activeIndex,
	onHover,
	onPick,
}: {
	suggestions: Suggestion[];
	activeIndex: number;
	onHover: (index: number) => void;
	onPick: (suggestion: Suggestion) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);
	if (suggestions.length === 0) return null;
	return (
		<div
			ref={listRef}
			role="listbox"
			className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
		>
			{suggestions.map((s, i) => (
				<div
					key={s.key}
					role="option"
					tabIndex={-1}
					aria-selected={i === activeIndex}
					data-index={i}
					onMouseEnter={() => onHover(i)}
					onMouseDown={(e) => {
						// Keep focus in the textarea.
						e.preventDefault();
						onPick(s);
					}}
					className={cn(
						"flex cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-sm",
						i === activeIndex && "bg-accent text-accent-foreground",
					)}
				>
					<span className="shrink-0 font-mono">{s.label}</span>
					{s.description && <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.description}</span>}
					{s.badge && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.badge}</span>}
				</div>
			))}
		</div>
	);
}
