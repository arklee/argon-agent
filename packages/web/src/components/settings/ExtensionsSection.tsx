import type { ExtensionInfo, ExtensionsStatus } from "@argon/shared";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Group, Loading } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getClient, useApp } from "@/stores/app";

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
	const row = (item: ExtensionInfo) => (
		<div key={item.id} className="flex items-center gap-3 py-3">
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
					disabled={busy}
					aria-label={t("settings.extensions.removeName", { name: item.name })}
					onClick={() => setRemoving(item)}
				>
					<Trash2 />
				</Button>
			)}
		</div>
	);

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
			{removing && (
				<div role="alert" className="space-y-2 rounded-md border p-3">
					<p className="text-sm">{t("settings.extensions.confirmRemove", { name: removing.name })}</p>
					<p className="text-xs text-muted-foreground">{t("settings.extensions.removeDescription")}</p>
					<div className="flex gap-2">
						<Button
							variant="destructive"
							size="sm"
							disabled={busy}
							onClick={() => void change(() => getClient().request("extensions.remove", { id: removing.id }))}
						>
							{t("settings.extensions.remove")}
						</Button>
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(undefined)}>
							{t("settings.extensions.cancel")}
						</Button>
					</div>
				</div>
			)}
			{status && (
				<>
					<Group title={t("settings.extensions.builtin")}>{status.items.filter((i) => i.builtin).map(row)}</Group>
					<Group title={t("settings.extensions.user")}>
						{status.items.filter((i) => !i.builtin).map(row)}
						{!status.items.some((i) => !i.builtin) && (
							<p className="py-3 text-sm text-muted-foreground">{t("settings.extensions.empty")}</p>
						)}
					</Group>
				</>
			)}
			<p className="text-xs text-muted-foreground">{t("settings.extensions.protected")}</p>
		</div>
	);
}
