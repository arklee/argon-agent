import type { SessionState } from "@argon/shared";
import { Layers, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, formatPercent, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

function Ring({ percent, className }: { percent: number; className?: string }) {
	const r = 6;
	const c = 2 * Math.PI * r;
	const clamped = Math.max(0, Math.min(100, percent));
	return (
		<svg viewBox="0 0 16 16" className={cn("size-4 -rotate-90", className)} aria-hidden="true">
			<circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
			<circle
				cx="8"
				cy="8"
				r={r}
				fill="none"
				strokeWidth="2.5"
				strokeLinecap="round"
				stroke="currentColor"
				strokeDasharray={`${(clamped / 100) * c} ${c}`}
			/>
		</svg>
	);
}

/** Header indicator of how full the context window is, with a manual compaction action. */
export function ContextMeter({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const compact = useApp((s) => s.compact);
	const usage = session.contextUsage;
	if (!usage) return null;
	const percent = usage.percent;
	const tone =
		percent === null
			? "text-muted-foreground"
			: percent >= 85
				? "text-red-600 dark:text-red-400"
				: percent >= 60
					? "text-amber-600 dark:text-amber-400"
					: "text-muted-foreground";
	const canCompact = !session.compacting && session.items.length > 0;
	const last = session.lastUsage;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className={cn("tabular-nums", tone)} title={t("context.usage")}>
					{session.compacting ? <Loader2 className="animate-spin" /> : <Ring percent={percent ?? 0} />}
					{session.compacting ? t("context.compacting") : percent === null ? "—" : formatPercent(percent)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>{t("context.window")}</DropdownMenuLabel>
				<div className="space-y-1 px-2 pb-2 text-xs text-muted-foreground">
					<div className="flex justify-between">
						<span>{t("context.used")}</span>
						<span className="tabular-nums">
							{t("context.tokenUsage", {
								used: usage.tokens === null ? t("context.unknownUsage") : formatTokens(usage.tokens),
								total: formatTokens(usage.contextWindow),
							})}
						</span>
					</div>
					{last && (
						<div className="flex justify-between">
							<span>{t("context.lastRequest")}</span>
							<span className="tabular-nums">
								{last.costTotal > 0
									? t("context.tokensWithCost", {
											tokens: formatTokens(last.totalTokens),
											cost: formatCurrency(last.costTotal),
										})
									: t("context.tokens", { tokens: formatTokens(last.totalTokens) })}
							</span>
						</div>
					)}
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuItem disabled={!canCompact} onSelect={() => void compact()}>
					<Layers />
					<div>
						<div>{t("context.compactNow")}</div>
						<div className="text-xs text-muted-foreground">
							{session.status === "running" ? t("context.stopFirst") : t("context.compactDescription")}
						</div>
					</div>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
