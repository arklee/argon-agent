import type { McpExposure, McpServerStatus, McpStatus } from "@argon/shared";
import { ChevronRight, Loader2, Plug } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

const EXPOSURES: { value: McpExposure; label: string; description: string }[] = [
	{ value: "codemode", label: "codemode", description: "Callable from codemode scripts only" },
	{ value: "deferred", label: "deferred", description: "Loaded on demand via tool_search" },
	{ value: "direct", label: "direct", description: "Declared to the model right away" },
	{ value: "hidden", label: "hidden", description: "Not reachable" },
];

type Tone = "ok" | "busy" | "attention" | "off";

function toneOf(server: McpServerStatus): Tone {
	switch (server.state) {
		case "connected":
			return "ok";
		case "disabled":
			return "off";
		case "needs-auth":
		case "failed":
			return "attention";
		default:
			return "busy";
	}
}

const STATE_LABELS: Record<string, string> = {
	connected: "Connected",
	disabled: "Disabled",
	"needs-auth": "Needs sign-in",
	failed: "Failed",
	starting: "Starting",
	connecting: "Connecting",
	disconnected: "Disconnected",
};

const DOT: Record<Tone, string> = {
	ok: "bg-emerald-500",
	busy: "bg-amber-500 animate-pulse",
	attention: "bg-red-500",
	off: "bg-muted-foreground/40",
};

function overallTone(mcp: McpStatus): Tone {
	const tones = mcp.servers.map(toneOf);
	if (mcp.configErrors.length > 0 || tones.includes("attention")) return "attention";
	if (tones.includes("busy")) return "busy";
	if (tones.includes("ok")) return "ok";
	return "off";
}

function ServerRow({ server }: { server: McpServerStatus }) {
	const mcpAction = useApp((s) => s.mcpAction);
	const [busy, setBusy] = useState<string>();
	const tone = toneOf(server);
	const run = async (action: Parameters<typeof mcpAction>[1], exposure?: McpExposure) => {
		setBusy(action);
		try {
			await mcpAction(server.name, action, exposure);
		} finally {
			setBusy(undefined);
		}
	};
	const action = (name: Parameters<typeof mcpAction>[1], label: string, variant: "outline" | "ghost" = "outline") => (
		<Button variant={variant} size="xs" disabled={busy !== undefined} onClick={() => void run(name)}>
			{busy === name && <Loader2 className="animate-spin" />}
			{label}
		</Button>
	);
	const problem = server.state === "connected" ? server.message : (server.error ?? server.message);

	return (
		<div className="min-w-0 rounded-lg border p-3">
			<div className="flex items-center gap-2">
				<span className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
				<span className="min-w-0 truncate font-medium">{server.name}</span>
				<Badge variant={tone === "attention" ? "destructive" : "secondary"}>
					{STATE_LABELS[server.state] ?? server.state}
				</Badge>
				{server.state === "connected" && (
					<span className="text-xs text-muted-foreground">
						{server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
						{server.hasResources ? " · resources" : ""}
					</span>
				)}
				<div className="flex-1" />
				<Select
					value={server.exposure}
					onValueChange={(v) => void run("exposure", v as McpExposure)}
					disabled={busy !== undefined}
				>
					<SelectTrigger size="sm" className="h-7 text-xs" title="How the model reaches this server's tools">
						<SelectValue>{server.exposure}</SelectValue>
					</SelectTrigger>
					<SelectContent position="popper" align="end">
						{EXPOSURES.map((e) => (
							<SelectItem key={e.value} value={e.value}>
								<div>
									<div>{e.label}</div>
									<div className="text-xs text-muted-foreground">{e.description}</div>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={server.transport}>
				{server.transport}
			</div>
			<div className="truncate text-xs text-muted-foreground" title={server.source}>
				{server.scope === "extension" ? "Registered by " : "From "}
				{server.source}
			</div>

			{problem && (
				<pre className="mt-2 max-h-32 overflow-auto rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{problem}
				</pre>
			)}

			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{server.state === "needs-auth" && action("signin", "Sign in")}
				{server.enabled && server.state !== "needs-auth" && action("reconnect", "Reconnect")}
				{server.oauth && server.state === "connected" && action("signout", "Sign out", "ghost")}
				{server.enabled ? action("disable", "Disable", "ghost") : action("enable", "Enable")}
			</div>

			{server.tools.length > 0 && (
				<Collapsible className="mt-2">
					<CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
						<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
						Tools
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ul className="mt-1 space-y-1">
							{server.tools.map((tool) => (
								<li key={tool.name} className="text-xs">
									<span className="font-mono">{tool.name}</span>
									{tool.description && (
										<span className="text-muted-foreground"> — {tool.description.split("\n")[0]}</span>
									)}
								</li>
							))}
						</ul>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

/** Header button + dialog with the session's MCP servers. Hidden when the session has none. */
/** Whether the panel has anything to show (`/mcp` falls back to pi's text status otherwise). */
export function hasMcpPanel(mcp: McpStatus | undefined): mcp is McpStatus {
	return mcp !== undefined && (mcp.servers.length > 0 || mcp.configErrors.length > 0);
}

export function McpPanel({ mcp }: { mcp: McpStatus | undefined }) {
	const open = useApp((s) => s.mcpPanelOpen);
	const setOpen = useApp((s) => s.setMcpPanelOpen);
	if (!hasMcpPanel(mcp)) return null;
	const tone = overallTone(mcp);
	const connected = mcp.servers.filter((s) => s.state === "connected").length;
	const enabled = mcp.servers.filter((s) => s.enabled).length;
	const notices = [...mcp.configErrors.map((e) => `Config: ${e}`), ...mcp.overridden.map((o) => `Overridden: ${o}`)];

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" className="text-muted-foreground" title="MCP servers">
					<span className="relative">
						<Plug />
						<span className={cn("absolute -top-0.5 -right-0.5 size-1.5 rounded-full", DOT[tone])} />
					</span>
					MCP {connected}/{enabled}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>MCP servers</DialogTitle>
					<DialogDescription>
						Servers loaded for this session. Enabling, disabling and exposure changes are saved to the server's
						mcp.json.
					</DialogDescription>
				</DialogHeader>
				{notices.length > 0 && (
					<pre className="min-w-0 rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
						{notices.join("\n")}
					</pre>
				)}
				<div className="min-w-0 space-y-2">
					{mcp.servers.map((server) => (
						<ServerRow key={server.name} server={server} />
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
