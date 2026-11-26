import type { SessionDiagnostic, SessionState } from "@argon/shared";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayPath, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

const SOURCE_LABELS = {
	resources: "diagnostics.sourceResources",
	extension: "diagnostics.sourceExtension",
	model: "diagnostics.sourceModel",
} as const satisfies Record<SessionDiagnostic["source"], string>;

/** Header indicator for resource-loading problems, extension errors and model fallbacks. */
export function DiagnosticsPanel({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	const clearDiagnostics = useApp((s) => s.clearDiagnostics);
	const diagnostics = session.diagnostics;
	if (diagnostics.length === 0) return null;
	const errors = diagnostics.filter((d) => d.level === "error").length;
	// Loading problems describe the current state; only extension and model reports can be dismissed.
	const clearable = diagnostics.some((d) => d.source !== "resources");
	const tone = errors > 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
	// Newest first.
	const entries = [...diagnostics].reverse();

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn("tabular-nums", tone)}
					title={t("diagnostics.problemCount", { count: diagnostics.length })}
				>
					<TriangleAlert />
					{formatNumber(diagnostics.length)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[28rem] p-0">
				<div className="flex items-center gap-2 border-b py-1.5 pr-1.5 pl-3 text-sm font-medium">
					<span className="min-w-0 flex-1">
						{t("diagnostics.title")}
						<span className="ml-2 text-xs font-normal text-muted-foreground">
							{errors > 0 && t("diagnostics.errorCount", { count: errors })}
							{errors > 0 && errors < diagnostics.length && " · "}
							{errors < diagnostics.length && t("diagnostics.warningCount", { count: diagnostics.length - errors })}
						</span>
					</span>
					{clearable && (
						<Button
							variant="ghost"
							size="xs"
							className="text-muted-foreground"
							title={t("diagnostics.clearDescription")}
							onClick={() => void clearDiagnostics()}
						>
							{t("diagnostics.clear")}
						</Button>
					)}
				</div>
				<ul className="max-h-80 divide-y overflow-y-auto">
					{entries.map((d) => (
						<li key={d.id} className="flex gap-2 px-3 py-2 text-xs">
							<span
								className={cn(
									"mt-1.5 size-1.5 shrink-0 rounded-full",
									d.level === "error" ? "bg-red-500" : "bg-amber-500",
								)}
							/>
							<div className="min-w-0 flex-1 space-y-0.5">
								<div className="flex items-center gap-1.5 text-muted-foreground">
									{t(SOURCE_LABELS[d.source])}
									{(d.count ?? 1) > 1 && (
										<span className="rounded bg-muted px-1 tabular-nums">
											{t("diagnostics.repeated", { count: d.count ?? 1 })}
										</span>
									)}
								</div>
								<div className="whitespace-pre-wrap break-words">{d.message}</div>
								{d.path && (
									<div className="truncate font-mono text-muted-foreground" title={d.path}>
										{displayPath(d.path, homeDir)}
									</div>
								)}
							</div>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
