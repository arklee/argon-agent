import type { SessionState } from "@argon/shared";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { hasMcpPanel } from "@/components/McpPanel";
import { SlashCompletionMenu, type Suggestion, useSlashCompletion } from "@/components/SlashCompletion";
import { Button } from "@/components/ui/button";
import { matchBuiltin } from "@/lib/builtin-commands";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

export function Composer({ session }: { session: SessionState }) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const sendPrompt = useApp((s) => s.sendPrompt);
	const abort = useApp((s) => s.abort);
	const setMcpPanelOpen = useApp((s) => s.setMcpPanelOpen);
	const compact = useApp((s) => s.compact);
	const renameSession = useApp((s) => s.renameSession);
	const createSession = useApp((s) => s.createSession);
	const ref = useRef<HTMLTextAreaElement>(null);
	const { suggestions, dismiss, extensionNames } = useSlashCompletion(session.sessionId, text);
	const [activeIndex, setActiveIndex] = useState(0);
	/** Whether the user moved the highlight since the text last changed. */
	const [navigated, setNavigated] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight when the list changes
	useEffect(() => {
		setActiveIndex(0);
		setNavigated(false);
	}, [suggestions.length, text]);

	const pick = (suggestion: Suggestion) => {
		setText(suggestion.apply);
		ref.current?.focus();
	};
	const running = session.status === "running";
	const queued = [...session.queue.steering, ...session.queue.followUp];

	const submit = async (behavior?: "steer" | "followUp") => {
		const value = text.trim();
		if (!value || sending) return;
		// The GUI has a real MCP manager; pi would only print a text status for a bare /mcp.
		if (value === "/mcp" && hasMcpPanel(session.mcp)) {
			setMcpPanelOpen(true);
			setText("");
			return;
		}
		const builtin = matchBuiltin(value, extensionNames);
		if (builtin?.kind === "unsupported") {
			toast.warning(`/${builtin.name} is a pi terminal command and is not available in Argon yet`);
			return;
		}
		if (builtin?.kind === "argon") {
			setText("");
			if (builtin.name === "compact") void compact(builtin.argument);
			else if (builtin.name === "name") {
				if (builtin.argument) void renameSession(builtin.argument);
				else toast.warning("Usage: /name <session name>");
			} else if (builtin.name === "new") void createSession(session.cwd).catch(() => undefined);
			return;
		}
		setSending(true);
		try {
			await sendPrompt(value, running ? (behavior ?? "followUp") : undefined);
			setText("");
		} catch {
			// toast shown by the store; keep the text so nothing is lost
		} finally {
			setSending(false);
			ref.current?.focus();
		}
	};

	return (
		<div className="mx-auto w-full max-w-3xl px-6 pb-6">
			{queued.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-1.5">
					{queued.map((q, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: queue entries have no ids
							key={i}
							className="max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
						>
							Queued: {q}
						</span>
					))}
				</div>
			)}
			<div className="relative rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
				<SlashCompletionMenu
					suggestions={suggestions}
					activeIndex={activeIndex}
					onHover={setActiveIndex}
					onPick={pick}
				/>
				<textarea
					ref={ref}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						// Never act while an IME composition is active (Chinese/Japanese input).
						if (e.nativeEvent.isComposing) return;
						if (suggestions.length > 0) {
							const current = suggestions[Math.min(activeIndex, suggestions.length - 1)];
							if (e.key === "ArrowDown" || e.key === "ArrowUp") {
								e.preventDefault();
								const step = e.key === "ArrowDown" ? 1 : -1;
								setActiveIndex((i) => (i + step + suggestions.length) % suggestions.length);
								setNavigated(true);
								return;
							}
							if (e.key === "Escape") {
								e.preventDefault();
								dismiss();
								return;
							}
							// Tab always accepts. Enter accepts a command name (unless already typed in full), but an
							// argument only after the user picked one, so "/cmd ⏎" still sends "/cmd".
							const enterAccepts =
								current !== undefined &&
								current.apply.trimEnd() !== text.trimEnd() &&
								(current.kind === "command" || navigated);
							if (current && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && enterAccepts))) {
								e.preventDefault();
								pick(current);
								return;
							}
						}
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void submit(e.altKey ? "steer" : "followUp");
						}
					}}
					rows={1}
					placeholder={running ? "Queue a follow-up… (⌥↵ to steer)" : "Ask Argon…"}
					className="field-sizing-content max-h-64 min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-muted-foreground"
					autoFocus
				/>
				<div className="flex items-center justify-between px-3 pb-2.5">
					<span className="truncate text-xs text-muted-foreground">
						{session.statusEntries.map((s) => s.text).join(" · ")}
					</span>
					<div className="flex items-center gap-1.5">
						{running && (
							<Button
								variant="outline"
								size="icon-sm"
								className="rounded-full"
								onClick={() => void abort()}
								title="Stop"
							>
								<Square className="fill-current" />
							</Button>
						)}
						<Button
							size="icon-sm"
							className={cn("rounded-full", !text.trim() && "opacity-40")}
							disabled={!text.trim() || sending}
							onClick={() => void submit()}
							title="Send"
						>
							<ArrowUp />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
