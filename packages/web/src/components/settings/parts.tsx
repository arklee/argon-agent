import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
