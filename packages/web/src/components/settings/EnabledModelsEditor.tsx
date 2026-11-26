import type { ModelInfo } from "@argon/shared";
import { Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";

const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;
const modelKey = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

/** The model a pattern names exactly (`provider/id`, optionally with a thinking suffix), if any. */
function exactKey(pattern: string, keys: ReadonlySet<string>): string | undefined {
	const bare = pattern.replace(THINKING_SUFFIX, "").toLowerCase();
	return keys.has(bare) ? bare : undefined;
}

/** Summary for the settings row: "All models" or "N models" (patterns count as entries). */
export function enabledModelsSummary(patterns: string[] | undefined, t: (key: string, o?: object) => string): string {
	return patterns?.length
		? t("settings.general.modelCount", { count: patterns.length })
		: t("settings.general.allModels");
}

/**
 * Editor for pi's `enabledModels`: tick models (saved as exact `provider/id` patterns) or add
 * free-form patterns (globs, thinking suffixes). Every change is saved right away.
 */
export function EnabledModelsEditor({
	open,
	onOpenChange,
	patterns,
	onChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	patterns: string[];
	onChange: (patterns: string[]) => void;
}) {
	const { t } = useTranslation();
	const models = useApp((s) => s.models);
	const providers = useSettings((s) => s.providers);
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState("");

	const keys = useMemo(() => new Set(models.map((m) => modelKey(m).toLowerCase())), [models]);
	const selected = useMemo(() => new Set(patterns.flatMap((p) => exactKey(p, keys) ?? [])), [patterns, keys]);
	const custom = patterns.filter((p) => exactKey(p, keys) === undefined);
	const providerName = (id: string) => providers?.find((p) => p.id === id)?.name ?? id;

	const groups = useMemo(() => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const names = new Map(providers?.map((p) => [p.id, p.name]));
		const map = new Map<string, ModelInfo[]>();
		for (const m of models) {
			const haystack = `${m.provider} ${names.get(m.provider) ?? ""} ${m.name} ${m.id}`.toLowerCase();
			if (terms.every((term) => haystack.includes(term))) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
		}
		return [...map.entries()];
	}, [models, providers, query]);

	const toggle = (m: ModelInfo) => {
		const k = modelKey(m).toLowerCase();
		onChange(selected.has(k) ? patterns.filter((p) => exactKey(p, keys) !== k) : [...patterns, modelKey(m)]);
	};
	const addPattern = () => {
		const pattern = draft.trim();
		if (!pattern) return;
		if (!patterns.some((p) => p.toLowerCase() === pattern.toLowerCase())) onChange([...patterns, pattern]);
		setDraft("");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg">
				<div>
					<DialogTitle>{t("settings.general.editModels")}</DialogTitle>
					<DialogDescription className="text-xs">{t("settings.general.enabledModelsDescription")}</DialogDescription>
				</div>
				<div className="flex items-center gap-2 rounded-md border px-2.5">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("models.search")}
						aria-label={t("models.search")}
						className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1">
					{groups.length === 0 && (
						<p className="px-2 py-6 text-center text-sm text-muted-foreground">
							{models.length === 0 ? t("models.empty") : t("models.noMatch")}
						</p>
					)}
					{groups.map(([provider, list]) => (
						<div key={provider}>
							<div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{providerName(provider)}</div>
							{list.map((m) => {
								const checked = selected.has(modelKey(m).toLowerCase());
								return (
									<label
										key={modelKey(m)}
										className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
									>
										<input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(m)} />
										<span
											aria-hidden
											className={cn(
												"flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
												checked && "border-primary bg-primary text-primary-foreground",
											)}
										>
											{checked && <Check className="size-3" />}
										</span>
										<span className="min-w-0 flex-1 truncate" title={m.id}>
											{m.name}
										</span>
									</label>
								);
							})}
						</div>
					))}
				</div>
				<div className="space-y-2">
					<div className="text-xs font-medium text-muted-foreground">{t("settings.general.customPatterns")}</div>
					{custom.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{custom.map((pattern) => (
								<span
									key={pattern}
									className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 font-mono text-xs"
								>
									{pattern}
									<Button
										variant="ghost"
										size="icon-xs"
										className="size-5"
										aria-label={t("settings.general.removePattern", { pattern })}
										onClick={() => onChange(patterns.filter((p) => p !== pattern))}
									>
										<X />
									</Button>
								</span>
							))}
						</div>
					)}
					<div className="flex gap-2">
						<Input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.nativeEvent.isComposing) {
									e.preventDefault();
									addPattern();
								}
							}}
							placeholder={t("settings.general.patternPlaceholder")}
							className="h-8 font-mono text-xs"
						/>
						<Button variant="outline" size="sm" onClick={addPattern} disabled={!draft.trim()}>
							{t("settings.general.add")}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">{t("settings.general.patternsHelp")}</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" disabled={patterns.length === 0} onClick={() => onChange([])}>
						{t("settings.general.clearModels")}
					</Button>
					<Button onClick={() => onOpenChange(false)}>{t("settings.general.done")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
