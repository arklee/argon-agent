import type { AuthFlow, AuthPromptInfo, ProviderInfo } from "@argon/shared";
import { Check, Copy, ExternalLink, Loader2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Group, Loading } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { latestFlow, useSettings } from "@/stores/settings";

export function AccountsSection() {
	const providers = useSettings((s) => s.providers);
	const [query, setQuery] = useState("");
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
			<div className="relative mb-4">
				<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search providers"
					className="h-8 pl-8"
				/>
			</div>
			{connected.length > 0 && (
				<Group title="Connected">
					{connected.map((p) => (
						<ProviderRow key={p.id} provider={p} />
					))}
				</Group>
			)}
			{others.length > 0 && (
				<Group title={connected.length > 0 ? "Other providers" : "Providers"}>
					{others.map((p) => (
						<ProviderRow key={p.id} provider={p} />
					))}
				</Group>
			)}
			{filtered.length === 0 && (
				<p className="py-8 text-center text-sm text-muted-foreground">No providers match “{query}”.</p>
			)}
		</>
	);
}

function statusText(provider: ProviderInfo): string {
	if (!provider.auth.configured) return "Not connected";
	if (provider.stored === "oauth") return "Signed in";
	if (provider.stored === "api_key") return "API key saved";
	return provider.auth.label ? `From ${provider.auth.label}` : "Configured by the environment";
}

function ProviderRow({ provider }: { provider: ProviderInfo }) {
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
						{provider.origin === "plugin" && <Badge variant="secondary">Plugin</Badge>}
					</div>
					<div className="text-xs text-muted-foreground">
						{statusText(provider)}
						{provider.auth.configured && provider.modelCount > 0 && (
							<>
								{" · "}
								{provider.modelCount} model{provider.modelCount === 1 ? "" : "s"}
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
										? "Replace key"
										: "Add API key"
									: provider.stored === "oauth"
										? "Sign in again"
										: (method.label ?? `Sign in with ${method.name}`)}
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
							{provider.stored === "oauth" ? "Sign out" : "Remove key"}
						</Button>
					)}
					{!provider.auth.configured && provider.methods.length === 0 && (
						<span className="text-xs text-muted-foreground">Set up through environment variables</span>
					)}
				</div>
			</div>
			{showFlow && <FlowPanel flow={flow} />}
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label="Copy"
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
					<p className="text-muted-foreground">Enter this code on the sign-in page:</p>
					<div className="flex items-center gap-2">
						<code className="rounded-md border bg-background px-3 py-1.5 font-mono text-lg tracking-widest">
							{deviceCode.userCode}
						</code>
						<CopyButton text={deviceCode.userCode} />
					</div>
					<Button size="sm" asChild>
						<a href={deviceCode.verificationUri} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							Open {new URL(deviceCode.verificationUri).host}
						</a>
					</Button>
				</div>
			)}

			{running && authUrl && !deviceCode && (
				<div className="space-y-2">
					<p className="text-muted-foreground">
						{authUrl.instructions ?? "Finish signing in in your browser, then come back here."}
					</p>
					<Button size="sm" asChild>
						<a href={authUrl.url} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							Open sign-in page
						</a>
					</Button>
				</div>
			)}

			{running && flow.prompt && <PromptForm key={flow.prompt.id} flowId={flow.flowId} prompt={flow.prompt} />}

			{running && !flow.prompt && (
				<p className="flex items-center gap-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					{progress?.message ?? (authUrl || deviceCode ? "Waiting for the provider…" : "Starting…")}
				</p>
			)}

			{flow.status === "failed" && (
				<p className="text-xs whitespace-pre-wrap text-destructive">Sign-in failed: {flow.error ?? "unknown error"}</p>
			)}

			<div className="flex justify-end">
				{running ? (
					<Button variant="ghost" size="xs" onClick={() => void cancelFlow(flow.flowId)}>
						Cancel
					</Button>
				) : (
					<Button variant="ghost" size="xs" onClick={() => dismissFlow(flow.flowId)}>
						<X />
						Dismiss
					</Button>
				)}
			</div>
		</div>
	);
}

function PromptForm({ flowId, prompt }: { flowId: string; prompt: AuthPromptInfo }) {
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
					placeholder={prompt.placeholder ?? (prompt.type === "manual_code" ? "Paste the code or redirect URL" : "")}
					className="h-8 flex-1 bg-background font-mono text-xs"
					autoFocus
				/>
				<Button type="submit" size="sm" disabled={!value.trim() || sending}>
					{sending && <Loader2 className="animate-spin" />}
					{prompt.type === "secret" ? "Save" : "Continue"}
				</Button>
			</div>
		</form>
	);
}
