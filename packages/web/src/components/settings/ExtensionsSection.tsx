import type { ExtensionInfo, ExtensionsStatus } from "@argon/shared";
import { RefreshCw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Choice, Group, Loading, Row } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getClient, useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";

/** Built-in extensions the "OpenAI features" setting turns on and off (backend openai-features.ts). */
const OPENAI_EXTENSIONS = ["builtin:codex-compact", "builtin:codex-web-run", "builtin:codex-imagegen"];

export function ExtensionsSection() {
	const { t } = useTranslation();
	const connection = useApp((s) => s.connection);
	const [status, setStatus] = useState<ExtensionsStatus>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [removing, setRemoving] = useState<ExtensionInfo>();
	const [revision, setRevision] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refreshes must restart the request and cancel stale responses.
	useEffect(() => {
		if (connection?.status !== "connected") return;
		const client = getClient();
		let active = true;
		let sequence = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const refresh = async () => {
			const request = ++sequence;
			clearTimeout(timer);
			try {
				const next = await client.request("extensions.list", {});
				if (!active || request !== sequence) return;
				setStatus(next);
				setError(undefined);
				if (next.pendingSessions.length) timer = setTimeout(() => void refresh(), 2000);
			} catch (error) {
				if (active && request === sequence) setError(String(error));
			}
		};
		void refresh();
		const unsubscribe = client.onGlobalEvent((event) => {
			if (event.type === "extensions_changed") void refresh();
		});
		return () => {
			active = false;
			clearTimeout(timer);
			unsubscribe();
		};
	}, [connection, revision]);

	const change = async (action: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await action();
			setRemoving(undefined);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setBusy(false);
			setRevision((r) => r + 1);
		}
	};
	const argon = useSettings((s) => s.settings?.argon);
	const updateArgon = useSettings((s) => s.updateArgon);

	/** Argon's settings for its own built-in extensions, shown under the extension they configure. */
	const subSetting = (item: ExtensionInfo) =>
		argon && item.id === "builtin:apply-patch" ? (
			<SubSetting
				disabled={!item.enabled}
				label={t("settings.general.gptApplyPatch")}
				description={t("settings.general.gptApplyPatchDescription")}
			>
				<Switch
					checked={argon.gptApplyPatch}
					disabled={!item.enabled}
					aria-label={t("settings.general.gptApplyPatch")}
					onCheckedChange={(gptApplyPatch) => void updateArgon({ gptApplyPatch })}
				/>
			</SubSetting>
		) : null;

	const row = (item: ExtensionInfo) => (
		<div key={item.id} className="py-3">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-sm">{item.name}</div>
					<div className="truncate font-mono text-xs text-muted-foreground" title={item.path}>
						{item.path}
					</div>
					{!item.builtin && <div className="truncate text-xs text-muted-foreground">{item.source}</div>}
				</div>
				<Switch
					checked={item.enabled}
					disabled={busy}
					aria-label={t("settings.extensions.enable", { name: item.name })}
					onCheckedChange={(enabled) =>
						void change(() => getClient().request("extensions.setEnabled", { id: item.id, enabled }))
					}
				/>
				{!item.builtin && (
					<Button
						variant="ghost"
						size="icon-xs"
						disabled={busy || removing?.id === item.id}
						aria-label={t("settings.extensions.removeName", { name: item.name })}
						onClick={() => setRemoving(item)}
					>
						<Trash2 />
					</Button>
				)}
			</div>
			{subSetting(item)}
			{removing?.id === item.id && (
				<div role="alert" className="mt-3 space-y-2 rounded-md bg-muted/60 p-3">
					<p className="text-sm">{t("settings.extensions.confirmRemove", { name: item.name })}</p>
					<p className="text-xs text-muted-foreground">{t("settings.extensions.removeDescription")}</p>
					<div className="flex gap-2">
						<Button
							variant="destructive"
							size="sm"
							disabled={busy}
							onClick={() => void change(() => getClient().request("extensions.remove", { id: item.id }))}
						>
							{t("settings.extensions.remove")}
						</Button>
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(undefined)}>
							{t("settings.extensions.cancel")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);

	const builtins = status?.items.filter((i) => i.builtin) ?? [];
	const openai = builtins.filter((i) => OPENAI_EXTENSIONS.includes(i.id));
	const users = status?.items.filter((i) => !i.builtin) ?? [];

	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground">{t("settings.extensions.scope")}</p>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => void change(() => getClient().request("extensions.reload", {}))}
				>
					<RefreshCw />
					{t("settings.extensions.reload")}
				</Button>
				<Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevision((r) => r + 1)}>
					{t("settings.extensions.refresh")}
				</Button>
			</div>
			{!status && !error && <Loading />}
			{!!status?.pendingSessions.length && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("settings.extensions.pending", { count: status.pendingSessions.length })}
				</p>
			)}
			{status?.warnings.map((warning) => (
				<p key={warning} className="text-xs text-destructive">
					{warning}
				</p>
			))}
			{status && (
				<>
					<Group title={t("settings.extensions.builtin")}>
						{builtins.filter((i) => !OPENAI_EXTENSIONS.includes(i.id)).map(row)}
					</Group>
					{openai.length > 0 && (
						<Group title={t("settings.extensions.openai")}>
							{argon && (
								<Row
									label={t("settings.general.openaiFeatures")}
									description={
										openai.some((i) => i.enabled)
											? t("settings.general.openaiFeaturesDescription")
											: t("settings.extensions.openaiAllDisabled")
									}
								>
									<Choice
										value={argon.openaiFeatures}
										ariaLabel={t("settings.general.openaiFeatures")}
										disabled={!openai.some((i) => i.enabled)}
										options={[
											{ value: "off", label: t("settings.general.openaiFeaturesOff") },
											{ value: "on", label: t("settings.general.openaiFeaturesOn") },
											{ value: "openai", label: t("settings.general.openaiFeaturesAuto") },
										]}
										onChange={(openaiFeatures) => void updateArgon({ openaiFeatures })}
									/>
								</Row>
							)}
							{openai.map(row)}
						</Group>
					)}
					<Group title={t("settings.extensions.user")}>
						{users.map(row)}
						{users.length === 0 && (
							<p className="py-3 text-sm text-muted-foreground">{t("settings.extensions.empty")}</p>
						)}
					</Group>
				</>
			)}
			<p className="text-xs text-muted-foreground">{t("settings.extensions.protected")}</p>
		</div>
	);
}

/** A setting of the extension above it; dimmed, with a note, while that extension is off. */
function SubSetting({
	label,
	description,
	disabled,
	children,
}: {
	label: string;
	description: string;
	disabled: boolean;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<div className="mt-3 flex items-center justify-between gap-6 rounded-md bg-muted/60 px-3 py-2.5">
			<div className={cn("min-w-0", disabled && "opacity-60")}>
				<div className="text-sm">{label}</div>
				<div className="mt-0.5 text-xs text-muted-foreground">
					{disabled ? t("settings.extensions.settingDisabled") : description}
				</div>
			</div>
			<div className="flex shrink-0 items-center">{children}</div>
		</div>
	);
}
