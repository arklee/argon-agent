import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { ChatView } from "@/components/ChatView";
import { ConnectScreen } from "@/components/ConnectScreen";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Sidebar, SidebarToggle } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Welcome } from "@/components/Welcome";
import { type ConnectionConfig, readConnectionConfig, saveConnectionConfig } from "@/lib/connection";
import { shortcutLabels, useGlobalShortcuts } from "@/lib/shortcuts";
import { useResolvedTheme } from "@/lib/theme";
import { useActiveSession, useApp } from "@/stores/app";

export function App() {
	const theme = useResolvedTheme();
	return (
		<TooltipProvider delayDuration={300}>
			<div className="window-drag-strip" aria-hidden="true" />
			<Shell />
			<Toaster position="top-center" theme={theme} />
		</TooltipProvider>
	);
}

function Shell() {
	const [config, setConfig] = useState<ConnectionConfig | undefined>(() => readConnectionConfig());
	const connect = useApp((s) => s.connect);
	const disconnect = useApp((s) => s.disconnect);
	const connection = useApp((s) => s.connection);
	const active = useActiveSession();

	// Opening a new `#token=` link in an already loaded tab only changes the hash.
	useEffect(() => {
		const onHashChange = () => {
			const next = readConnectionConfig();
			if (next) setConfig(next);
		};
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	useEffect(() => {
		if (!config) return;
		connect(config);
		return () => disconnect();
	}, [config, connect, disconnect]);

	if (!config || connection?.status === "failed") {
		return (
			<ConnectScreen
				error={connection?.status === "failed" ? connection.error.message : undefined}
				onConnect={(next) => {
					saveConnectionConfig(next);
					setConfig({ ...next });
				}}
			/>
		);
	}

	return (
		<div className="flex h-full">
			<KeyboardShortcuts />
			<SettingsDialog />
			<AddProjectDialog />
			<SidebarToggle />
			<Sidebar />
			<main className="window-workspace flex min-w-0 flex-1 flex-col">
				{(connection?.status === "disconnected" || (connection?.status === "connecting" && connection.attempt > 0)) && (
					<div className="window-offline-banner">
						<OfflineBanner
							key={connection.status}
							retryInMs={connection.status === "disconnected" ? connection.retryInMs : undefined}
						/>
					</div>
				)}
				{active ? <ChatView session={active} /> : <Welcome />}
			</main>
		</div>
	);
}

function KeyboardShortcuts() {
	const { t } = useTranslation();
	const { helpOpen, setHelpOpen } = useGlobalShortcuts();
	return (
		<Dialog open={helpOpen} onOpenChange={setHelpOpen}>
			<DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
				<DialogTitle>{t("shortcuts.title")}</DialogTitle>
				<dl className="space-y-2 text-sm">
					{[
						[t("common.newSession"), shortcutLabels.newSession],
						[t("shortcuts.switchSession"), shortcutLabels.switchSession],
						[t("shortcuts.toggleSidebar"), shortcutLabels.toggleSidebar],
						[t("shortcuts.stop"), "Esc"],
						[t("shortcuts.focus"), shortcutLabels.focus],
						[t("settings.title"), shortcutLabels.settings],
						[t("shortcuts.type"), t("shortcuts.printable")],
						[t("shortcuts.title"), "?"],
					].map(([label, keys]) => (
						<div key={label} className="flex justify-between gap-3">
							<dt>{label}</dt>
							<dd>
								<kbd>{keys}</kbd>
							</dd>
						</div>
					))}
				</dl>
			</DialogContent>
		</Dialog>
	);
}
