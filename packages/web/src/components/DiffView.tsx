import type { FileDiff } from "@argon/shared";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffLine {
	kind: "add" | "del" | "ctx" | "gap";
	lineNumber: string;
	text: string;
}

/** Parse pi's display diff: "+12 text", "-12 text", " 12 text"; anything else is a separator. */
function parse(diff: string): DiffLine[] {
	return diff.split("\n").map((raw) => {
		const match = /^([+\- ])(\s*\d+) ?(.*)$/.exec(raw);
		if (!match) return { kind: "gap", lineNumber: "", text: raw.trim() || "…" };
		const sign = match[1];
		return {
			kind: sign === "+" ? "add" : sign === "-" ? "del" : "ctx",
			lineNumber: (match[2] ?? "").trim(),
			text: match[3] ?? "",
		};
	});
}

export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (/^\+\s*\d/.test(line)) added++;
		else if (/^-\s*\d/.test(line)) removed++;
	}
	return { added, removed };
}

/** Line counts summed over every file of a change. */
export function diffsStats(diffs: readonly FileDiff[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const file of diffs) {
		const stats = diffStats(file.diff);
		added += stats.added;
		removed += stats.removed;
	}
	return { added, removed };
}

export function DiffStat({ diffs }: { diffs: readonly FileDiff[] }) {
	const { added, removed } = useMemo(() => diffsStats(diffs), [diffs]);
	return (
		<span className="shrink-0 font-mono fs-code tabular-nums">
			<span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{" "}
			<span className="text-red-600 dark:text-red-400">-{removed}</span>
		</span>
	);
}

export function DiffView({ diff, className }: { diff: string; className?: string }) {
	const lines = useMemo(() => parse(diff), [diff]);
	return (
		<div className={cn("overflow-auto rounded-md border bg-background font-mono fs-code leading-5", className)}>
			<table className="w-full border-collapse">
				<tbody>
					{lines.map((line, i) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
							key={i}
							className={cn(
								line.kind === "add" && "bg-emerald-500/10",
								line.kind === "del" && "bg-red-500/10",
								line.kind === "gap" && "bg-muted/50 text-muted-foreground",
							)}
						>
							<td className="w-px px-2 text-right text-muted-foreground/70 select-none">{line.lineNumber}</td>
							<td
								className={cn(
									"w-px pr-1 select-none",
									line.kind === "add" && "text-emerald-600 dark:text-emerald-400",
									line.kind === "del" && "text-red-600 dark:text-red-400",
								)}
							>
								{line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
							</td>
							<td className="pr-3 whitespace-pre-wrap break-all">{line.text}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
