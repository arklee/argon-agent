import type { ExtensionWidget } from "@argon/shared";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Extension widgets (pi's setWidget): text blocks next to the composer. Component widgets arrive
 * already rendered to text by the backend, so both kinds are lines of monospace text here.
 */
export function ExtensionWidgets({
	widgets,
	placement,
	className,
}: {
	widgets: ExtensionWidget[] | undefined;
	placement: ExtensionWidget["placement"];
	className?: string;
}) {
	const { t } = useTranslation();
	const shown = (widgets ?? []).filter((w) => w.placement === placement && w.lines.some((line) => line.trim()));
	if (shown.length === 0) return null;
	return (
		<div className={cn("space-y-1.5", className)}>
			{shown.map((widget) => (
				<section
					key={widget.key}
					aria-label={t("composer.widget", { key: widget.key })}
					className="max-h-48 overflow-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre text-muted-foreground"
				>
					{trimBlankEdges(widget.lines).join("\n")}
				</section>
			))}
		</div>
	);
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start]?.trim()) start++;
	while (end > start && !lines[end - 1]?.trim()) end--;
	return lines.slice(start, end);
}
