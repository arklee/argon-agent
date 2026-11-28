import type { ToolDisplay } from "@argon/shared";
import {
	Ban,
	CircleDashed,
	Code,
	FilePen,
	FileText,
	Hand,
	Loader2,
	type LucideIcon,
	Search,
	TerminalSquare,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { CategoryCount } from "@/lib/turns";
import { cn } from "@/lib/utils";

/** "Read 4 files", "Ran 3 commands", "web_search ×2", in order. */
export function useCountLabels(): (counts: readonly CategoryCount[]) => string[] {
	const { t } = useTranslation();
	return useCallback(
		(counts) =>
			counts.map(({ category, title, count }) =>
				category === "other"
					? count > 1
						? t("tools.summary.other", { title: title ?? "", count })
						: (title ?? "")
					: t(`tools.summary.${category}`, { count }),
			),
		[t],
	);
}

/** Verb for a call's row ("Ran", "Read"); generic tools keep their own title. */
export function useToolVerb(): (display: ToolDisplay, name: string) => string {
	const { t } = useTranslation();
	return useCallback(
		(display, name) => (display.kind === "generic" ? display.title || name : t(`tools.verb.${display.kind}`)),
		[t],
	);
}

const KIND_ICON: Record<string, LucideIcon> = {
	shell: TerminalSquare,
	file_read: FileText,
	search: Search,
	file_change: FilePen,
	script: Code,
};

export type CallState = "pending" | "running" | "done" | "error" | "blocked" | "approval";

/** Status for live states, the tool's kind once it has finished well. */
export function CallIcon({ state, kind, className }: { state: CallState; kind?: string; className?: string }) {
	const base = cn("size-3.5 shrink-0", className);
	switch (state) {
		case "approval":
			return <Hand className={cn(base, "text-amber-600 dark:text-amber-400")} />;
		case "pending":
			return <CircleDashed className={cn(base, "text-muted-foreground")} />;
		case "running":
			return <Loader2 className={cn(base, "animate-spin text-muted-foreground")} />;
		case "error":
			return <TriangleAlert className={cn(base, "text-destructive")} />;
		case "blocked":
			return <Ban className={cn(base, "text-amber-600 dark:text-amber-400")} />;
		default: {
			const Icon = (kind && KIND_ICON[kind]) || Wrench;
			return <Icon className={cn(base, "text-muted-foreground")} />;
		}
	}
}
