import type { ToolCallState } from "@argon/shared";
import { Ban, Check, ChevronRight, CircleDashed, Hand, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffStat, DiffView } from "@/components/DiffView";
import { SessionImages } from "@/components/Images";
import { formatDuration, summarizeToolArgs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

function StatusIcon({ status }: { status: ToolCallState["status"] }) {
	switch (status) {
		case "pending":
			return <CircleDashed className="size-3.5 text-muted-foreground" />;
		case "running":
			return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
		case "done":
			return <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
		case "error":
			return <TriangleAlert className="size-3.5 text-destructive" />;
		case "blocked":
			return <Ban className="size-3.5 text-amber-600 dark:text-amber-400" />;
	}
}

export function ToolCallCard({
	name,
	args,
	argsText,
	tool,
	awaitingApproval,
}: {
	name: string;
	args: unknown;
	argsText?: string;
	tool: ToolCallState | undefined;
	awaitingApproval?: boolean;
}) {
	const { t } = useTranslation();
	const [openState, setOpen] = useState<boolean>();
	const sessionId = useApp((s) => s.activeSessionId);
	const status = tool?.status ?? "pending";
	const diff = tool?.diff;
	// Small diffs start expanded, like a code review; everything else starts collapsed.
	const open = openState ?? (diff !== undefined && diff.split("\n").length <= 40 && status !== "blocked");
	const effectiveArgs = tool?.args ?? args;
	const summary = summarizeToolArgs(name, effectiveArgs) || (argsText ? argsText.slice(0, 120) : "");
	const hasDetails = Boolean(tool?.output) || effectiveArgs !== undefined;

	return (
		<div className="my-2 overflow-hidden rounded-lg border bg-card text-sm">
			<button
				type="button"
				onClick={() => hasDetails && setOpen(!open)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
			>
				{awaitingApproval ? (
					<Hand className="size-3.5 text-amber-600 dark:text-amber-400" />
				) : (
					<StatusIcon status={status} />
				)}
				<span className="font-medium">{name}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{summary}</span>
				{diff && <DiffStat diff={diff} />}
				{awaitingApproval && (
					<span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{t("tools.waitingApproval")}</span>
				)}
				{tool?.durationMs !== undefined && (
					<span className="shrink-0 text-xs text-muted-foreground">{formatDuration(tool.durationMs)}</span>
				)}
				<ChevronRight
					className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
				/>
			</button>
			{open && (
				<div className="space-y-2 border-t bg-muted/30 px-3 py-2">
					{diff ? (
						<DiffView
							diff={diff}
							className={cn("max-h-96", status !== "done" && status !== "running" && "opacity-60")}
						/>
					) : (
						<pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">
							{JSON.stringify(effectiveArgs, null, 2)}
						</pre>
					)}
					{tool?.output && (!diff || status !== "done") && (
						<pre
							className={cn(
								"max-h-80 overflow-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all",
								(status === "error" || status === "blocked") && "text-destructive",
							)}
						>
							{tool.output}
						</pre>
					)}
					{tool?.imageCount && sessionId && status !== "running" ? (
						<SessionImages sessionId={sessionId} toolCallId={tool.toolCallId} count={tool.imageCount} />
					) : null}
				</div>
			)}
		</div>
	);
}
