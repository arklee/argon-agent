import type { PluginsStatus } from "@argon/shared";
import { Loader2, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Loading, Row } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/stores/settings";

const MIRROR_PRESETS = ["github", "npmmirror", "npmmirror-cdn"] as const;
type MirrorChoice = (typeof MIRROR_PRESETS)[number] | "custom";

function megabytes(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(1);
}

/** Bun download source: a preset or a custom HTTPS base URL (validated by the backend). */
function MirrorPicker({
	status,
	value,
	onChange,
}: {
	status: PluginsStatus;
	value: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslation();
	const preset = (MIRROR_PRESETS as readonly string[]).includes(value);
	const [choice, setChoice] = useState<MirrorChoice>(preset ? (value as MirrorChoice) : "custom");
	const labels: Record<MirrorChoice, string> = {
		github: t("settings.plugins.mirrorGithub"),
		npmmirror: t("settings.plugins.mirrorNpmmirror"),
		"npmmirror-cdn": t("settings.plugins.mirrorNpmmirrorCdn"),
		custom: t("settings.plugins.mirrorCustom"),
	};
	if (status.bunMirrorEnv !== undefined) {
		return (
			<Row label={t("settings.plugins.mirror")} description={t("settings.plugins.mirrorDescription")}>
				<span className="font-mono text-xs text-muted-foreground" title={t("settings.plugins.mirrorEnv")}>
					ARGON_BUN_MIRROR={status.bunMirrorEnv}
				</span>
			</Row>
		);
	}
	return (
		<div className="py-3">
			<div className="flex items-center justify-between gap-6">
				<div className="min-w-0">
					<div className="text-sm">{t("settings.plugins.mirror")}</div>
					<div className="mt-0.5 text-xs text-muted-foreground">{t("settings.plugins.mirrorDescription")}</div>
				</div>
				<Select
					value={choice}
					onValueChange={(next) => {
						setChoice(next as MirrorChoice);
						onChange(next === "custom" ? "" : next);
					}}
				>
					<SelectTrigger size="sm" className="w-40 shrink-0" aria-label={t("settings.plugins.mirror")}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent position="popper" align="end">
						{([...MIRROR_PRESETS, "custom"] as const).map((id) => (
							<SelectItem key={id} value={id}>
								{labels[id]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{choice === "custom" && (
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="https://mirror.example.com/bun"
					className="mt-2 h-8 font-mono text-xs"
					spellCheck={false}
				/>
			)}
		</div>
	);
}

/**
 * The on/off switch for community plugins. Turning them on the first time downloads Bun, which the
 * plugin host needs, on the backend machine; progress and failures arrive as `plugins_status` events.
 */
function RuntimeGroup({ status }: { status: PluginsStatus }) {
	const { t } = useTranslation();
	const enablePlugins = useSettings((s) => s.enablePlugins);
	const disablePlugins = useSettings((s) => s.disablePlugins);
	const [mirror, setMirror] = useState(status.bunMirror);
	const [busy, setBusy] = useState(false);
	const { runtime, enabled } = status;
	const version = status.bunVersion;
	const preparing = runtime.state === "preparing";
	const needsDownload = runtime.state === "missing" || runtime.state === "failed";
	const act = async (action: () => Promise<void>) => {
		setBusy(true);
		await action();
		setBusy(false);
	};
	const enable = () => act(() => enablePlugins(status.bunMirrorEnv === undefined ? mirror.trim() : undefined));

	let description: string;
	if (preparing) description = t("settings.plugins.statusPreparing", { version });
	else if (runtime.state === "failed") description = t("settings.plugins.statusFailed", { version });
	else if (!enabled)
		description = needsDownload
			? t("settings.plugins.statusOffDownload", { version })
			: t("settings.plugins.statusOff");
	else description = t("settings.plugins.statusReady", { version });

	return (
		<Group title={t("settings.plugins.runtime")}>
			<Row label={t("settings.plugins.enabledLabel")} description={description}>
				{enabled ? (
					<Button variant="outline" size="xs" disabled={busy} onClick={() => void act(disablePlugins)}>
						{t("settings.plugins.disable")}
					</Button>
				) : (
					<Button
						size="xs"
						disabled={busy || preparing || (needsDownload && !mirror.trim() && !status.bunMirrorEnv)}
						onClick={() => void enable()}
					>
						{busy && <Loader2 className="animate-spin" />}
						{t("settings.plugins.enable")}
					</Button>
				)}
			</Row>
			{preparing && (
				<div className="py-3">
					<div className="h-1.5 overflow-hidden rounded-full bg-muted">
						{runtime.total ? (
							<div
								className="h-full rounded-full bg-primary transition-[width]"
								style={{ width: `${Math.min(100, ((runtime.received ?? 0) / runtime.total) * 100)}%` }}
							/>
						) : (
							<div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
						)}
					</div>
					<div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
						{runtime.total
							? t("settings.plugins.progress", {
									received: megabytes(runtime.received ?? 0),
									total: megabytes(runtime.total),
								})
							: t("settings.plugins.progressUnknown", { received: megabytes(runtime.received ?? 0) })}
					</div>
				</div>
			)}
			{runtime.state === "failed" && runtime.error && (
				<pre className="my-3 rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{runtime.error}
				</pre>
			)}
			{needsDownload && !preparing && <MirrorPicker status={status} value={mirror} onChange={setMirror} />}
			{enabled && runtime.state === "failed" && (
				<div className="flex justify-end py-3">
					<Button size="xs" disabled={busy || (!mirror.trim() && !status.bunMirrorEnv)} onClick={() => void enable()}>
						{busy && <Loader2 className="animate-spin" />}
						{t("settings.plugins.retry")}
					</Button>
				</div>
			)}
		</Group>
	);
}

type SearchResult = { name: string; version: string; description?: string };

/**
 * Install / remove with a second click to confirm: plugins run on the backend machine with the
 * backend user's privileges, so `plugins.change` requires the user to have confirmed.
 */
function ChangeButton({ action, spec }: { action: "install" | "remove"; spec: string }) {
	const { t } = useTranslation();
	const changePlugin = useSettings((s) => s.changePlugin);
	const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
	const label = action === "install" ? t("settings.plugins.install") : t("settings.plugins.remove");
	if (state === "confirm") {
		return (
			<div className="flex items-center gap-1.5">
				<Button variant="ghost" size="xs" onClick={() => setState("idle")}>
					{t("common.cancel")}
				</Button>
				<Button
					variant={action === "install" ? "default" : "destructive"}
					size="xs"
					onClick={async () => {
						setState("busy");
						await changePlugin(action, spec);
						setState("idle");
					}}
				>
					{action === "install" ? t("settings.plugins.confirmInstall") : t("settings.plugins.confirmRemove")}
				</Button>
			</div>
		);
	}
	return (
		<Button variant="outline" size="xs" disabled={state === "busy"} onClick={() => setState("confirm")}>
			{state === "busy" && <Loader2 className="animate-spin" />}
			{label}
		</Button>
	);
}

export function PluginsSection() {
	const { t } = useTranslation();
	const plugins = useSettings((s) => s.plugins);
	const searchPlugins = useSettings((s) => s.searchPlugins);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>();
	const [searching, setSearching] = useState(false);
	if (!plugins) return <Loading />;
	if (!plugins.available) {
		return <p className="py-8 text-center text-sm text-muted-foreground">{t("settings.plugins.unavailable")}</p>;
	}
	const isInstalled = (name: string) =>
		plugins.plugins.some((p) => p.spec === name || p.spec.startsWith(`${name}@`) || p.spec.startsWith(`npm:${name}`));
	const search = async () => {
		if (!query.trim()) return;
		setSearching(true);
		setResults(await searchPlugins(query.trim()));
		setSearching(false);
	};

	const { status } = plugins;
	const warning = (
		<div className="mb-6 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
			<TriangleAlert className="size-4 shrink-0" />
			<p>{t("settings.plugins.warning")}</p>
		</div>
	);
	// Plugins are managed only once they are on and Bun is ready (`plugins.change` requires both).
	if (status && !(status.enabled && status.runtime.state === "ready")) {
		return (
			<>
				{warning}
				<RuntimeGroup status={status} />
			</>
		);
	}

	return (
		<>
			{warning}
			{status && <RuntimeGroup status={status} />}

			{plugins.errors.length > 0 && (
				<pre className="mb-4 rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{plugins.errors.join("\n")}
				</pre>
			)}

			<Group title={t("settings.plugins.installed")}>
				{plugins.plugins.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">{t("settings.plugins.noInstalled")}</p>
				) : (
					plugins.plugins.map((plugin) => (
						<div key={plugin.spec} className="flex items-center gap-3 py-2.5">
							<span className="min-w-0 flex-1 truncate font-mono text-sm" title={plugin.spec}>
								{plugin.spec}
							</span>
							{plugin.managed ? (
								<ChangeButton action="remove" spec={plugin.spec} />
							) : (
								<Badge variant="secondary" title={t("settings.plugins.manualDescription")}>
									{t("settings.plugins.manual")}
								</Badge>
							)}
						</div>
					))
				)}
			</Group>

			<Group title={t("settings.plugins.find")}>
				<form
					className="flex gap-2 py-3"
					onSubmit={(e) => {
						e.preventDefault();
						void search();
					}}
				>
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
							}}
							placeholder={t("settings.plugins.searchPlaceholder")}
							className="h-8 pl-8"
						/>
					</div>
					<Button type="submit" size="sm" variant="outline" disabled={!query.trim() || searching}>
						{searching && <Loader2 className="animate-spin" />}
						{t("settings.plugins.search")}
					</Button>
				</form>
				{results?.length === 0 && (
					<p className="pb-3 text-sm text-muted-foreground">{t("settings.plugins.noResults")}</p>
				)}
				{results?.map((result) => (
					<div key={result.name} className="flex items-center gap-3 py-2.5">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">
								<span className="font-mono">{result.name}</span>
								<span className="ml-2 text-xs text-muted-foreground">{result.version}</span>
							</div>
							{result.description && (
								<div className="truncate text-xs text-muted-foreground" title={result.description}>
									{result.description}
								</div>
							)}
						</div>
						{isInstalled(result.name) ? (
							<Badge variant="secondary">{t("settings.plugins.installed")}</Badge>
						) : (
							<ChangeButton action="install" spec={result.name} />
						)}
					</div>
				))}
			</Group>
		</>
	);
}
