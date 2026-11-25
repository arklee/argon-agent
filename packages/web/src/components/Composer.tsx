import type { SessionState } from "@argon/shared";
import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

export function Composer({ session }: { session: SessionState }) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const sendPrompt = useApp((s) => s.sendPrompt);
	const abort = useApp((s) => s.abort);
	const ref = useRef<HTMLTextAreaElement>(null);
	const running = session.status === "running";
	const queued = [...session.queue.steering, ...session.queue.followUp];

	const submit = async (behavior?: "steer" | "followUp") => {
		const value = text.trim();
		if (!value || sending) return;
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
			<div className="rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
				<textarea
					ref={ref}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						// Never submit while an IME composition is active (Chinese/Japanese input).
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
