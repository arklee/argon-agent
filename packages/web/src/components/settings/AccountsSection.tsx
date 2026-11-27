import type { AuthFlow, AuthPromptInfo, ProviderInfo } from "@argon/shared";
import { Braces, Check, Copy, ExternalLink, Loader2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelsJsonEditor } from "@/components/settings/ModelsJsonEditor";
import { ProviderEditor } from "@/components/settings/ProviderEditor";
import { Group, Loading } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { getClient } from "@/stores/app";
import { latestFlow, useSettings } from "@/stores/settings";

interface RowActions {
	edit(provider: ProviderInfo): void;
	remove(provider: ProviderInfo): void;
}

export function AccountsSection() {
	const { t } = useTranslation();
	const providers = useSettings((s) => s.providers);
	const [query, setQuery] = useState("");
	// `provider: undefined`: adding a new one. The key remounts the form for each opening.
	const [editing, setEditing] = useState<{ provider?: ProviderInfo; key: number }>();
	const [jsonOpen, setJsonOpen] = useState(false);
	const [removing, setRemoving] = useState<ProviderInfo>();
	const actions: RowActions = {
		edit: (provider) => setEditing({ provider, key: Date.now() }),
		remove: setRemoving,
	};
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!providers) return undefined;
		return q ? providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : providers;
	}, [providers, query]);
	if (!filtered) return <Loading />;
	const connected = filtered.filter((p) => p.auth.configured);
	const others = filtered.filter((p) => !p.auth.configured);

	return (
		<>
			<div className="mb-4 flex gap-2">
				<div className="relative flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("settings.accounts.search")}
						className="h-8 pl-8"
					/>
				</div>
				<Button variant="outline" size="sm" onClick={() => setEditing({ key: Date.now() })}>
					<Plus />
					{t("settings.accounts.addProvider")}
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setJsonOpen(true)} title={t("settings.accounts.editJsonHint")}>
					<Braces />
					{t("settings.accounts.editJson")}
				</Button>
			</div>
			{connected.length > 0 && (
				<Group title={t("settings.accounts.connected")}>
					{connected.map((p) => (
						<ProviderRow key={p.id} provider={p} actions={actions} />
					))}
				</Group>
			)}
			{others.length > 0 && (
				<Group title={connected.length > 0 ? t("settings.accounts.otherProviders") : t("settings.accounts.providers")}>
					{others.map((p) => (
						<ProviderRow key={p.id} provider={p} actions={actions} />
					))}
				</Group>
			)}
			{filtered.length === 0 && (
				<p className="py-8 text-center text-sm text-muted-foreground">{t("settings.accounts.noMatch", { query })}</p>
			)}
			{editing && (
				<ProviderEditor
					key={editing.key}
					provider={editing.provider}
					open
					onOpenChange={(open) => !open && setEditing(undefined)}
					onEditJson={() => {
						setEditing(undefined);
						setJsonOpen(true);
					}}
				/>
			)}
			<ModelsJsonEditor open={jsonOpen} onOpenChange={setJsonOpen} />
			<RemoveDialog provider={removing} onClose={() => setRemoving(undefined)} />
		</>
	);
}

function statusText(provider: ProviderInfo): string {
	if (!provider.auth.configured)
		return provider.origin === "custom" ? t("settings.accounts.noKeyCustom") : t("settings.accounts.notConnected");
	if (provider.stored === "oauth") return t("settings.accounts.signedIn");
	if (provider.stored === "api_key") return t("settings.accounts.keySaved");
	if (provider.config?.apiKey) return t("settings.accounts.keyInModelsJson");
	return provider.auth.label
		? t("settings.accounts.from", { name: provider.auth.label })
		: t("settings.accounts.environment");
}

function RemoveDialog({ provider, onClose }: { provider: ProviderInfo | undefined; onClose(): void }) {
	const { t } = useTranslation();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const custom = provider?.origin === "custom";
	return (
		<Dialog
			open={provider !== undefined}
			onOpenChange={(open) => {
				if (!open) {
					setError(undefined);
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogTitle>
					{custom
						? t("settings.accounts.confirmDelete", { name: provider?.name ?? "" })
						: t("settings.accounts.confirmReset", { name: provider?.name ?? "" })}
				</DialogTitle>
				<DialogDescription>
					{custom ? t("settings.accounts.confirmDeleteBody") : t("settings.accounts.confirmResetBody")}
				</DialogDescription>
				{error && <p className="text-xs whitespace-pre-wrap text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						variant="destructive"
						disabled={busy}
						onClick={async () => {
							if (!provider) return;
							setBusy(true);
							try {
								await getClient().request("providers.remove", { id: provider.id });
								onClose();
							} catch (e) {
								setError(e instanceof Error ? e.message : String(e));
							} finally {
								setBusy(false);
							}
						}}
					>
						{busy && <Loader2 className="animate-spin" />}
						{custom ? t("settings.accounts.deleteProvider") : t("settings.accounts.resetEndpoint")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ProviderMenu({ provider, actions }: { provider: ProviderInfo; actions: RowActions }) {
	const { t } = useTranslation();
	const custom = provider.origin === "custom";
	// Plugin providers are defined by their plugin; models.json cannot redirect them.
	if (provider.origin === "plugin") return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-xs" aria-label={t("common.actionsFor", { name: provider.name })}>
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={() => actions.edit(provider)}>
					{custom ? t("settings.accounts.editProvider") : t("settings.accounts.editEndpoint")}
				</DropdownMenuItem>
				{(custom || provider.config) && (
					<DropdownMenuItem variant="destructive" onSelect={() => actions.remove(provider)}>
						{custom ? t("settings.accounts.deleteProvider") : t("settings.accounts.resetEndpoint")}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProviderRow({ provider, actions }: { provider: ProviderInfo; actions: RowActions }) {
	const { t } = useTranslation();
	const flows = useSettings((s) => s.flows);
	const login = useSettings((s) => s.login);
	const logout = useSettings((s) => s.logout);
	const [busy, setBusy] = useState(false);
	const flow = latestFlow(flows, provider.id);
	const showFlow = flow && (flow.status === "running" || flow.status === "failed");
	const running = flow?.status === "running";

	return (
		<div className="py-3">
			<div className="flex items-center gap-3">
				<span
					className={cn(
						"size-2 shrink-0 rounded-full",
						provider.auth.configured ? "bg-emerald-500" : "bg-muted-foreground/30",
					)}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">{provider.name}</span>
						{provider.origin === "plugin" && <Badge variant="secondary">{t("settings.accounts.plugin")}</Badge>}
						{provider.origin === "custom" && <Badge variant="secondary">{t("settings.accounts.custom")}</Badge>}
						{provider.origin === "builtin" && provider.config?.baseUrl && (
							<Badge variant="outline" title={provider.config.baseUrl}>
								{t("settings.accounts.customEndpoint")}
							</Badge>
						)}
					</div>
					<div className="text-xs text-muted-foreground">
						{statusText(provider)}
						{provider.auth.configured && provider.modelCount > 0 && (
							<>
								{" · "}
								{t("settings.accounts.modelCount", { count: provider.modelCount })}
							</>
						)}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
					{!running &&
						provider.methods.map((method) => (
							<Button
								key={method.type}
								variant={provider.auth.configured ? "ghost" : "outline"}
								size="xs"
								onClick={() => void login(provider.id, method.type)}
							>
								{method.type === "api_key"
									? provider.stored === "api_key"
										? t("settings.accounts.replaceKey")
										: t("settings.accounts.addKey")
									: provider.stored === "oauth"
										? t("settings.accounts.signInAgain")
										: (method.label ?? t("settings.accounts.signInWith", { name: method.name }))}
							</Button>
						))}
					{provider.stored && !running && (
						<Button
							variant="ghost"
							size="xs"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								await logout(provider.id);
								setBusy(false);
							}}
						>
							{busy && <Loader2 className="animate-spin" />}
							{provider.stored === "oauth" ? t("common.signOut") : t("settings.accounts.removeKey")}
						</Button>
					)}
					{!provider.auth.configured && provider.methods.length === 0 && provider.origin !== "custom" && (
						<span className="text-xs text-muted-foreground">{t("settings.accounts.setupEnvironment")}</span>
					)}
					<ProviderMenu provider={provider} actions={actions} />
				</div>
			</div>
			{showFlow && <FlowPanel flow={flow} />}
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={t("common.copy")}
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			{copied ? <Check /> : <Copy />}
		</Button>
	);
}

/** A login in progress: links and codes from the provider, and the question it waits on. */
function FlowPanel({ flow }: { flow: AuthFlow }) {
	const { t } = useTranslation();
	const cancelFlow = useSettings((s) => s.cancelFlow);
	const dismissFlow = useSettings((s) => s.dismissFlow);
	const running = flow.status === "running";
	// Latest link / code wins; progress shows only its newest message.
	const authUrl = flow.events.findLast((e) => e.type === "auth_url");
	const deviceCode = flow.events.findLast((e) => e.type === "device_code");
	const progress = flow.events.findLast((e) => e.type === "progress");
	const infos = flow.events.filter((e) => e.type === "info");

	return (
		<div className="mt-3 ml-5 space-y-3 rounded-lg bg-muted/50 p-3 text-sm">
			{infos.map((info, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only event list
				<div key={i} className="space-y-1">
					<p className="whitespace-pre-wrap">{info.message}</p>
					{info.links?.map((link) => (
						<a
							key={link.url}
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-3" />
							{link.label ?? link.url}
						</a>
					))}
				</div>
			))}

			{running && deviceCode && (
				<div className="space-y-2">
					<p className="text-muted-foreground">{t("settings.accounts.deviceCode")}</p>
					<div className="flex items-center gap-2">
						<code className="rounded-md border bg-background px-3 py-1.5 font-mono text-lg tracking-widest">
							{deviceCode.userCode}
						</code>
						<CopyButton text={deviceCode.userCode} />
					</div>
					<Button size="sm" asChild>
						<a href={deviceCode.verificationUri} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							{t("settings.accounts.openHost", { host: new URL(deviceCode.verificationUri).host })}
						</a>
					</Button>
				</div>
			)}

			{running && authUrl && !deviceCode && (
				<div className="space-y-2">
					<p className="text-muted-foreground">{authUrl.instructions ?? t("settings.accounts.finishInBrowser")}</p>
					<Button size="sm" asChild>
						<a href={authUrl.url} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							{t("common.openSignIn")}
						</a>
					</Button>
				</div>
			)}

			{running && flow.prompt && <PromptForm key={flow.prompt.id} flowId={flow.flowId} prompt={flow.prompt} />}

			{running && !flow.prompt && (
				<p className="flex items-center gap-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					{progress?.message ??
						(authUrl || deviceCode ? t("settings.accounts.waiting") : t("settings.accounts.starting"))}
				</p>
			)}

			{flow.status === "failed" && (
				<p className="text-xs whitespace-pre-wrap text-destructive">
					{t("settings.accounts.signInFailed", { error: flow.error ?? t("settings.accounts.unknownError") })}
				</p>
			)}

			<div className="flex justify-end">
				{running ? (
					<Button variant="ghost" size="xs" onClick={() => void cancelFlow(flow.flowId)}>
						{t("common.cancel")}
					</Button>
				) : (
					<Button variant="ghost" size="xs" onClick={() => dismissFlow(flow.flowId)}>
						<X />
						{t("settings.accounts.dismiss")}
					</Button>
				)}
			</div>
		</div>
	);
}

function PromptForm({ flowId, prompt }: { flowId: string; prompt: AuthPromptInfo }) {
	const { t } = useTranslation();
	const respondFlow = useSettings((s) => s.respondFlow);
	const [value, setValue] = useState("");
	const [sending, setSending] = useState(false);
	const submit = async (answer: string) => {
		setSending(true);
		await respondFlow(flowId, prompt.id, answer);
		setSending(false);
	};

	if (prompt.type === "select") {
		return (
			<div className="space-y-2">
				<p>{prompt.message}</p>
				<div className="space-y-1">
					{prompt.options?.map((option) => (
						<button
							key={option.id}
							type="button"
							disabled={sending}
							onClick={() => void submit(option.id)}
							className="block w-full rounded-md border bg-background px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
						>
							<div>{option.label}</div>
							{option.description && <div className="text-xs text-muted-foreground">{option.description}</div>}
						</button>
					))}
				</div>
			</div>
		);
	}

	return (
		<form
			className="space-y-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (value.trim()) void submit(value.trim());
			}}
		>
			<label htmlFor={`prompt-${prompt.id}`} className="block whitespace-pre-wrap">
				{prompt.message}
			</label>
			<div className="flex gap-2">
				<Input
					id={`prompt-${prompt.id}`}
					type={prompt.type === "secret" ? "password" : "text"}
					autoComplete="off"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
					}}
					placeholder={prompt.placeholder ?? (prompt.type === "manual_code" ? t("settings.accounts.pasteCode") : "")}
					className="h-8 flex-1 bg-background font-mono text-xs"
					autoFocus
				/>
				<Button type="submit" size="sm" disabled={!value.trim() || sending}>
					{sending && <Loader2 className="animate-spin" />}
					{prompt.type === "secret" ? t("common.save") : t("settings.accounts.continue")}
				</Button>
			</div>
		</form>
	);
}
