import type { AssistantBlock, SessionState, TranscriptItem } from "@argon/shared";
import { Brain, ChevronRight, Info, Layers, TerminalSquare } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { ToolCallCard } from "@/components/ToolCallCard";
import { cn } from "@/lib/utils";

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-2">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<Brain className={cn("size-3.5", streaming && "animate-pulse")} />
				{streaming ? "Thinking…" : "Thought"}
				<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
			</button>
			{open && <div className="mt-1.5 border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">{text}</div>}
		</div>
	);
}

function AssistantBlocks({
	blocks,
	streaming,
	tools,
	pendingApprovals,
}: {
	blocks: AssistantBlock[];
	streaming: boolean;
	tools: SessionState["tools"];
	pendingApprovals: ReadonlySet<string>;
}) {
	return (
		<>
			{blocks.map((block, index) => {
				const isLast = index === blocks.length - 1;
				switch (block.type) {
					case "text":
						return block.text ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: content index is the stable identity
							<Markdown key={index} text={block.text} streaming={streaming && isLast} />
						) : null;
					case "thinking":
						return block.redacted || !block.text ? null : (
							// biome-ignore lint/suspicious/noArrayIndexKey: content index is the stable identity
							<ThinkingBlock key={index} text={block.text} streaming={streaming && isLast} />
						);
					case "toolCall":
						return (
							<ToolCallCard
								key={block.toolCallId}
								name={block.name}
								args={block.args}
								argsText={block.argsText}
								tool={tools[block.toolCallId]}
								awaitingApproval={pendingApprovals.has(block.toolCallId)}
							/>
						);
					default:
						return null;
				}
			})}
		</>
	);
}

const NOTICE_ICON = {
	compaction: Layers,
	branchSummary: Layers,
	bash: TerminalSquare,
	custom: Info,
	error: Info,
	info: Info,
} as const;

function Notice({ item }: { item: Extract<TranscriptItem, { kind: "notice" }> }) {
	const [open, setOpen] = useState(false);
	const Icon = NOTICE_ICON[item.variant];
	return (
		<div className="my-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
			<button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
				<Icon className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
				{item.text && <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
			</button>
			{open && item.text && <div className="mt-2 text-xs whitespace-pre-wrap">{item.text}</div>}
		</div>
	);
}

const Item = memo(function Item({
	item,
	tools,
	pendingApprovals,
}: {
	item: TranscriptItem;
	tools: SessionState["tools"];
	pendingApprovals: ReadonlySet<string>;
}) {
	switch (item.kind) {
		case "user":
			return (
				<div className="my-4 flex justify-end">
					<div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap">
						{item.text}
						{item.imageCount > 0 && (
							<span className="ml-2 text-xs text-muted-foreground">+{item.imageCount} image(s)</span>
						)}
					</div>
				</div>
			);
		case "assistant":
			return (
				<div className="my-4">
					<AssistantBlocks
						blocks={item.blocks}
						streaming={item.streaming}
						tools={tools}
						pendingApprovals={pendingApprovals}
					/>
					{item.errorMessage && item.stopReason !== "aborted" && (
						<p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{item.errorMessage}</p>
					)}
					{item.stopReason === "aborted" && <p className="mt-1 text-xs text-muted-foreground">Stopped</p>}
				</div>
			);
		case "notice":
			return <Notice item={item} />;
	}
});

export function Transcript({ session }: { session: SessionState }) {
	const lastItem = session.items.at(-1);
	const pendingApprovals = useMemo(
		() => new Set(session.pendingInteractions.flatMap((i) => (i.kind === "tool_approval" ? [i.toolCallId] : []))),
		[session.pendingInteractions],
	);
	const waitingForFirstToken = session.status === "running" && (lastItem?.kind !== "assistant" || !lastItem.streaming);
	return (
		<div className="mx-auto w-full max-w-3xl px-6 py-6">
			{session.items.map((item) => (
				<Item key={item.id} item={item} tools={session.tools} pendingApprovals={pendingApprovals} />
			))}
			{waitingForFirstToken && session.pendingInteractions.length === 0 && (
				<div className="my-4 flex items-center gap-2 text-sm text-muted-foreground">
					<span className="size-2 animate-pulse rounded-full bg-foreground/60" />
					{session.compacting
						? "Compacting context…"
						: session.retry
							? `Retrying (${session.retry.attempt}/${session.retry.maxAttempts})…`
							: "Working…"}
				</div>
			)}
		</div>
	);
}
