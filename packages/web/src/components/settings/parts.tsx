import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { basename } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/stores/settings";

export function Group({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<section className="mb-6 last:mb-0">
			{title && <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>}
			<div className="divide-y rounded-lg border px-4">{children}</div>
		</section>
	);
}

export function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6 py-3">
			<div className="min-w-0">
				<div className="text-sm">{label}</div>
				{description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
			</div>
			<div className="flex shrink-0 items-center">{children}</div>
		</div>
	);
}

export function Loading() {
	const { t } = useTranslation();
	return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>;
}

/** "All projects" / "Project · name" switch for sections with project-level settings (needs a project). */
export function ScopeSwitch() {
	const { t } = useTranslation();
	const cwd = useSettings((s) => s.cwd);
	const scope = useSettings((s) => s.scope);
	const setScope = useSettings((s) => s.setScope);
	if (!cwd) return null;
	const options = [
		{ value: "global", label: t("settings.general.scopeGlobal") },
		{ value: "project", label: `${t("settings.general.scopeProject")} · ${basename(cwd) || cwd}` },
	] as const;
	return (
		<fieldset
			aria-label={t("settings.general.scope")}
			className="m-0 min-w-0 border-0 mb-5 flex rounded-lg bg-muted p-0.5"
		>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={scope === option.value}
					title={option.value === "project" ? cwd : undefined}
					onClick={() => setScope(option.value)}
					className={cn(
						"min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
						scope === option.value && "bg-background font-medium text-foreground shadow-xs",
					)}
				>
					{option.label}
				</button>
			))}
		</fieldset>
	);
}
