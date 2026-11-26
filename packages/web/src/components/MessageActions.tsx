import type { AssistantBlock } from "@argon/shared";
import { Check, Copy, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function assistantText(blocks: AssistantBlock[]): string {
	return blocks.flatMap((block) => (block.type === "text" && block.text.trim() ? [block.text] : [])).join("\n\n");
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className={cn("text-muted-foreground", className)}
			title={t("common.copy")}
			disabled={!text}
			onClick={() => {
				navigator.clipboard.writeText(text).then(
					() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					},
					() => toast.error(t("chat.copyFailed")),
				);
			}}
		>
			{copied ? <Check /> : <Copy />}
		</Button>
	);
}

export function IconAction({
	title,
	icon: Icon,
	onClick,
	disabled,
}: {
	title: string;
	icon: typeof Pencil;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className="text-muted-foreground"
			title={title}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon />
		</Button>
	);
}

export { Pencil, RotateCcw };

/** Inline editor for re-sending a user message. Enter sends (IME-safe), Escape cancels. */
export function MessageEditor({
	initial,
	onCancel,
	onSubmit,
}: {
	initial: string;
	onCancel: () => void;
	onSubmit: (text: string) => Promise<void>;
}) {
	const { t } = useTranslation();
	const [text, setText] = useState(initial);
	const [sending, setSending] = useState(false);
	const submit = async () => {
		const value = text.trim();
		if (!value || sending) return;
		setSending(true);
		try {
			await onSubmit(value);
		} catch {
			setSending(false); // the store already showed the error; keep editing
		}
	};
	return (
		<div className="w-full max-w-[85%] rounded-2xl border bg-background p-2 shadow-sm">
			<Textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.nativeEvent.isComposing) return;
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void submit();
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
				className="field-sizing-content max-h-64 min-h-16 resize-none border-none text-[15px] shadow-none focus-visible:ring-0"
				autoFocus
			/>
			<div className="mt-1 flex items-center justify-between gap-2">
				<span className="px-1 text-xs text-muted-foreground">{t("chat.editHint")}</span>
				<div className="flex gap-1.5">
					<Button variant="ghost" size="sm" onClick={onCancel} disabled={sending}>
						{t("common.cancel")}
					</Button>
					<Button size="sm" onClick={() => void submit()} disabled={!text.trim() || sending}>
						{t("common.send")}
					</Button>
				</div>
			</div>
		</div>
	);
}
