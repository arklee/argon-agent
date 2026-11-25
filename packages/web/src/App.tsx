import { useEffect, useState } from "react";
import { ChatView } from "@/components/ChatView";
import { ConnectScreen } from "@/components/ConnectScreen";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Welcome } from "@/components/Welcome";
import { type ConnectionConfig, readConnectionConfig, saveConnectionConfig } from "@/lib/connection";
import { useSystemTheme } from "@/lib/theme";
import { useActiveSession, useApp } from "@/stores/app";

export function App() {
	useSystemTheme();
	return (
		<TooltipProvider delayDuration={300}>
			<Shell />
			<Toaster position="top-center" />
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
			<Sidebar />
			<main className="flex min-w-0 flex-1 flex-col">{active ? <ChatView session={active} /> : <Welcome />}</main>
		</div>
	);
}
