import type { AssistantBlock, BranchPoint, SessionState, ToolCallState, TranscriptItem } from "@argon/shared";
import {
	Brain,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	CircleStop,
	GitFork,
	Info,
	Layers,
	TerminalSquare,
} from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { type CacheSnapshot, Virtualizer, type VirtualizerHandle } from "virtua";
import { SessionImages } from "@/components/Images";
import { Markdown } from "@/components/Markdown";
import { assistantText, CopyButton, IconAction, MessageEditor, Pencil, RotateCcw } from "@/components/MessageActions";
import { ToolCallCard } from "@/components/ToolCallCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	return (
		<div className="my-2">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<Brain className={cn("size-3.5", streaming && "animate-pulse")} />
				{streaming ? t("chat.thinkingInProgress") : t("chat.thought")}
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
								toolCallId={block.toolCallId}
								name={block.name}
								display={block.display}
								source={block.source}
								args={block.args}
								argsText={block.argsText}
								tool={tools[block.toolCallId]}
								tools={tools}
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
		<div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
			<button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
				<Icon className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
				{item.text && <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
			</button>
			{open && item.text && <div className="mt-2 text-xs whitespace-pre-wrap">{item.text}</div>}
		</div>
	);
}

function UserMessage({
	item,
	canEdit,
	branch,
}: {
	branch?: BranchPoint;
	item: Extract<TranscriptItem, { kind: "user" }>;
	canEdit: boolean;
}) {
	const { t } = useTranslation();
	const editMessage = useApp((s) => s.editMessage);
	const sessionId = useApp((s) => s.activeSessionId);
	const switchBranch = useApp((s) => s.switchBranch);
	const forkMessage = useApp((s) => s.forkMessage);
	const [editing, setEditing] = useState(false);
	if (editing) {
		return (
			<div className="flex justify-end">
				<MessageEditor
					initial={item.text}
					onCancel={() => setEditing(false)}
					onSubmit={async (text) => {
						await editMessage(item.id, text);
						setEditing(false);
					}}
				/>
			</div>
		);
	}
	return (
		<div className="group flex flex-col items-end">
			{item.imageCount > 0 && sessionId && (
				<SessionImages
					sessionId={sessionId}
					itemId={item.id}
					count={item.imageCount}
					className="mb-1.5 max-w-[85%] justify-end"
				/>
			)}
			{item.text && <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 whitespace-pre-wrap">{item.text}</div>}
			<div className="mt-1 flex items-center gap-1">
				{branch && sessionId && (
					<div className="flex items-center text-xs tabular-nums text-muted-foreground">
						<IconAction
							title={t("chat.previousBranch")}
							icon={ChevronLeft}
							disabled={!canEdit || branch.index === 0}
							onClick={() => void switchBranch(sessionId, item.id, -1)}
						/>
						{branch.index + 1} / {branch.count}
						<IconAction
							title={t("chat.nextBranch")}
							icon={ChevronRight}
							disabled={!canEdit || branch.index + 1 >= branch.count}
							onClick={() => void switchBranch(sessionId, item.id, 1)}
						/>
					</div>
				)}
				<div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
					<CopyButton text={item.text} />
					{sessionId && (
						<IconAction title={t("chat.fork")} icon={GitFork} onClick={() => void forkMessage(sessionId, item.id)} />
					)}
					<IconAction
						title={canEdit ? t("chat.editAndResend") : t("chat.waitForTurn")}
						icon={Pencil}
						disabled={!canEdit}
						onClick={() => setEditing(true)}
					/>
				</div>
			</div>
		</div>
	);
}

function RequestFailure({ message, retry }: { message?: string; retry?: () => void }) {
	const { t } = useTranslation();
	const detail = <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs">{message}</pre>;
	return (
		<div className="mt-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
			<div className="flex items-center gap-2 font-medium">
				<CircleAlert className="size-4 text-destructive" />
				{t("chat.requestFailed")}
			</div>
			{message &&
				(message.length > 160 || message.split("\n").length > 2 ? (
					<details>
						<summary className="cursor-pointer">{t("chat.errorDetails")}</summary>
						{detail}
					</details>
				) : (
					detail
				))}
			{retry && (
				<Button variant="outline" size="sm" onClick={retry}>
					<RotateCcw />
					{t("chat.retry")}
				</Button>
			)}
		</div>
	);
}

const Item = memo(
	function Item({
		item,
		tools,
		pendingApprovals,
		idle,
		branch,
		regenerateFrom,
	}: {
		item: TranscriptItem;
		tools: SessionState["tools"];
		pendingApprovals: ReadonlySet<string>;
		/** No turn is running, so messages can be edited. */
		idle: boolean;
		branch?: BranchPoint;
		/** For the last reply: the user item to resend to regenerate it. */
		regenerateFrom?: Extract<TranscriptItem, { kind: "user" }>;
	}) {
		const { t } = useTranslation();
		const editMessage = useApp((s) => s.editMessage);
		const regenerate = regenerateFrom
			? () => void editMessage(regenerateFrom.id, regenerateFrom.text).catch(() => undefined)
			: undefined;
		const failed =
			item.kind === "assistant" && item.stopReason !== "aborted" && (item.errorMessage || item.stopReason === "error");
		switch (item.kind) {
			case "user":
				return <UserMessage item={item} canEdit={idle} branch={branch} />;
			case "assistant":
				return (
					<div className="group">
						<AssistantBlocks
							blocks={item.blocks}
							streaming={item.streaming}
							tools={tools}
							pendingApprovals={pendingApprovals}
						/>
						{failed && <RequestFailure message={item.errorMessage} retry={regenerate} />}
						{item.stopReason === "aborted" && (
							<span className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
								<CircleStop className="size-3" />
								{t("chat.stopped")}
							</span>
						)}
						{/* Steps that only call tools have nothing to copy: no action row, so tool runs stay compact. */}
						{!item.streaming && (assistantText(item.blocks).trim() !== "" || (regenerate && !failed)) && (
							<div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
								<CopyButton text={assistantText(item.blocks)} />
								{regenerate && !failed && (
									<IconAction title={t("chat.regenerate")} icon={RotateCcw} onClick={regenerate} />
								)}
							</div>
						)}
					</div>
				);
			case "notice":
				return <Notice item={item} />;
		}
	},
	(prev, next) =>
		prev.item === next.item &&
		prev.idle === next.idle &&
		prev.branch?.index === next.branch?.index &&
		prev.branch?.count === next.branch?.count &&
		prev.regenerateFrom === next.regenerateFrom &&
		prev.pendingApprovals === next.pendingApprovals &&
		sameTools(prev.tools, next.tools),
);

/** The row's tools (its calls and their nested calls) are unchanged. */
function sameTools(a: SessionState["tools"], b: SessionState["tools"]): boolean {
	const keys = Object.keys(b);
	return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

const rowCaches = new Map<string, CacheSnapshot>();

export function Transcript({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const nestedByParent = useMemo(() => {
		const byParent = new Map<string, ToolCallState[]>();
		for (const tool of Object.values(session.tools)) {
			if (!tool.parentToolCallId) continue;
			const list = byParent.get(tool.parentToolCallId);
			if (list) list.push(tool);
			else byParent.set(tool.parentToolCallId, [tool]);
		}
		return byParent;
	}, [session.tools]);
	const branches = useMemo(() => {
		const points = new Map<string, BranchPoint>();
		if (session.userBranches?.length) {
			let ordinal = 0;
			for (const item of session.items) {
				if (item.kind !== "user") continue;
				const point = session.userBranches[ordinal++];
				if (point) points.set(item.id, point);
			}
		}
		return points;
	}, [session.items, session.userBranches]);
	const lastItem = session.items.at(-1);
	const pendingApprovals = useMemo(
		() => new Set(session.pendingInteractions.flatMap((i) => (i.kind === "tool_approval" ? [i.toolCallId] : []))),
		[session.pendingInteractions],
	);
	// Manual compaction runs while idle, so it gets the indicator too.
	const idle = session.status === "idle" && !session.compacting;
	// The last reply can be regenerated by resending the user message before it.
	const regenerate = useMemo(() => {
		if (!idle) return undefined;
		const lastAssistant = session.items.findLastIndex((i) => i.kind === "assistant");
		const lastUser = session.items.findLastIndex((i) => i.kind === "user");
		const user = session.items[lastUser];
		const assistant = session.items[lastAssistant];
		if (lastAssistant < lastUser || user?.kind !== "user" || !assistant) return undefined;
		return { assistantId: assistant.id, user };
	}, [idle, session.items]);
	const waitingForFirstToken =
		session.compacting || (session.status === "running" && (lastItem?.kind !== "assistant" || !lastItem.streaming));
	const showStatus = !!session.retry || (waitingForFirstToken && session.pendingInteractions.length === 0);
	const count = session.items.length + Number(showStatus);
	const list = useRef<VirtualizerHandle>(null);
	const pinned = useRef(true);
	const cache = useMemo(() => rowCaches.get(session.sessionId), [session.sessionId]);
	useLayoutEffect(() => {
		const handle = list.current;
		return () => {
			if (!handle) return;
			rowCaches.delete(session.sessionId);
			rowCaches.set(session.sessionId, handle.cache);
			if (rowCaches.size > 20) {
				const oldest = rowCaches.keys().next().value;
				if (oldest !== undefined) rowCaches.delete(oldest);
			}
		};
	}, [session.sessionId]);
	const follow = useCallback(() => {
		if (pinned.current && count) list.current?.scrollToIndex(count - 1, { align: "end" });
	}, [count]);
	useLayoutEffect(follow, [follow]);
	return (
		<section
			aria-label={t("chat.transcript")}
			onKeyDown={(event) => {
				const target = event.target;
				if (target instanceof HTMLElement && (target.closest("input, textarea") || target.isContentEditable)) return;
				if (event.key !== "Home" && event.key !== "End") return;
				event.preventDefault();
				pinned.current = event.key === "End";
				if (count)
					list.current?.scrollToIndex(event.key === "Home" ? 0 : count - 1, {
						align: event.key === "Home" ? "start" : "end",
					});
			}}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users can focus and scroll the transcript.
			tabIndex={0}
			className="argon-chat min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
		>
			<Virtualizer
				cache={cache}
				data={{ length: count }}
				ref={list}
				bufferSize={1000}
				onResize={follow}
				onScroll={(offset: number) => {
					const handle = list.current;
					if (handle) pinned.current = handle.scrollSize - offset - handle.viewportSize < 80;
				}}
			>
				{(_: unknown, index: number) => {
					const item = session.items[index];
					const tools: SessionState["tools"] = Object.create(null);
					if (item?.kind === "assistant") {
						const add = (toolCallId: string) => {
							const tool = session.tools[toolCallId];
							if (tool) tools[toolCallId] = tool;
							for (const child of nestedByParent.get(toolCallId) ?? []) add(child.toolCallId);
						};
						for (const block of item.blocks) if (block.type === "toolCall") add(block.toolCallId);
					}
					// Adjacent message margins used to collapse. Include the shared gap in one measured row.
					const previous = session.items[index - 1];
					const smallGap = item?.kind === "notice" && (index === 0 || previous?.kind === "notice");
					// Steps of one turn (tool calls, then the answer) read as one block.
					const sameTurn = item?.kind === "assistant" && previous?.kind === "assistant";
					return (
						<div
							key={item ? `item-${item.id}` : "status"}
							className={cn(
								"mx-auto flow-root w-full max-w-3xl px-6",
								sameTurn ? "pt-0.5" : smallGap ? "pt-3" : "pt-4",
								index === 0 && (smallGap ? "pt-9" : "pt-10"),
								index === count - 1 && (item?.kind === "notice" ? "pb-9" : "pb-10"),
							)}
						>
							{item ? (
								<Item
									item={item}
									tools={tools}
									pendingApprovals={pendingApprovals}
									idle={idle}
									branch={branches.get(item.id)}
									regenerateFrom={item.id === regenerate?.assistantId ? regenerate.user : undefined}
								/>
							) : session.retry ? (
								<div
									role="status"
									className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
								>
									<Trans
										t={t}
										i18nKey="chat.retryStatus"
										shouldUnescape
										tOptions={{ interpolation: { escapeValue: true } }}
										values={{
											attempt: session.retry.attempt,
											max: session.retry.maxAttempts,
											error: session.retry.errorMessage.split("\n")[0],
										}}
										components={{ emphasis: <strong /> }}
									/>
								</div>
							) : (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<span className="size-2 animate-pulse rounded-full bg-foreground/60" />
									{session.compacting ? t("chat.compacting") : (session.workingMessage ?? t("chat.working"))}
								</div>
							)}
						</div>
					);
				}}
			</Virtualizer>
		</section>
	);
}
