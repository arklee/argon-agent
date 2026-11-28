import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/** A compact select for a setting row. */
export function Choice<T extends string>({
	value,
	options,
	onChange,
	placeholder,
	ariaLabel,
	disabled,
}: {
	value: T | undefined;
	options: { value: T; label: string; disabled?: boolean }[];
	onChange: (value: T) => void;
	placeholder?: string;
	ariaLabel?: string;
	disabled?: boolean;
}) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
			<SelectTrigger size="sm" className="min-w-40" aria-label={ariaLabel}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent position="popper" align="end">
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value} disabled={o.disabled}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
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

/**
 * A download source: one of `presets` or a custom HTTPS base URL (validated by the backend). With
 * `env`, the backend pins the source by environment variable and the picker only shows it.
 */
export function MirrorPicker({
	label,
	description,
	presets,
	env,
	placeholder,
	value,
	onChange,
}: {
	label: string;
	description: ReactNode;
	presets: { id: string; label: string }[];
	env?: { name: string; value: string };
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation();
	const [choice, setChoice] = useState(() => (presets.some((p) => p.id === value) ? value : "custom"));
	if (env) {
		return (
			<Row label={label} description={description}>
				<span className="font-mono text-xs text-muted-foreground" title={t("settings.plugins.mirrorEnv")}>
					{env.name}={env.value}
				</span>
			</Row>
		);
	}
	return (
		<div className="py-3">
			<div className="flex items-center justify-between gap-6">
				<div className="min-w-0">
					<div className="text-sm">{label}</div>
					<div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
				</div>
				<Select
					value={choice}
					onValueChange={(next) => {
						setChoice(next);
						onChange(next === "custom" ? "" : next);
					}}
				>
					<SelectTrigger size="sm" className="w-40 shrink-0" aria-label={label}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent position="popper" align="end">
						{[...presets, { id: "custom", label: t("settings.plugins.mirrorCustom") }].map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								{preset.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{choice === "custom" && (
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					className="mt-2 h-8 font-mono text-xs"
					spellCheck={false}
				/>
			)}
		</div>
	);
}

function megabytes(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(1);
}

/** Progress of a backend download; indeterminate when the total size is unknown. */
export function DownloadProgress({ received = 0, total }: { received?: number; total?: number }) {
	const { t } = useTranslation();
	return (
		<div className="py-3">
			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				{total ? (
					<div
						className="h-full rounded-full bg-primary transition-[width]"
						style={{ width: `${Math.min(100, (received / total) * 100)}%` }}
					/>
				) : (
					<div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
				)}
			</div>
			<div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
				{total
					? t("settings.plugins.progress", { received: megabytes(received), total: megabytes(total) })
					: t("settings.plugins.progressUnknown", { received: megabytes(received) })}
			</div>
		</div>
	);
}
