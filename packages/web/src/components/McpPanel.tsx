import type { McpExposure, McpServerStatus, McpStatus } from "@argon/shared";
import { ChevronRight, Loader2, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toolbarButton } from "@/components/SessionControls";
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
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { openSettings } from "@/stores/settings";

const EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const satisfies readonly McpExposure[];

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

const STATE_LABELS = new Map<
	string,
	`mcp.${"connected" | "disabled" | "needsAuth" | "failed" | "starting" | "connecting" | "disconnected"}`
>([
	["connected", "mcp.connected"],
	["disabled", "mcp.disabled"],
	["needs-auth", "mcp.needsAuth"],
	["failed", "mcp.failed"],
	["starting", "mcp.starting"],
	["connecting", "mcp.connecting"],
	["disconnected", "mcp.disconnected"],
]);

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
	const { t } = useTranslation();
	const mcpAction = useApp((s) => s.mcpAction);
	const [busy, setBusy] = useState<string>();
	const tone = toneOf(server);
	const stateLabel = STATE_LABELS.get(server.state);
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
					{stateLabel ? t(stateLabel) : server.state}
				</Badge>
				{server.state === "connected" && (
					<span className="text-xs text-muted-foreground">
						{t(server.hasResources ? "mcp.toolsWithResources" : "mcp.toolCount", { count: server.tools.length })}
					</span>
				)}
				<div className="flex-1" />
				<Select
					value={server.exposure}
					onValueChange={(v) => void run("exposure", v as McpExposure)}
					disabled={busy !== undefined}
				>
					<SelectTrigger size="sm" className="h-7 text-xs" title={t("mcp.exposure")}>
						<SelectValue>{t(`mcp.exposureOptions.${server.exposure}.label`)}</SelectValue>
					</SelectTrigger>
					<SelectContent position="popper" align="end">
						{EXPOSURES.map((e) => (
							<SelectItem key={e} value={e}>
								<div>
									<div>{t(`mcp.exposureOptions.${e}.label`)}</div>
									<div className="text-xs text-muted-foreground">{t(`mcp.exposureOptions.${e}.description`)}</div>
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
				{t(server.scope === "extension" ? "mcp.registeredBy" : "mcp.from", { source: server.source })}
			</div>

			{problem && (
				<pre className="mt-2 max-h-32 overflow-auto rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{problem}
				</pre>
			)}

			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{server.state === "needs-auth" && action("signin", t("mcp.signIn"))}
				{server.enabled && server.state !== "needs-auth" && action("reconnect", t("mcp.reconnect"))}
				{server.oauth && server.state === "connected" && action("signout", t("common.signOut"), "ghost")}
				{server.enabled ? action("disable", t("mcp.disable"), "ghost") : action("enable", t("mcp.enable"))}
			</div>

			{server.tools.length > 0 && (
				<Collapsible className="mt-2">
					<CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
						<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
						{t("mcp.tools")}
					</CollapsibleTrigger>
					<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
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
	const { t } = useTranslation();
	const open = useApp((s) => s.mcpPanelOpen);
	const setOpen = useApp((s) => s.setMcpPanelOpen);
	if (!hasMcpPanel(mcp)) return null;
	const tone = overallTone(mcp);
	const connected = mcp.servers.filter((s) => s.state === "connected").length;
	const enabled = mcp.servers.filter((s) => s.enabled).length;
	const notices = [
		...mcp.configErrors.map((e) => t("mcp.configError", { error: e })),
		...mcp.overridden.map((o) => t("mcp.overridden", { name: o })),
	];

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" className="text-muted-foreground" title={t("mcp.title")}>
					<span className="relative">
						<Plug />
						<span className={cn("absolute -top-0.5 -right-0.5 size-1.5 rounded-full", DOT[tone])} />
					</span>
					{t("mcp.summary", { connected, enabled })}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("mcp.title")}</DialogTitle>
					<DialogDescription>{t("mcp.description")}</DialogDescription>
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

/**
 * Composer-toolbar switches for the session's MCP servers (decisions D16): on/off applies to this
 * session only. Hidden when the session has no servers.
 */
export function McpPicker({ mcp }: { mcp: McpStatus | undefined }) {
	const { t } = useTranslation();
	const mcpAction = useApp((s) => s.mcpAction);
	const setPanelOpen = useApp((s) => s.setMcpPanelOpen);
	if (!mcp || mcp.servers.length === 0) return null;
	const enabled = mcp.servers.filter((s) => s.enabled).length;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={toolbarButton}
					title={t("mcp.pickerTitle", { enabled, total: mcp.servers.length })}
				>
					<span className="relative">
						<Plug />
						{enabled > 0 && (
							<span className={cn("absolute -top-0.5 -right-0.5 size-1.5 rounded-full", DOT[overallTone(mcp)])} />
						)}
					</span>
					<span className="@max-md/toolbar:hidden">{t("mcp.pickerLabel", { count: enabled })}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-72">
				<DropdownMenuLabel>{t("mcp.pickerHeading")}</DropdownMenuLabel>
				{mcp.servers.map((server) => {
					const label = STATE_LABELS.get(server.state);
					return (
						<DropdownMenuCheckboxItem
							key={server.name}
							checked={server.enabled}
							// Keep the menu open to switch several servers.
							onSelect={(e) => {
								e.preventDefault();
								void mcpAction(server.name, server.enabled ? "disable" : "enable");
							}}
						>
							<span className={cn("size-1.5 shrink-0 rounded-full", DOT[toneOf(server)])} />
							<span className="min-w-0 flex-1 truncate">{server.name}</span>
							{server.enabled && label && server.state !== "connected" && (
								<span className="shrink-0 text-xs text-muted-foreground">{t(label)}</span>
							)}
						</DropdownMenuCheckboxItem>
					);
				})}
				<DropdownMenuSeparator />
				<p className="px-1.5 py-1 text-xs text-muted-foreground">{t("mcp.pickerNote")}</p>
				<DropdownMenuItem onSelect={() => setPanelOpen(true)}>{t("mcp.details")}</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => openSettings("mcp")}>{t("mcp.manage")}</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
