import type { ToolCallState } from "@argon/shared";
import { ChevronRight, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapse } from "@/components/Collapse";
import { callState, isCardCall, ToolCallCard } from "@/components/ToolCallCard";
import { CallIcon, useCountLabels, useToolVerb } from "@/components/ToolSummary";
import { flattenCalls, summarize, type ToolCallBlock } from "@/lib/turns";
import { cn } from "@/lib/utils";
import { displayFor } from "@/tools";

type Part = { type: "single"; call: ToolCallBlock } | { type: "group"; calls: ToolCallBlock[] };

/** Cards stand alone; runs of two or more other calls fold into one group line. */
function partition(calls: readonly ToolCallBlock[], pending: ReadonlySet<string>): Part[] {
	const parts: Part[] = [];
	let run: ToolCallBlock[] = [];
	const flush = () => {
		if (run.length === 1 && run[0]) parts.push({ type: "single", call: run[0] });
		else if (run.length > 1) parts.push({ type: "group", calls: run });
		run = [];
	};
	for (const call of calls) {
		if (isCardCall({ ...call, awaitingApproval: pending.has(call.toolCallId) })) {
			flush();
			parts.push({ type: "single", call });
		} else run.push(call);
	}
	flush();
	return parts;
}

function Call({
	call,
	tools,
	pending,
	nested,
}: {
	call: ToolCallBlock;
	tools: Record<string, ToolCallState>;
	pending: ReadonlySet<string>;
	nested?: boolean;
}) {
	return (
		<ToolCallCard
			toolCallId={call.toolCallId}
			name={call.name}
			display={call.display}
			source={call.source}
			args={call.args}
			argsText={call.argsText}
			tool={tools[call.toolCallId]}
			tools={tools}
			awaitingApproval={pending.has(call.toolCallId)}
			nested={nested}
		/>
	);
}

function ToolGroup({
	calls,
	tools,
	pending,
}: {
	calls: ToolCallBlock[];
	tools: Record<string, ToolCallState>;
	pending: ReadonlySet<string>;
}) {
	const { t } = useTranslation();
	const countLabels = useCountLabels();
	const verb = useToolVerb();
	const [open, setOpen] = useState(false);
	const states = calls.map((call) => callState(tools[call.toolCallId], pending.has(call.toolCallId)));
	const active = calls.findLast((_, i) => states[i] === "running" || states[i] === "pending");
	const failed = states.filter((s) => s === "error" || s === "blocked").length;
	const labels = countLabels(summarize(flattenCalls(calls, tools)));
	const activeDisplay = active && displayFor(active.name, active.args, active.display, active.argsText);
	return (
		<div className="my-0.5">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="group/tool flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground"
			>
				{active ? (
					<CallIcon state="running" />
				) : failed ? (
					<CallIcon state="error" />
				) : (
					<Layers className="size-3.5 shrink-0" />
				)}
				<span className="min-w-0 truncate">{labels.join(" · ")}</span>
				{activeDisplay && (
					<span className="min-w-0 flex-1 truncate font-mono fs-code text-muted-foreground/80">
						{verb(activeDisplay, active.name)} {activeDisplay.summary}
					</span>
				)}
				{!active && failed > 0 && (
					<span className="shrink-0 text-[0.9em] text-destructive">{t("tools.failedCount", { count: failed })}</span>
				)}
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						open ? "rotate-90" : "opacity-0 group-hover/tool:opacity-100",
					)}
				/>
			</button>
			<Collapse open={open} className="mt-0.5 ml-1.5 border-l pl-3.5">
				{calls.map((call) => (
					<Call key={call.toolCallId} call={call} tools={tools} pending={pending} nested />
				))}
			</Collapse>
		</div>
	);
}

/** A run of consecutive tool calls in a turn's process. */
export function ToolRun({
	calls,
	tools,
	pendingApprovals,
}: {
	calls: ToolCallBlock[];
	tools: Record<string, ToolCallState>;
	pendingApprovals: ReadonlySet<string>;
}) {
	return (
		<>
			{partition(calls, pendingApprovals).map((part) =>
				part.type === "single" ? (
					<Call key={part.call.toolCallId} call={part.call} tools={tools} pending={pendingApprovals} />
				) : (
					<ToolGroup key={part.calls[0]?.toolCallId} calls={part.calls} tools={tools} pending={pendingApprovals} />
				),
			)}
		</>
	);
}
