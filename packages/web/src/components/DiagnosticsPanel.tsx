import type { SessionDiagnostic, SessionState } from "@argon/shared";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayPath } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

const SOURCE_LABELS: Record<SessionDiagnostic["source"], string> = {
	resources: "Loading",
	extension: "Extension",
	model: "Model",
};

/** Header indicator for resource-loading problems, extension errors and model fallbacks. */
export function DiagnosticsPanel({ session }: { session: SessionState }) {
	const homeDir = useApp((s) => s.environment?.homeDir);
	const diagnostics = session.diagnostics;
	if (diagnostics.length === 0) return null;
	const errors = diagnostics.filter((d) => d.level === "error").length;
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
					title={`${diagnostics.length} ${diagnostics.length === 1 ? "problem" : "problems"}`}
				>
					<TriangleAlert />
					{diagnostics.length}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[28rem] p-0">
				<div className="border-b px-3 py-2 text-sm font-medium">
					Problems
					<span className="ml-2 text-xs font-normal text-muted-foreground">
						{errors > 0 && `${errors} ${errors === 1 ? "error" : "errors"}`}
						{errors > 0 && errors < diagnostics.length && " · "}
						{errors < diagnostics.length &&
							`${diagnostics.length - errors} ${diagnostics.length - errors === 1 ? "warning" : "warnings"}`}
					</span>
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
								<div className="text-muted-foreground">{SOURCE_LABELS[d.source]}</div>
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
