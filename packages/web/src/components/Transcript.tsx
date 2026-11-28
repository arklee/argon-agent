import type { AssistantBlock, BranchPoint, FileDiff, SessionState, ToolCallState, TranscriptItem } from "@argon/shared";
import {
	Brain,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	CircleStop,
	Clock,
	FileSearch,
	GitFork,
	Info,
	Layers,
	Loader2,
	TerminalSquare,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { type CacheSnapshot, Virtualizer, type VirtualizerHandle } from "virtua";
import { DiffStat, DiffView, diffsStats } from "@/components/DiffView";
import { OpenFileButton, openFileInPanel } from "@/components/FileLink";
import { SessionImages } from "@/components/Images";
import { Markdown } from "@/components/Markdown";
import { assistantText, CopyButton, IconAction, MessageEditor, Pencil, RotateCcw } from "@/components/MessageActions";
import { ToolRun } from "@/components/ToolRun";
import { useCountLabels } from "@/components/ToolSummary";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { basename, formatElapsed, formatNumber } from "@/lib/format";
import {
	defaultOpen,
	flattenCalls,
	type ProcessSegment,
	summarize,
	type ToolCallBlock,
	type TranscriptRow,
	type Turn,
	transcriptRows,
	turnCalls,
	turnChanges,
	turnTiming,
} from "@/lib/turns";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

type Tools = SessionState["tools"];

/** Re-render every `ms` while `active`, for live timers. */
function useTicker(active: boolean, ms = 1000): number {
	const [now, tick] = useReducer(() => Date.now(), Date.now());
	useEffect(() => {
		if (!active) return;
		const id = window.setInterval(tick, ms);
		return () => window.clearInterval(id);
	}, [active, ms]);
	return now;
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	return (
		<div className="my-0.5">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="group/think flex items-center gap-2 py-0.5 text-muted-foreground hover:text-foreground"
			>
				<Brain className={cn("size-3.5", streaming && "animate-pulse")} />
				{streaming ? t("chat.thinkingInProgress") : t("chat.thought")}
				<ChevronRight
					className={cn(
						"size-3.5 transition-transform",
						open ? "rotate-90" : "opacity-0 group-hover/think:opacity-100",
					)}
				/>
			</button>
			{open && (
				<div className="mt-1 mb-1.5 ml-1.5 border-l pl-3.5 text-[0.95em] whitespace-pre-wrap text-muted-foreground">
					{text}
				</div>
			)}
		</div>
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
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const Icon = NOTICE_ICON[item.variant];
	// Compaction titles are Argon's own; other notices carry text from pi or extensions.
	const compaction = item.variant === "compaction";
	const title = compaction ? t(item.remoteCheckpoint ? "chat.compactedRemote" : "chat.compacted") : item.title;
	const text = compaction && item.remoteCheckpoint ? t("chat.compactedRemoteDetail") : item.text;
	return (
		<div className="rounded-lg border border-dashed px-3 py-2 text-[0.93em] text-muted-foreground">
			<button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
				<Icon className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
				{text && <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
			</button>
			{open && text && <div className="mt-2 text-[0.93em] whitespace-pre-wrap">{text}</div>}
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
			{item.text && <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 whitespace-pre-wrap">{item.text}</div>}
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
	const detail = <pre className="mt-1 font-mono fs-code whitespace-pre-wrap break-all">{message}</pre>;
	return (
		<div className="mt-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[0.93em]">
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

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/** The fold line above a turn's process: live timer while working, a summary afterwards. */
function TurnHeader({
	turn,
	open,
	tools,
	onToggle,
}: {
	turn: Turn;
	open: boolean;
	tools: Tools;
	onToggle: () => void;
}) {
	const { t } = useTranslation();
	const countLabels = useCountLabels();
	const now = useTicker(turn.live);
	const timing = turnTiming(turn);
	const calls = turnCalls(turn);
	const labels = countLabels(summarize(flattenCalls(calls, tools)));
	let title: string;
	if (turn.live) title = t("chat.workingFor", { duration: formatElapsed(now - timing.startedAt) });
	else if (calls.length === 0) title = t("chat.thought");
	else if (timing.endedAt) title = t("chat.workedFor", { duration: formatElapsed(timing.endedAt - timing.startedAt) });
	else title = t("chat.worked");
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			className="group/head flex max-w-full min-w-0 items-center gap-2 py-0.5 text-left text-muted-foreground hover:text-foreground"
		>
			{turn.live ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : null}
			<span className="shrink-0">{title}</span>
			{!open && labels.length > 0 && (
				<span className="min-w-0 truncate text-muted-foreground/70 group-hover/head:text-muted-foreground">
					· {labels.join(" · ")}
				</span>
			)}
			<ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
		</button>
	);
}

function Segment({
	segment,
	tools,
	pendingApprovals,
}: {
	segment: ProcessSegment;
	tools: Tools;
	pendingApprovals: ReadonlySet<string>;
}) {
	switch (segment.type) {
		case "text":
			// Commentary between steps reads quieter than the answer.
			return (
				<div className="text-muted-foreground">
					<Markdown text={segment.text} streaming={segment.streaming} />
				</div>
			);
		case "thinking":
			return <ThinkingBlock text={segment.text} streaming={segment.streaming} />;
		case "tools":
			return <ToolRun calls={segment.calls} tools={tools} pendingApprovals={pendingApprovals} />;
	}
}

const SegmentRow = memo(
	Segment,
	(prev, next) =>
		prev.pendingApprovals === next.pendingApprovals &&
		sameSegment(prev.segment, next.segment) &&
		sameTools(prev.tools, next.tools),
);

function sameSegment(a: ProcessSegment, b: ProcessSegment): boolean {
	if (a.type === "tools" && b.type === "tools")
		return a.calls.length === b.calls.length && a.calls.every((call, i) => call === b.calls[i]);
	if (a.type === "tools" || b.type === "tools") return false;
	return a.type === b.type && a.text === b.text && a.streaming === b.streaming;
}

/** The row's tools (its calls and their nested calls) are unchanged. */
function sameTools(a: Tools, b: Tools): boolean {
	const keys = Object.keys(b);
	return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

/** Files changed in the turn, each opening its combined diff. */
function ChangesButton({ changes }: { changes: FileDiff[] }) {
	const { t } = useTranslation();
	const [file, setFile] = useState<string>();
	const [open, setOpen] = useState(false);
	const shown = changes.find((change) => change.path === file);
	const openFile = (change: FileDiff) => {
		setOpen(false);
		setFile(undefined);
		openFileInPanel(change.path, { diffs: [change] });
	};
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setFile(undefined);
			}}
		>
			<PopoverTrigger className="flex items-center gap-1.5 rounded-md px-1 hover:bg-muted hover:text-foreground">
				{t("chat.filesChanged", { count: changes.length })}
				<DiffStat diffs={changes} />
				<ChevronRight className="size-3" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(36rem,90vw)] p-1.5">
				{shown ? (
					<div className="space-y-1.5">
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => setFile(undefined)}
								className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
							>
								<ChevronLeft className="size-3.5" />
								<span className="min-w-0 flex-1 truncate font-mono fs-code" title={shown.path}>
									{shown.path}
								</span>
								<DiffStat diffs={[shown]} />
							</button>
							<Button variant="ghost" size="xs" onClick={() => openFile(shown)}>
								<FileSearch />
								{t("files.open")}
							</Button>
						</div>
						<DiffView diff={shown.diff} className="max-h-96" />
					</div>
				) : (
					<ul className="max-h-80 overflow-auto">
						{changes.map((change) => (
							<li key={change.path} className="group/change flex items-center">
								<button
									type="button"
									onClick={() => setFile(change.path)}
									className="flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
									title={change.path}
								>
									<span className="shrink-0 font-mono fs-code">{basename(change.path)}</span>
									<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{change.path}</span>
									<DiffStat diffs={[change]} />
								</button>
								<OpenFileButton
									target={change.path}
									diffs={[change]}
									onOpen={() => {
										setOpen(false);
										setFile(undefined);
									}}
									className="opacity-0 group-hover/change:opacity-100 focus-visible:opacity-100"
								/>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Time, output speed and file changes of a finished turn. */
function TurnMeta({ turn, tools }: { turn: Turn; tools: Tools }) {
	const { t } = useTranslation();
	const timing = turnTiming(turn);
	const changes = useMemo(() => turnChanges(turn, tools), [turn, tools]);
	const last = turn.items.at(-1);
	const parts: React.ReactNode[] = [];
	if (timing.endedAt)
		parts.push(
			<span key="time" className="flex items-center gap-1">
				<Clock className="size-3" />
				{formatElapsed(timing.endedAt - timing.startedAt)}
			</span>,
		);
	if (timing.tokensPerSecond)
		parts.push(
			<span key="speed">
				{t("chat.tokensPerSecond", {
					value: formatNumber(timing.tokensPerSecond, { maximumFractionDigits: timing.tokensPerSecond < 10 ? 1 : 0 }),
				})}
			</span>,
		);
	if (changes.length && diffsStats(changes).added + diffsStats(changes).removed > 0)
		parts.push(<ChangesButton key="changes" changes={changes} />);
	if (!parts.length) return null;
	return (
		<div
			className="ml-auto flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:opacity-50 [&>*+*]:before:content-['·']"
			title={last?.model ? [last.provider, last.model].filter(Boolean).join(" / ") : undefined}
		>
			{parts}
		</div>
	);
}

function TurnAnswer({
	turn,
	tools,
	regenerate,
	isLast,
}: {
	turn: Turn;
	tools: Tools;
	regenerate?: () => void;
	isLast: boolean;
}) {
	const { t } = useTranslation();
	const last = turn.items.at(-1);
	if (!last) return null;
	const answerBlocks: AssistantBlock[] = turn.answer?.blocks ?? [];
	const failed = last.stopReason !== "aborted" && (last.errorMessage || last.stopReason === "error");
	const text = assistantText(answerBlocks);
	const settled = !turn.live;
	const actions = settled && (text.trim() !== "" || (regenerate && !failed));
	return (
		<div className="group">
			{answerBlocks.map((block, index) =>
				block.type === "text" && block.text ? (
					<Markdown
						// biome-ignore lint/suspicious/noArrayIndexKey: content index is the stable identity
						key={index}
						text={block.text}
						streaming={last.streaming && index === answerBlocks.length - 1}
					/>
				) : null,
			)}
			{failed && <RequestFailure message={last.errorMessage} retry={regenerate} />}
			{last.stopReason === "aborted" && (
				<span className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
					<CircleStop className="size-3" />
					{t("chat.stopped")}
				</span>
			)}
			{settled && (
				<div className="mt-1 flex min-h-7 items-center gap-0.5">
					{actions && (
						<div
							className={cn(
								"flex gap-0.5 transition-opacity",
								!isLast && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
							)}
						>
							{text.trim() !== "" && <CopyButton text={text} />}
							{regenerate && !failed && (
								<IconAction title={t("chat.regenerate")} icon={RotateCcw} onClick={regenerate} />
							)}
						</div>
					)}
					<TurnMeta turn={turn} tools={tools} />
				</div>
			)}
		</div>
	);
}

function sameAnswer(a: Turn, b: Turn): boolean {
	return a.live === b.live && a.items.length === b.items.length && a.items.every((item, i) => item === b.items[i]);
}

const AnswerRow = memo(
	TurnAnswer,
	(prev, next) =>
		prev.isLast === next.isLast &&
		prev.regenerate === next.regenerate &&
		sameAnswer(prev.turn, next.turn) &&
		sameTools(prev.tools, next.tools),
);

const ItemRow = memo(function ItemRow({
	item,
	idle,
	branch,
}: {
	item: TranscriptItem;
	idle: boolean;
	branch?: BranchPoint;
}) {
	if (item.kind === "user") return <UserMessage item={item} canEdit={idle} branch={branch} />;
	if (item.kind === "notice") return <Notice item={item} />;
	return null;
});

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

const rowCaches = new Map<string, CacheSnapshot>();
/** The user's open/closed choice per turn, by session; kept while switching sessions. */
const turnOpenState = new Map<string, Map<string, boolean>>();

export function Transcript({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const editMessage = useApp((s) => s.editMessage);
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
	const running = session.status === "running";

	const [openVersion, bumpOpen] = useReducer((n: number) => n + 1, 0);
	const openChoices = useMemo(() => {
		let map = turnOpenState.get(session.sessionId);
		if (!map) {
			map = new Map();
			turnOpenState.set(session.sessionId, map);
		}
		return map;
	}, [session.sessionId]);
	const rows = useMemo(() => {
		void openVersion;
		return transcriptRows(session.items, running, (turn) => {
			// A call waiting for approval is never folded away.
			if (turnCalls(turn).some((call) => pendingApprovals.has(call.toolCallId))) return true;
			return openChoices.get(turn.id) ?? defaultOpen(turn);
		});
	}, [session.items, running, pendingApprovals, openChoices, openVersion]);
	const toggleTurn = useCallback(
		(turn: Turn, open: boolean) => {
			openChoices.set(turn.id, !open);
			bumpOpen();
		},
		[openChoices],
	);

	// The last reply can be regenerated by resending the user message before it.
	const regenerate = useMemo(() => {
		if (!idle) return undefined;
		const lastAssistant = session.items.findLastIndex((i) => i.kind === "assistant");
		const lastUser = session.items.findLastIndex((i) => i.kind === "user");
		const user = session.items[lastUser];
		if (lastAssistant < lastUser || user?.kind !== "user") return undefined;
		return () => void editMessage(user.id, user.text).catch(() => undefined);
	}, [idle, session.items, editMessage]);
	const lastAnswerKey = rows.findLast((row) => row.kind === "answer")?.key;

	/** Tools a row shows (its calls and their nested calls), so rows re-render only for their own tools. */
	const rowTools = (calls: readonly ToolCallBlock[]): Tools => {
		const tools: Tools = Object.create(null);
		const add = (toolCallId: string) => {
			const tool = session.tools[toolCallId];
			if (tool) tools[toolCallId] = tool;
			for (const child of nestedByParent.get(toolCallId) ?? []) add(child.toolCallId);
		};
		for (const call of calls) add(call.toolCallId);
		return tools;
	};

	const waitingForFirstToken =
		session.compacting || (running && (lastItem?.kind !== "assistant" || !lastItem.streaming));
	const showStatus = !!session.retry || (waitingForFirstToken && session.pendingInteractions.length === 0);
	const count = rows.length + Number(showStatus);
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

	const renderRow = (row: TranscriptRow) => {
		switch (row.kind) {
			case "item":
				return <ItemRow item={row.item} idle={idle} branch={branches.get(row.item.id)} />;
			case "turnHeader":
				return (
					<TurnHeader
						turn={row.turn}
						open={row.open}
						tools={rowTools(turnCalls(row.turn))}
						onToggle={() => toggleTurn(row.turn, row.open)}
					/>
				);
			case "segment":
				return (
					<SegmentRow
						segment={row.segment}
						tools={row.segment.type === "tools" ? rowTools(row.segment.calls) : {}}
						pendingApprovals={pendingApprovals}
					/>
				);
			case "answer":
				return (
					<AnswerRow
						turn={row.turn}
						tools={rowTools(turnCalls(row.turn))}
						isLast={row.key === lastAnswerKey}
						regenerate={row.key === lastAnswerKey ? regenerate : undefined}
					/>
				);
		}
	};

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
					const row = rows[index];
					const previous = rows[index - 1];
					// Rows of one turn (header, steps, answer) read as one block; messages and notices get room.
					const inTurn = row && row.kind !== "item" && previous && previous.kind !== "item";
					const notice = row?.kind === "item" && row.item.kind === "notice";
					const smallGap = notice && (index === 0 || (previous?.kind === "item" && previous.item.kind === "notice"));
					const answerAfterSteps = row?.kind === "answer" && previous?.kind !== "item" && previous !== undefined;
					return (
						<div
							key={row ? row.key : "status"}
							className={cn(
								"mx-auto flow-root w-full max-w-3xl px-6",
								inTurn ? (answerAfterSteps ? "pt-2" : "pt-0") : smallGap ? "pt-3" : "pt-4",
								index === 0 && (smallGap ? "pt-9" : "pt-10"),
								index === count - 1 && (notice ? "pb-9" : "pb-10"),
							)}
						>
							{row?.kind === "segment" ? (
								<div className="ml-1.5 border-l pl-3.5">{renderRow(row)}</div>
							) : row ? (
								renderRow(row)
							) : session.retry ? (
								<div
									role="status"
									className="rounded-lg bg-amber-500/15 px-3 py-2 text-[0.93em] text-amber-800 dark:text-amber-300"
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
								<div className="flex items-center gap-2 pt-1 text-muted-foreground">
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
