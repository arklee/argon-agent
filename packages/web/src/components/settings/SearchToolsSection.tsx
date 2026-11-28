import type { SearchToolName, SearchToolStatus, SearchToolsStatus } from "@argon/shared";
import { CircleAlert, CircleCheck, Download, Loader2, Upload } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadProgress, Group, Loading, MirrorPicker } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/stores/settings";

const NAMES: Record<SearchToolName, string> = { rg: "ripgrep", fd: "fd" };

function ToolRow({ tool }: { tool: SearchToolStatus }) {
	const { t } = useTranslation();
	let description: string;
	let badge: ReactNode;
	switch (tool.state) {
		case "ready":
			description =
				tool.source === "system"
					? t("settings.tools.readySystem", { path: tool.path ?? "" })
					: t("settings.tools.readyManaged", { version: tool.version });
			badge = (
				<Badge variant="secondary" className="gap-1">
					<CircleCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
					{tool.source === "system" ? t("settings.tools.badgeSystem") : t("settings.tools.badgeReady")}
				</Badge>
			);
			break;
		case "downloading":
			description = t("settings.tools.downloading", { version: tool.version });
			badge = <Loader2 className="size-4 animate-spin text-muted-foreground" />;
			break;
		case "failed":
			description = t("settings.tools.failed", { version: tool.version });
			badge = (
				<Badge variant="destructive" className="gap-1">
					<CircleAlert className="size-3" />
					{t("settings.tools.badgeFailed")}
				</Badge>
			);
			break;
		default:
			description = t("settings.tools.missing");
			badge = <Badge variant="outline">{t("settings.tools.badgeMissing")}</Badge>;
	}
	return (
		<div className="py-3">
			<div className="flex items-center justify-between gap-6">
				<div className="min-w-0">
					<div className="text-sm">
						{NAMES[tool.tool]}
						<span className="ml-1.5 font-mono text-xs text-muted-foreground">{tool.tool}</span>
					</div>
					<div className="mt-0.5 truncate text-xs text-muted-foreground" title={tool.path}>
						{description}
					</div>
				</div>
				<div className="flex shrink-0 items-center">{badge}</div>
			</div>
			{tool.state === "downloading" && <DownloadProgress received={tool.received} total={tool.total} />}
			{tool.state === "failed" && tool.error && (
				<pre className="mt-2 rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{tool.error}
				</pre>
			)}
		</div>
	);
}

function DownloadGroup({ status, pending }: { status: SearchToolsStatus; pending: SearchToolStatus[] }) {
	const { t } = useTranslation();
	const installTools = useSettings((s) => s.installTools);
	const [mirror, setMirror] = useState(status.mirror);
	const [busy, setBusy] = useState(false);
	const downloading = pending.some((tool) => tool.state === "downloading");
	const failed = pending.some((tool) => tool.state === "failed");
	const pinned = status.mirrorEnv !== undefined;
	const canStart = !busy && !downloading && (pinned || mirror.trim() !== "");
	return (
		<Group title={t("settings.tools.download")}>
			<MirrorPicker
				label={t("settings.tools.mirror")}
				description={t("settings.tools.mirrorDescription")}
				presets={[
					{ id: "github", label: t("settings.plugins.mirrorGithub") },
					{ id: "npmmirror", label: t("settings.plugins.mirrorNpmmirror") },
				]}
				env={pinned ? { name: "ARGON_TOOLS_MIRROR", value: status.mirrorEnv ?? "" } : undefined}
				placeholder="https://proxy.example.com/https://github.com"
				value={mirror}
				onChange={setMirror}
			/>
			<div className="flex justify-end py-3">
				<Button
					size="xs"
					disabled={!canStart}
					onClick={async () => {
						setBusy(true);
						await installTools(pinned ? undefined : mirror.trim());
						setBusy(false);
					}}
				>
					{busy || downloading ? <Loader2 className="animate-spin" /> : <Download />}
					{failed ? t("settings.tools.retry") : t("settings.tools.downloadButton")}
				</Button>
			</div>
		</Group>
	);
}

/** A file fetched on this computer (e.g. through a proxy) and sent to the backend, which verifies it. */
function UploadButton({ tool }: { tool: SearchToolName }) {
	const { t } = useTranslation();
	const uploadTool = useSettings((s) => s.uploadTool);
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	return (
		<>
			<input
				ref={input}
				type="file"
				className="hidden"
				onChange={async (e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (!file) return;
					setBusy(true);
					await uploadTool(tool, file);
					setBusy(false);
				}}
			/>
			<Button variant="outline" size="xs" disabled={busy} onClick={() => input.current?.click()}>
				{busy ? <Loader2 className="animate-spin" /> : <Upload />}
				{t("settings.tools.upload")}
			</Button>
		</>
	);
}

function ManualGroup({ status, pending }: { status: SearchToolsStatus; pending: SearchToolStatus[] }) {
	const { t } = useTranslation();
	return (
		<Group title={t("settings.tools.manual")}>
			<p className="py-3 text-xs text-muted-foreground">
				{t("settings.tools.manualDescription", { platform: status.platform })}
			</p>
			{pending.map((tool) => (
				<div key={tool.tool} className="flex items-center gap-4 py-3">
					<div className="min-w-0 flex-1">
						<div className="text-sm">
							{NAMES[tool.tool]} {tool.version}
						</div>
						<ul className="mt-1 space-y-0.5">
							{tool.downloads.map((file) => (
								<li key={file.url} className="flex min-w-0 items-baseline gap-2 text-xs">
									<span className="w-20 shrink-0 text-muted-foreground">
										{file.source === "github" ? "GitHub" : "npmmirror"}
									</span>
									<a
										href={file.url}
										target="_blank"
										rel="noreferrer"
										className="truncate font-mono underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
										title={file.url}
									>
										{file.fileName}
									</a>
								</li>
							))}
						</ul>
					</div>
					<UploadButton tool={tool.tool} />
				</div>
			))}
		</Group>
	);
}

/**
 * rg and fd on the backend machine (pi's grep / find, @file completion). The desktop app ships them;
 * elsewhere the backend downloads pinned builds, or the user uploads one fetched on this computer.
 */
export function SearchToolsSection() {
	const { t } = useTranslation();
	const status = useSettings((s) => s.tools);
	if (!status) return <Loading />;
	const pending = status.tools.filter((tool) => tool.state !== "ready");
	return (
		<>
			<Group title={t("settings.tools.status", { platform: status.platform })}>
				{status.tools.map((tool) => (
					<ToolRow key={tool.tool} tool={tool} />
				))}
			</Group>
			{!status.supported && pending.length > 0 && (
				<p className="text-xs text-muted-foreground">
					{t("settings.tools.unsupported", { platform: status.platform })}
				</p>
			)}
			{status.supported && pending.length > 0 && (
				<>
					<DownloadGroup status={status} pending={pending} />
					<ManualGroup status={status} pending={pending} />
				</>
			)}
		</>
	);
}
