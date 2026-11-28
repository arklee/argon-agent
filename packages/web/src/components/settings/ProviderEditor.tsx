/**
 * Add or edit a provider entry of pi's models.json: a custom OpenAI/Anthropic/Google-compatible
 * endpoint with its models, or the endpoint override (base URL, headers) of a built-in provider.
 * Everything the form does not cover stays in the file and is edited in the JSON editor.
 */

import { type CustomModelConfig, type CustomProviderConfig, PROVIDER_APIS, type ProviderInfo } from "@argon/shared";
import { Check, ChevronRight, Download, Eye, EyeOff, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getClient } from "@/stores/app";

interface ModelDraft {
	key: string;
	id: string;
	name: string;
	reasoning: boolean;
	image: boolean;
	contextWindow: string;
	maxTokens: string;
}

interface HeaderDraft {
	key: string;
	name: string;
	value: string;
}

interface Draft {
	id: string;
	name: string;
	api: string;
	baseUrl: string;
	apiKey: string;
	authHeader: boolean;
	headers: HeaderDraft[];
	models: ModelDraft[];
}

let nextKey = 0;
const newKey = () => `k${nextKey++}`;

const BASE_URL_PLACEHOLDERS: Record<string, string> = {
	"openai-completions": "https://api.example.com/v1",
	"openai-responses": "https://api.example.com/v1",
	"anthropic-messages": "https://api.anthropic.com",
	"google-generative-ai": "https://generativelanguage.googleapis.com/v1beta",
};

/** Local OpenAI-compatible servers: they ignore the key, but pi needs one to list the models. */
const TEMPLATES = {
	ollama: { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", apiKey: "ollama" },
	lmstudio: { id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio" },
	vllm: { id: "vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1", apiKey: "vllm" },
} as const;
type TemplateId = keyof typeof TEMPLATES | "custom";

function modelDraft(model: Partial<CustomModelConfig> & { id: string }): ModelDraft {
	return {
		key: newKey(),
		id: model.id,
		name: model.name ?? "",
		reasoning: model.reasoning ?? false,
		image: model.input?.includes("image") ?? false,
		contextWindow: model.contextWindow?.toString() ?? "",
		maxTokens: model.maxTokens?.toString() ?? "",
	};
}

function toDraft(provider: ProviderInfo | undefined): Draft {
	const config = provider?.config ?? {};
	return {
		id: provider?.id ?? "",
		name: config.name ?? "",
		api: config.api ?? "openai-completions",
		baseUrl: config.baseUrl ?? "",
		apiKey: config.apiKey ?? "",
		authHeader: config.authHeader ?? false,
		headers: Object.entries(config.headers ?? {}).map(([name, value]) => ({ key: newKey(), name, value })),
		models: (config.models ?? []).map(modelDraft),
	};
}

/** Positive integer, or undefined when empty; NaN marks an invalid entry. */
function parseCount(text: string): number | undefined {
	const trimmed = text.trim().replace(/[_,\s]/g, "");
	if (!trimmed) return undefined;
	const value = Number(trimmed);
	return Number.isInteger(value) && value > 0 ? value : Number.NaN;
}

function toConfig(draft: Draft, builtin: boolean): CustomProviderConfig {
	const headers = Object.fromEntries(
		draft.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value] as const),
	);
	const config: CustomProviderConfig = {
		baseUrl: draft.baseUrl.trim() || undefined,
		headers: Object.keys(headers).length > 0 ? headers : undefined,
	};
	if (builtin) return config;
	return {
		...config,
		name: draft.name.trim() || undefined,
		api: draft.api,
		apiKey: draft.apiKey.trim() || undefined,
		authHeader: draft.authHeader || undefined,
		models: draft.models
			.filter((m) => m.id.trim())
			.map((m) => ({
				id: m.id.trim(),
				name: m.name.trim() || undefined,
				reasoning: m.reasoning || undefined,
				input: m.image ? ["text", "image"] : undefined,
				contextWindow: parseCount(m.contextWindow),
				maxTokens: parseCount(m.maxTokens),
			})),
	};
}

function validate(draft: Draft, builtin: boolean, create: boolean, t: (key: string) => string): string | undefined {
	if (create && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(draft.id.trim())) return t("settings.providerEditor.invalidId");
	if (!builtin && !draft.baseUrl.trim()) return t("settings.providerEditor.baseUrlRequired");
	const url = draft.baseUrl.trim();
	if (url && !/^https?:\/\/\S+$/.test(url)) return t("settings.providerEditor.invalidUrl");
	if (builtin) return undefined;
	const ids = draft.models.map((m) => m.id.trim()).filter(Boolean);
	if (new Set(ids).size !== ids.length) return t("settings.providerEditor.duplicateModel");
	for (const m of draft.models) {
		if (Number.isNaN(parseCount(m.contextWindow)) || Number.isNaN(parseCount(m.maxTokens)))
			return t("settings.providerEditor.invalidNumber");
	}
	return undefined;
}

/** `provider` undefined: add a new custom provider. */
export function ProviderEditor({
	provider,
	open,
	onOpenChange,
	onEditJson,
}: {
	provider: ProviderInfo | undefined;
	open: boolean;
	onOpenChange(open: boolean): void;
	onEditJson(): void;
}) {
	const { t } = useTranslation();
	const create = !provider;
	const builtin = provider !== undefined && provider.origin !== "custom";
	const [draft, setDraft] = useState(() => toDraft(provider));
	const [template, setTemplate] = useState<TemplateId>("custom");
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
	const updateModel = (key: string, patch: Partial<ModelDraft>) =>
		setDraft((d) => ({ ...d, models: d.models.map((m) => (m.key === key ? { ...m, ...patch } : m)) }));
	const updateHeader = (key: string, patch: Partial<HeaderDraft>) =>
		setDraft((d) => ({ ...d, headers: d.headers.map((h) => (h.key === key ? { ...h, ...patch } : h)) }));

	const applyTemplate = (id: TemplateId) => {
		setTemplate(id);
		if (id === "custom") return;
		const preset = TEMPLATES[id];
		update({
			id: preset.id,
			name: preset.name,
			baseUrl: preset.baseUrl,
			apiKey: preset.apiKey,
			api: "openai-completions",
		});
	};

	const save = async () => {
		const problem = validate(draft, builtin, create, t);
		if (problem) {
			setError(problem);
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			await getClient().request("providers.save", {
				id: create ? draft.id.trim() : provider.id,
				config: toConfig(draft, builtin),
				create,
			});
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const apis: string[] = PROVIDER_APIS.includes(draft.api as (typeof PROVIDER_APIS)[number])
		? [...PROVIDER_APIS]
		: [...PROVIDER_APIS, draft.api];
	const canDiscover = !builtin && draft.api.startsWith("openai-") && /^https?:\/\/\S+$/.test(draft.baseUrl.trim());

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[min(760px,90vh)] flex-col gap-0 p-0 sm:max-w-2xl">
				<div className="border-b px-6 py-4 pr-12">
					<DialogTitle className="text-base">
						{create
							? t("settings.providerEditor.addTitle")
							: builtin
								? t("settings.providerEditor.endpointTitle", { name: provider.name })
								: t("settings.providerEditor.editTitle", { name: provider.name })}
					</DialogTitle>
					<DialogDescription className="text-xs">
						{builtin ? t("settings.providerEditor.endpointDescription") : t("settings.providerEditor.description")}
					</DialogDescription>
				</div>

				<form
					id="provider-editor"
					className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					{create && (
						<Field label={t("settings.providerEditor.template")}>
							<Select value={template} onValueChange={(v) => applyTemplate(v as TemplateId)}>
								<SelectTrigger size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper">
									<SelectItem value="custom">{t("settings.providerEditor.templateCustom")}</SelectItem>
									{(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((id) => (
										<SelectItem key={id} value={id}>
											{TEMPLATES[id].name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					)}

					{!builtin && (
						<div className="grid grid-cols-2 gap-3">
							<Field
								label={t("settings.providerEditor.id")}
								hint={create ? t("settings.providerEditor.idHint") : undefined}
							>
								<Input
									value={draft.id}
									disabled={!create}
									onChange={(e) => update({ id: e.target.value })}
									placeholder="my-provider"
									className="h-8 font-mono text-xs"
									autoFocus={create}
									spellCheck={false}
								/>
							</Field>
							<Field label={t("settings.providerEditor.name")}>
								<Input
									value={draft.name}
									onChange={(e) => update({ name: e.target.value })}
									placeholder={draft.id || t("settings.providerEditor.namePlaceholder")}
									className="h-8"
								/>
							</Field>
						</div>
					)}

					{!builtin && (
						<Field label={t("settings.providerEditor.api")} hint={t("settings.providerEditor.apiHint")}>
							<Select value={draft.api} onValueChange={(api) => update({ api })}>
								<SelectTrigger size="sm" className="w-full font-mono text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper">
									{apis.map((api) => (
										<SelectItem key={api} value={api} className="font-mono text-xs">
											{api}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					)}

					<Field
						label={t("settings.providerEditor.baseUrl")}
						hint={builtin ? t("settings.providerEditor.baseUrlBuiltinHint") : undefined}
					>
						<Input
							value={draft.baseUrl}
							onChange={(e) => update({ baseUrl: e.target.value })}
							placeholder={BASE_URL_PLACEHOLDERS[draft.api] ?? "https://"}
							className="h-8 font-mono text-xs"
							autoFocus={builtin}
							spellCheck={false}
						/>
					</Field>

					{!builtin && (
						<Field label={t("settings.providerEditor.apiKey")} hint={t("settings.providerEditor.apiKeyHint")}>
							<div className="relative">
								<Input
									type={showKey ? "text" : "password"}
									value={draft.apiKey}
									onChange={(e) => update({ apiKey: e.target.value })}
									placeholder={t("settings.providerEditor.apiKeyPlaceholder")}
									className="h-8 pr-9 font-mono text-xs"
									autoComplete="off"
									spellCheck={false}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="absolute top-1/2 right-1.5 -translate-y-1/2"
									aria-label={showKey ? t("settings.providerEditor.hideKey") : t("settings.providerEditor.showKey")}
									onClick={() => setShowKey((v) => !v)}
								>
									{showKey ? <EyeOff /> : <Eye />}
								</Button>
							</div>
						</Field>
					)}

					{!builtin && (
						<section className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<div>
									<h3 className="text-sm font-medium">{t("settings.providerEditor.models")}</h3>
									<p className="text-xs text-muted-foreground">{t("settings.providerEditor.modelsHint")}</p>
								</div>
								<div className="flex shrink-0 gap-1.5">
									{canDiscover && (
										<DiscoverModels
											draft={draft}
											providerId={provider?.id}
											onAdd={(ids) =>
												setDraft((d) => ({
													...d,
													models: [
														...d.models,
														...ids.filter((id) => !d.models.some((m) => m.id === id)).map((id) => modelDraft({ id })),
													],
												}))
											}
										/>
									)}
									<Button
										type="button"
										variant="outline"
										size="xs"
										onClick={() => setDraft((d) => ({ ...d, models: [...d.models, modelDraft({ id: "" })] }))}
									>
										<Plus />
										{t("settings.providerEditor.addModel")}
									</Button>
								</div>
							</div>
							{draft.models.length === 0 ? (
								<p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
									{t("settings.providerEditor.noModels")}
								</p>
							) : (
								<div className="divide-y rounded-lg border">
									{draft.models.map((model) => (
										<ModelRow
											key={model.key}
											model={model}
											onChange={(patch) => updateModel(model.key, patch)}
											onRemove={() => setDraft((d) => ({ ...d, models: d.models.filter((m) => m.key !== model.key) }))}
										/>
									))}
								</div>
							)}
						</section>
					)}

					<Collapsible defaultOpen={builtin || draft.headers.length > 0 || draft.authHeader}>
						<CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
							<ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
							{t("settings.providerEditor.advanced")}
						</CollapsibleTrigger>
						<CollapsibleContent className="-mx-1 space-y-4 px-1 pt-3 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
							{!builtin && (
								<div className="flex items-center justify-between gap-6">
									<div>
										<div className="text-sm">{t("settings.providerEditor.authHeader")}</div>
										<div className="text-xs text-muted-foreground">{t("settings.providerEditor.authHeaderHint")}</div>
									</div>
									<Switch checked={draft.authHeader} onCheckedChange={(authHeader) => update({ authHeader })} />
								</div>
							)}
							<div className="space-y-2">
								<div className="flex items-center justify-between gap-2">
									<div>
										<div className="text-sm">{t("settings.providerEditor.headers")}</div>
										<div className="text-xs text-muted-foreground">{t("settings.providerEditor.headersHint")}</div>
									</div>
									<Button
										type="button"
										variant="outline"
										size="xs"
										onClick={() =>
											setDraft((d) => ({ ...d, headers: [...d.headers, { key: newKey(), name: "", value: "" }] }))
										}
									>
										<Plus />
										{t("settings.providerEditor.addHeader")}
									</Button>
								</div>
								{draft.headers.map((header) => (
									<div key={header.key} className="flex gap-2">
										<Input
											value={header.name}
											onChange={(e) => updateHeader(header.key, { name: e.target.value })}
											placeholder="X-Header"
											className="h-8 w-48 font-mono text-xs"
											spellCheck={false}
										/>
										<Input
											value={header.value}
											onChange={(e) => updateHeader(header.key, { value: e.target.value })}
											placeholder={t("settings.providerEditor.headerValue")}
											className="h-8 flex-1 font-mono text-xs"
											spellCheck={false}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={t("common.remove")}
											onClick={() =>
												setDraft((d) => ({ ...d, headers: d.headers.filter((h) => h.key !== header.key) }))
											}
										>
											<Trash2 />
										</Button>
									</div>
								))}
							</div>
						</CollapsibleContent>
					</Collapsible>
				</form>

				{error && (
					<p className="max-h-24 overflow-y-auto border-t bg-destructive/5 px-6 py-2 text-xs break-words whitespace-pre-wrap text-destructive">
						{error}
					</p>
				)}
				<DialogFooter className="m-0 items-center px-6 py-3 sm:justify-between">
					<Button type="button" variant="link" size="sm" className="px-0 text-muted-foreground" onClick={onEditJson}>
						{t("settings.providerEditor.editJson")}
					</Button>
					<div className="flex shrink-0 items-center gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" form="provider-editor" size="sm" disabled={saving}>
							{saving && <Loader2 className="animate-spin" />}
							{create ? t("settings.providerEditor.add") : t("common.save")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
		<label className="block space-y-1.5">
			<span className="text-sm">{label}</span>
			{children}
			{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
		</label>
	);
}

function ModelRow({
	model,
	onChange,
	onRemove,
}: {
	model: ModelDraft;
	onChange(patch: Partial<ModelDraft>): void;
	onRemove(): void;
}) {
	const { t } = useTranslation();
	return (
		<div className="space-y-2 p-3">
			<div className="flex gap-2">
				<Input
					value={model.id}
					onChange={(e) => onChange({ id: e.target.value })}
					placeholder={t("settings.providerEditor.modelId")}
					aria-label={t("settings.providerEditor.modelId")}
					className="h-7 flex-1 font-mono text-xs"
					autoFocus={!model.id}
					spellCheck={false}
				/>
				<Input
					value={model.name}
					onChange={(e) => onChange({ name: e.target.value })}
					placeholder={t("settings.providerEditor.modelName")}
					aria-label={t("settings.providerEditor.modelName")}
					className="h-7 flex-1 text-xs"
				/>
				<Button type="button" variant="ghost" size="icon-xs" aria-label={t("common.remove")} onClick={onRemove}>
					<Trash2 />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
				<NumberField
					label={t("settings.providerEditor.contextWindow")}
					value={model.contextWindow}
					placeholder="128000"
					onChange={(contextWindow) => onChange({ contextWindow })}
				/>
				<NumberField
					label={t("settings.providerEditor.maxTokens")}
					value={model.maxTokens}
					placeholder="16384"
					onChange={(maxTokens) => onChange({ maxTokens })}
				/>
				<Toggle
					label={t("settings.providerEditor.reasoning")}
					checked={model.reasoning}
					onChange={(reasoning) => onChange({ reasoning })}
				/>
				<Toggle
					label={t("settings.providerEditor.imageInput")}
					checked={model.image}
					onChange={(image) => onChange({ image })}
				/>
			</div>
		</div>
	);
}

function NumberField({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder: string;
	onChange(value: string): void;
}) {
	const invalid = Number.isNaN(parseCount(value));
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
		<label className="flex items-center gap-1.5">
			{label}
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				inputMode="numeric"
				aria-invalid={invalid || undefined}
				className="h-6 w-24 px-2 font-mono text-xs"
			/>
		</label>
	);
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
		<label className="flex items-center gap-1.5">
			<Switch checked={checked} onCheckedChange={onChange} />
			{label}
		</label>
	);
}

/** Fetch the endpoint's model list and pick models to add. */
function DiscoverModels({
	draft,
	providerId,
	onAdd,
}: {
	draft: Draft;
	providerId: string | undefined;
	onAdd(ids: string[]): void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const existing = useMemo(() => new Set(draft.models.map((m) => m.id.trim())), [draft.models]);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : models;
	}, [models, query]);

	const load = async () => {
		setLoading(true);
		setError(undefined);
		try {
			const headers = Object.fromEntries(
				draft.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value]),
			);
			const result = await getClient().request("providers.discoverModels", {
				baseUrl: draft.baseUrl.trim(),
				api: draft.api,
				apiKey: draft.apiKey.trim() || undefined,
				headers: Object.keys(headers).length > 0 ? headers : undefined,
				providerId,
			});
			setModels(result.models);
			setSelected(new Set());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) void load();
			}}
		>
			<PopoverTrigger asChild>
				<Button type="button" variant="outline" size="xs">
					<Download />
					{t("settings.providerEditor.fetchModels")}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				{loading ? (
					<p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						{t("settings.providerEditor.fetching")}
					</p>
				) : error ? (
					<div className="space-y-2 p-3">
						<p className="text-xs break-words whitespace-pre-wrap text-destructive">{error}</p>
						<Button type="button" variant="outline" size="xs" onClick={() => void load()}>
							{t("common.retry")}
						</Button>
					</div>
				) : (
					<>
						<div className="relative border-b p-2">
							<Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={t("settings.providerEditor.filterModels", { count: models.length })}
								className="h-7 pl-7 text-xs"
							/>
						</div>
						<div className="max-h-64 overflow-y-auto p-1">
							{filtered.length === 0 && (
								<p className="py-6 text-center text-xs text-muted-foreground">
									{t("settings.providerEditor.noneFound")}
								</p>
							)}
							{filtered.map((model) => {
								const added = existing.has(model.id);
								const checked = added || selected.has(model.id);
								return (
									<button
										key={model.id}
										type="button"
										disabled={added}
										onClick={() =>
											setSelected((s) => {
												const next = new Set(s);
												if (next.has(model.id)) next.delete(model.id);
												else next.add(model.id);
												return next;
											})
										}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent",
										)}
									>
										<span
											className={cn(
												"flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
												checked && "border-primary bg-primary text-primary-foreground",
											)}
										>
											{checked && <Check className="size-3" />}
										</span>
										<span className="truncate font-mono">{model.id}</span>
									</button>
								);
							})}
						</div>
						<div className="flex items-center justify-between gap-2 border-t p-2">
							<Button
								type="button"
								variant="ghost"
								size="xs"
								disabled={filtered.every((m) => existing.has(m.id))}
								onClick={() => setSelected(new Set(filtered.filter((m) => !existing.has(m.id)).map((m) => m.id)))}
							>
								{t("settings.providerEditor.selectAll")}
							</Button>
							<Button
								type="button"
								size="xs"
								disabled={selected.size === 0}
								onClick={() => {
									onAdd([...selected]);
									setOpen(false);
								}}
							>
								{t("settings.providerEditor.addSelected", { count: selected.size })}
							</Button>
						</div>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
