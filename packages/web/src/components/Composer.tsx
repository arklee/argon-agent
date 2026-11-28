import type { SessionState } from "@argon/shared";
import { ArrowUp, Paperclip, Pencil, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AttachmentStrip, useAttachments } from "@/components/Attachments";
import { ContextMeter } from "@/components/ContextMeter";
import { ExtensionWidgets } from "@/components/ExtensionWidgets";
import { hasMcpPanel, McpPicker } from "@/components/McpPanel";
import { ModelPicker, PermissionPicker, ThinkingPicker } from "@/components/SessionControls";
import { SlashCompletionMenu, type Suggestion, useSlashCompletion } from "@/components/SlashCompletion";
import { ToolPresetPicker } from "@/components/ToolPresetPicker";
import { Button } from "@/components/ui/button";
import { matchBuiltin } from "@/lib/builtin-commands";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

export function Composer({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const draft = useApp((s) => s.composerDrafts[session.sessionId]);
	useEffect(() => {
		if (draft === undefined) return;
		setText(draft);
		useApp.setState((s) => {
			const composerDrafts = { ...s.composerDrafts };
			delete composerDrafts[session.sessionId];
			return { composerDrafts };
		});
	}, [session.sessionId, draft]);
	const [sending, setSending] = useState(false);
	const connected = useApp((s) => s.connection?.status === "connected");
	const sendPrompt = useApp((s) => s.sendPrompt);
	const abort = useApp((s) => s.abort);
	const clearQueue = useApp((s) => s.clearQueue);
	const setMcpPanelOpen = useApp((s) => s.setMcpPanelOpen);
	const compact = useApp((s) => s.compact);
	const renameSession = useApp((s) => s.renameSession);
	const createSession = useApp((s) => s.createSession);
	const ref = useRef<HTMLTextAreaElement>(null);
	const [cursor, setCursor] = useState(0);
	const fileInput = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	// Inserts at the caret (uploads add @path references there).
	const insertText = useCallback((insert: string) => {
		const el = ref.current;
		setText((current) => {
			const at = el ? el.selectionStart : current.length;
			const before = current.slice(0, at);
			const spacer = before && !/\s$/.test(before) ? " " : "";
			return before + spacer + insert + current.slice(at);
		});
	}, []);
	const attachments = useAttachments(insertText);
	const { suggestions, dismiss, extensionNames } = useSlashCompletion(session.sessionId, text, cursor);
	const [activeIndex, setActiveIndex] = useState(0);
	/** Whether the user moved the highlight since the text last changed. */
	const [navigated, setNavigated] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight when the list changes
	useEffect(() => {
		setActiveIndex(0);
		setNavigated(false);
	}, [suggestions.length, text]);

	const pick = (suggestion: Suggestion) => {
		const caret = suggestion.cursor ?? suggestion.apply.length;
		setText(suggestion.apply);
		setCursor(caret);
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(caret, caret);
		});
	};
	const running = session.status === "running";
	const queued = [...session.queue.steering, ...session.queue.followUp];

	const submit = async (behavior?: "steer" | "followUp") => {
		const value = text.trim();
		const images = attachments.images;
		if ((!value && images.length === 0) || sending || attachments.uploading || !connected) return;
		// The GUI has a real MCP manager; pi would only print a text status for a bare /mcp.
		if (value === "/mcp" && hasMcpPanel(session.mcp)) {
			setMcpPanelOpen(true);
			setText("");
			return;
		}
		const builtin = matchBuiltin(value, extensionNames);
		if (builtin?.kind === "unsupported") {
			toast.warning(t("composer.unsupportedCommand", { command: builtin.name }));
			return;
		}
		if (builtin?.kind === "argon") {
			setText("");
			if (builtin.name === "compact") void compact(builtin.argument);
			else if (builtin.name === "name") {
				if (builtin.argument) void renameSession(builtin.argument);
				else toast.warning(t("composer.nameUsage"));
			} else if (builtin.name === "new") void createSession(session.cwd).catch(() => undefined);
			return;
		}
		setSending(true);
		// The message shows in the transcript at once, so it leaves the composer at once too.
		setText("");
		try {
			await sendPrompt(
				value,
				running ? (behavior ?? "followUp") : undefined,
				images.map(({ mimeType, data }) => ({ mimeType, data })),
			);
			attachments.clear();
		} catch {
			// toast shown by the store; put the text back (unless something new was typed) so nothing is lost
			setText((current) => current || text);
		} finally {
			setSending(false);
			ref.current?.focus();
		}
	};

	return (
		<div className="mx-auto w-full max-w-3xl px-6 pb-6">
			{queued.length > 0 && (
				<div className="mb-2 flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2">
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="text-xs font-medium text-muted-foreground">
							{session.queue.steering.length > 0 ? t("composer.queuedSteering") : t("composer.queuedFollowUp")}
						</div>
						{queued.map((q, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: queue entries have no ids
								key={i}
								className="truncate text-sm"
								title={q}
							>
								{q}
							</div>
						))}
					</div>
					<Button
						variant="ghost"
						size="xs"
						title={t("composer.restoreQueue")}
						onClick={async () => {
							const restored = await clearQueue();
							if (restored.length === 0) return;
							setText((current) => [...restored, current.trim()].filter(Boolean).join("\n\n"));
							ref.current?.focus();
						}}
					>
						<Pencil />
						{t("composer.editQueue")}
					</Button>
					<Button variant="ghost" size="icon-xs" title={t("composer.discardQueue")} onClick={() => void clearQueue()}>
						<X />
					</Button>
				</div>
			)}
			<ExtensionWidgets widgets={session.widgets} placement="aboveEditor" className="mb-2" />
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for files; the textarea and attach button are the accessible inputs */}
			<div
				className={cn(
					// One hairline border that darkens slightly on focus — no outer focus ring, which read as a grey
					// halo around the border (ChatGPT / Claude style).
					"relative rounded-2xl border bg-background shadow-[0_2px_8px_-2px_rgb(0_0_0/0.06)] transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-[0_4px_16px_-4px_rgb(0_0_0/0.1)]",
					dragging && "border-primary/50",
				)}
				onDragOver={(e) => {
					if (!e.dataTransfer.types.includes("Files")) return;
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
				}}
				onDrop={(e) => {
					if (e.dataTransfer.files.length === 0) return;
					e.preventDefault();
					setDragging(false);
					void attachments.addFiles([...e.dataTransfer.files]);
				}}
			>
				<AttachmentStrip images={attachments.images} uploading={attachments.uploading} onRemove={attachments.remove} />
				<SlashCompletionMenu
					suggestions={suggestions}
					activeIndex={activeIndex}
					onHover={setActiveIndex}
					onPick={pick}
				/>
				<input
					ref={fileInput}
					type="file"
					multiple
					hidden
					onChange={(e) => {
						void attachments.addFiles([...(e.target.files ?? [])]);
						e.target.value = "";
					}}
				/>
				<textarea
					id="argon-composer"
					onPaste={(e) => {
						const files = [...e.clipboardData.files];
						if (files.length === 0) return;
						e.preventDefault();
						void attachments.addFiles(files);
					}}
					ref={ref}
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						setCursor(e.target.selectionStart);
					}}
					onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
					onKeyDown={(e) => {
						// Never act while an IME composition is active (Chinese/Japanese input).
						if (e.nativeEvent.isComposing) return;
						if (suggestions.length > 0) {
							const current = suggestions[Math.min(activeIndex, suggestions.length - 1)];
							if (!e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
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
								(current.kind !== "argument" || navigated);
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
					placeholder={running ? t("composer.queueFollowUp") : t("composer.placeholder")}
					className="field-sizing-content max-h-64 min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 font-(family-name:--content-font) text-(length:--content-font-size) outline-none placeholder:text-muted-foreground"
					autoFocus
				/>
				<div className="@container/toolbar flex items-center gap-2 px-2 pb-2">
					<div className="flex shrink-0 items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							className="rounded-full text-muted-foreground"
							title={t("composer.attach")}
							onClick={() => fileInput.current?.click()}
						>
							<Paperclip />
						</Button>
						<PermissionPicker session={session} />
						<ToolPresetPicker session={session} />
						<McpPicker mcp={session.mcp} />
					</div>
					{/* Only the model name gives way when space runs out. */}
					<div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
						<ContextMeter session={session} />
						<ModelPicker session={session} />
						<ThinkingPicker session={session} />
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{running && (
							<Button
								variant="outline"
								size="icon-sm"
								className="rounded-full"
								onClick={() => void abort()}
								title={t("composer.stop")}
							>
								<Square className="fill-current" />
							</Button>
						)}
						<Button
							size="icon-sm"
							className={cn("rounded-full", !text.trim() && attachments.images.length === 0 && "opacity-40")}
							disabled={
								!connected || (!text.trim() && attachments.images.length === 0) || sending || attachments.uploading
							}
							onClick={() => void submit()}
							title={t("common.send")}
						>
							<ArrowUp />
						</Button>
					</div>
				</div>
			</div>
			{session.statusEntries.length > 0 && (
				<div className="mt-1.5 truncate px-3 text-xs text-muted-foreground">
					{session.statusEntries.map((s) => s.text).join(" · ")}
				</div>
			)}
			<ExtensionWidgets widgets={session.widgets} placement="belowEditor" className="mt-2" />
		</div>
	);
}
