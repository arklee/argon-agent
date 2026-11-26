import type { ModelInfo, ModelRef, ThinkingLevel } from "@argon/shared";
import { Check, ChevronDown, Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useApp, useModelScope } from "@/stores/app";
import { openSettings, useSettings } from "@/stores/settings";

const key = (m: ModelRef) => `${m.provider}/${m.id}`;
/** Group id of the project's enabled models (pi's enabledModels), listed first. */
const ENABLED = "\0enabled";

/**
 * Model picker with type-to-search. Every whitespace-separated term has to match the provider
 * (id or display name), the model name or the model id: "openai luna", "codex", "sonnet".
 */
export function ModelCombobox({
	value,
	onChange,
	placeholder,
	align = "end",
	className,
	manageProviders = true,
	cwd,
}: {
	value: ModelRef | undefined;
	/** `thinkingLevel`: set by an enabledModels pattern such as `sonnet:high`. */
	onChange: (model: ModelRef, thinkingLevel?: ThinkingLevel) => void;
	/** Project whose enabled models are offered first (none: list every model). */
	cwd?: string;
	placeholder?: string;
	align?: "start" | "end";
	className?: string;
	/** Offer "Manage providers…" (opens settings). */
	manageProviders?: boolean;
}) {
	const { t } = useTranslation();
	const models = useApp((s) => s.models);
	const providers = useSettings((s) => s.providers);
	const scope = useModelScope(cwd);
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	// Display names ("OpenAI Codex") come from providers.list; loaded once, on first open.
	useEffect(() => {
		if (open && !providers) void useSettings.getState().refreshProviders();
	}, [open, providers]);
	const providerName = (id: string) => providers?.find((p) => p.id === id)?.name ?? id;

	const enabled = useMemo(() => {
		if (!scope?.scoped.length) return [];
		const byKey = new Map(models.map((m) => [key(m), m]));
		return scope.scoped.flatMap((ref) => byKey.get(key(ref)) ?? []);
	}, [models, scope]);
	const listAll = showAll || query.trim() !== "" || enabled.length === 0;

	const groups = useMemo((): [string, ModelInfo[]][] => {
		if (!listAll) return [[ENABLED, enabled]];
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const names = new Map(providers?.map((p) => [p.id, p.name]));
		const map = new Map<string, ModelInfo[]>();
		for (const m of models) {
			const haystack = `${m.provider} ${names.get(m.provider) ?? ""} ${m.name} ${m.id}`.toLowerCase();
			if (terms.every((t) => haystack.includes(t))) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
		}
		return [...map.entries()];
	}, [models, providers, query, listAll, enabled]);
	const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);

	// On open and on each new query: highlight the current model (no query) or the first match.
	useEffect(() => {
		if (!open) return;
		const current = value ? flat.findIndex((m) => key(m) === key(value)) : -1;
		setActive(query ? 0 : Math.max(current, 0));
	}, [open, flat, query, value]);
	useEffect(() => {
		if (!open) return;
		// The list mounts with the popover: wait a frame before scrolling.
		const frame = requestAnimationFrame(() =>
			listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }),
		);
		return () => cancelAnimationFrame(frame);
	}, [open, active]);

	const choose = (model: ModelInfo) => {
		setOpen(false);
		const thinkingLevel = scope?.scoped.find((ref) => key(ref) === key(model))?.thinkingLevel;
		if (!value || key(model) !== key(value) || thinkingLevel) {
			onChange({ provider: model.provider, id: model.id }, thinkingLevel);
		}
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (flat.length === 0) return;
			const step = e.key === "ArrowDown" ? 1 : -1;
			setActive((i) => (i + step + flat.length) % flat.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const model = flat[active];
			if (model) choose(model);
		}
	};

	const current = value ? models.find((m) => key(m) === key(value)) : undefined;
	let index = -1;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setQuery("");
					// Start with the enabled models, unless the current model is not one of them.
					setShowAll(value !== undefined && !enabled.some((m) => key(m) === key(value)));
				}
			}}
		>
			<PopoverTrigger
				className={cn(
					"flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted",
					className,
				)}
			>
				<span className={cn("truncate", !current && !value && "text-muted-foreground")}>
					{current?.name ?? value?.id ?? placeholder ?? t("models.select")}
				</span>
				<ChevronDown className="size-4 shrink-0 opacity-50" />
			</PopoverTrigger>
			<PopoverContent align={align} className="w-80 p-0">
				<div className="flex items-center gap-2 border-b px-3">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t("models.search")}
						aria-label={t("models.search")}
						role="combobox"
						aria-expanded
						aria-controls="model-combobox-list"
						aria-activedescendant={flat[active] ? `model-option-${active}` : undefined}
						className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						autoFocus
					/>
				</div>
				<div ref={listRef} id="model-combobox-list" role="listbox" className="max-h-80 overflow-y-auto p-1">
					{flat.length === 0 && (
						<p className="px-2 py-6 text-center text-sm text-muted-foreground">
							{models.length === 0 ? t("models.empty") : t("models.noMatch")}
						</p>
					)}
					{groups.map(([provider, list]) => (
						<div key={provider}>
							<div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
								{provider === ENABLED ? t("models.enabled") : providerName(provider)}
							</div>
							{list.map((m) => {
								index += 1;
								const i = index;
								const selected = value !== undefined && key(m) === key(value);
								return (
									<div
										key={key(m)}
										id={`model-option-${i}`}
										data-index={i}
										role="option"
										aria-selected={selected}
										tabIndex={-1}
										onMouseMove={() => setActive(i)}
										onClick={() => choose(m)}
										onKeyDown={() => undefined}
										className={cn(
											"flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm",
											i === active && "bg-accent text-accent-foreground",
										)}
									>
										<span className="min-w-0 flex-1 truncate" title={m.id}>
											{m.name}
										</span>
										{provider === ENABLED && (
											<span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
												{providerName(m.provider)}
											</span>
										)}
										{selected && <Check className="size-4 shrink-0" />}
									</div>
								);
							})}
						</div>
					))}
				</div>
				{enabled.length > 0 && !query.trim() && (
					<div className="border-t p-1">
						<button
							type="button"
							onClick={() => setShowAll((all) => !all)}
							className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						>
							{showAll ? t("models.showEnabled") : t("models.showAll")}
						</button>
					</div>
				)}
				{manageProviders && (
					<div className="border-t p-1">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								openSettings("accounts");
							}}
							className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						>
							{models.length > 0 ? t("models.manageProviders") : t("models.connectProvider")}
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
