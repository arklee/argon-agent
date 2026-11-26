import type { ToolCallState, ToolDisplay } from "@argon/shared";
import { Ban, Check, ChevronRight, CircleDashed, Hand, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/DiffView";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { displayFor, rendererFor, type ToolView } from "@/tools";

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
	toolCallId,
	name,
	args,
	argsText,
	display,
	source,
	tool,
	awaitingApproval,
}: {
	toolCallId: string;
	name: string;
	args: unknown;
	argsText?: string;
	display?: ToolDisplay;
	source?: string;
	tool: ToolCallState | undefined;
	awaitingApproval?: boolean;
}) {
	const { t } = useTranslation();
	const [openState, setOpen] = useState<boolean>();
	const status = tool?.status ?? "pending";
	const diff = tool?.diff;
	// Small diffs start expanded, like a code review; everything else starts collapsed.
	const open = openState ?? (diff !== undefined && diff.split("\n").length <= 40 && status !== "blocked");
	const effectiveArgs = tool?.args ?? args;
	const view: ToolView = {
		toolCallId,
		name,
		source,
		display: displayFor(name, effectiveArgs, display, argsText),
		args: effectiveArgs,
		tool,
	};
	const renderer = rendererFor(view);
	const summary = renderer.summary?.(view) ?? view.display.summary ?? "";
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
				<span className="font-medium">{view.display.title || name}</span>
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
					<renderer.Body view={view} />
				</div>
			)}
		</div>
	);
}
