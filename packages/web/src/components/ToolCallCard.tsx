import type { ToolCallState, ToolDisplay } from "@argon/shared";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapse } from "@/components/Collapse";
import { DiffStat } from "@/components/DiffView";
import { OpenFileButton } from "@/components/FileLink";
import { CallIcon, type CallState, useCountLabels, useToolVerb } from "@/components/ToolSummary";
import { formatDuration } from "@/lib/format";
import { flattenCalls, summarize } from "@/lib/turns";
import { cn } from "@/lib/utils";
import { childToolsOf, displayFor, rendererFor, type ToolView } from "@/tools";

export interface ToolCallProps {
	toolCallId: string;
	name: string;
	args: unknown;
	argsText?: string;
	display?: ToolDisplay;
	source?: string;
	tool: ToolCallState | undefined;
	/** The row's tool states, including nested calls (looked up by parent id). */
	tools?: Record<string, ToolCallState>;
	awaitingApproval?: boolean;
	/** Rendered inside another call or a group. */
	nested?: boolean;
}

function buildView(props: ToolCallProps, renderChildren: () => React.ReactNode, children: ToolCallState[]): ToolView {
	const args = props.tool?.args ?? props.args;
	return {
		toolCallId: props.toolCallId,
		name: props.name,
		source: props.source,
		display: displayFor(props.name, args, props.display, props.argsText),
		args,
		tool: props.tool,
		children,
		renderChildren,
	};
}

/**
 * Whether a call is shown as a card (its own frame, outside tool groups): file changes, calls waiting
 * for approval, and tools whose renderer shows something inline (images, search results).
 */
export function isCardCall(props: Pick<ToolCallProps, "name" | "source" | "display" | "awaitingApproval">): boolean {
	if (props.awaitingApproval || props.display?.kind === "file_change") return true;
	const view = {
		name: props.name,
		source: props.source,
		display: props.display ?? { kind: "generic", title: props.name },
	} as ToolView;
	return Boolean(rendererFor(view).Inline);
}

export function callState(tool: ToolCallState | undefined, awaitingApproval?: boolean): CallState {
	return awaitingApproval ? "approval" : (tool?.status ?? "pending");
}

export function ToolCallCard(props: ToolCallProps) {
	const { t } = useTranslation();
	const verb = useToolVerb();
	const countLabels = useCountLabels();
	const { toolCallId, tool, tools, awaitingApproval, nested = false } = props;
	const [openState, setOpen] = useState<boolean>();
	const status = tool?.status ?? "pending";
	const diffs = tool?.diffs?.length ? tool.diffs : undefined;
	const children = tools ? childToolsOf(tools, toolCallId) : [];
	const renderChildren = () =>
		children.length > 0 ? (
			<div className="space-y-0.5">
				{children.map((child) => (
					<ToolCallCard
						key={child.toolCallId}
						toolCallId={child.toolCallId}
						name={child.name}
						args={child.args}
						display={child.display}
						source={child.source}
						tool={child}
						tools={tools}
						nested
					/>
				))}
			</div>
		) : null;
	const view = buildView(props, renderChildren, children);
	const renderer = rendererFor(view);
	const card = isCardCall({ ...props, display: view.display });
	// Small diffs start expanded, like a code review; everything else starts collapsed.
	const diffLines = diffs?.reduce((sum, file) => sum + file.diff.split("\n").length, 0);
	const open = openState ?? (card && diffLines !== undefined && diffLines <= 40 && status !== "blocked");
	const summary =
		children.length > 0 && view.display.kind === "script"
			? countLabels(summarize(flattenCalls(children, tools ?? {}))).join(" · ")
			: (renderer.summary?.(view) ?? view.display.summary ?? "");
	const hasDetails = Boolean(tool?.output) || view.args !== undefined || children.length > 0;
	const state = callState(tool, awaitingApproval);

	const fileTarget = primaryFile(view.display);
	const toggle = (
		<button
			type="button"
			onClick={() => hasDetails && setOpen(!open)}
			className={cn(
				"group/tool flex w-full min-w-0 items-center gap-2 text-left leading-normal",
				card ? "px-3 py-1.5 hover:bg-muted/50" : "rounded-md py-0.5 text-muted-foreground hover:text-foreground",
			)}
		>
			<CallIcon state={state} kind={view.display.kind} />
			<span className={cn("shrink-0", card && "font-medium")}>{verb(view.display, props.name)}</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					view.display.kind === "script" && children.length > 0 ? "" : "font-mono fs-code",
					"text-muted-foreground",
				)}
			>
				{summary}
			</span>
			{diffs && <DiffStat diffs={diffs} />}
			{awaitingApproval && (
				<span className="shrink-0 text-[0.9em] text-amber-600 dark:text-amber-400">{t("tools.waitingApproval")}</span>
			)}
			{tool?.durationMs !== undefined && status !== "running" && (
				<span className="shrink-0 text-[0.9em] tabular-nums text-muted-foreground/70">
					{formatDuration(tool.durationMs)}
				</span>
			)}
			{hasDetails && (
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
						!card && !open && "opacity-0 group-hover/tool:opacity-100",
					)}
				/>
			)}
		</button>
	);
	// The file button sits beside the toggle (a button cannot nest in a button).
	const header = fileTarget ? (
		<div className="group/file flex min-w-0 items-center">
			{toggle}
			<OpenFileButton
				target={fileTarget}
				diffs={diffs}
				className={cn("opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100", card ? "mr-1.5" : "ml-1")}
			/>
		</div>
	) : (
		toggle
	);
	const body = (
		<Collapse open={open}>
			<div
				className={cn(
					"space-y-2",
					card ? "border-t bg-muted/30 px-3 py-2" : "mt-1 mb-1.5 ml-5.5 rounded-lg border bg-muted/30 px-3 py-2",
				)}
			>
				<renderer.Body view={view} />
				{!renderer.placesChildren && renderChildren()}
			</div>
		</Collapse>
	);

	if (!card)
		return (
			<div className={cn(!nested && "my-0.5")}>
				{header}
				{body}
			</div>
		);
	return (
		<div className={cn("overflow-hidden rounded-lg border", nested ? "my-1 bg-background" : "my-1.5 bg-card")}>
			{header}
			{renderer.Inline && <renderer.Inline view={view} />}
			{body}
		</div>
	);
}

/** The one file a read or single-file change is about. */
function primaryFile(display: ToolDisplay): string | undefined {
	if (display.kind === "file_read") return display.path;
	if (display.kind === "file_change" && display.files.length === 1) {
		const file = display.files[0];
		return file?.op === "delete" ? undefined : (file?.movePath ?? file?.path);
	}
	return undefined;
}
