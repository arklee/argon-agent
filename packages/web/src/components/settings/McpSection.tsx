/**
 * Settings → MCP (decisions D16): the servers in the global mcp.json and, in project scope, the
 * project's `.argon/mcp.json`, plus whether new sessions start with each server on. Each session can
 * still switch servers for itself in the composer.
 */

import type { McpConfigFile, McpConfigServer, McpConfigTarget, McpServerForm } from "@argon/shared";
import { FileJson, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { JsonFileEditor } from "@/components/settings/ModelsJsonEditor";
import { Group, Loading, ScopeSwitch } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { displayPath } from "@/lib/format";
import { describeForm, formatPairs, parseLines, parsePairs } from "@/lib/mcp-form";
import { cn } from "@/lib/utils";
import { getClient, useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";

const JSON_TEMPLATE = `{
	"mcpServers": {}
}
`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function McpSection() {
	const { t } = useTranslation();
	const scope = useSettings((s) => s.scope);
	const cwd = useSettings((s) => s.cwd);
	const mcp = useSettings((s) => s.mcp);
	const settings = useSettings((s) => s.settings);
	const [editing, setEditing] = useState<{ target: McpConfigTarget; server?: McpConfigServer }>();
	const [json, setJson] = useState<McpConfigTarget>();
	const [removing, setRemoving] = useState<{ file: McpConfigFile; target: McpConfigTarget; name: string }>();

	if (!mcp || !settings) return <Loading />;
	const projectTarget: McpConfigTarget | undefined =
		scope === "project" && cwd && mcp.project ? { scope: "project", cwd } : undefined;
	const actions = {
		onEdit: (target: McpConfigTarget, server?: McpConfigServer) => setEditing({ target, server }),
		onRemove: (file: McpConfigFile, target: McpConfigTarget, name: string) => setRemoving({ file, target, name }),
	};

	return (
		<>
			<ScopeSwitch />
			{projectTarget && mcp.project ? (
				<ProjectView global={mcp.global} project={mcp.project} target={projectTarget} {...actions} onJson={setJson} />
			) : (
				<GlobalView file={mcp.global} {...actions} onJson={setJson} />
			)}
			{editing && (
				<ServerDialog
					target={editing.target}
					server={editing.server}
					names={namesIn(editing.target.scope === "global" ? mcp.global : mcp.project)}
					onClose={() => setEditing(undefined)}
				/>
			)}
			<JsonFileEditor
				open={json !== undefined}
				onOpenChange={(open) => !open && setJson(undefined)}
				fileName="mcp.json"
				template={JSON_TEMPLATE}
				hint={t("settings.mcp.jsonHint")}
				load={() => getClient().request("mcp.config.getText", json ?? { scope: "global" })}
				save={(text, version) =>
					getClient().request("mcp.config.setText", { ...(json ?? { scope: "global" }), text, version })
				}
				onSaved={() => void useSettings.getState().refreshMcp()}
			/>
			{removing && <RemoveDialog {...removing} onClose={() => setRemoving(undefined)} />}
		</>
	);
}

function namesIn(file: McpConfigFile | undefined): string[] {
	return file?.servers.map((server) => server.name) ?? [];
}

interface ViewActions {
	onEdit(target: McpConfigTarget, server?: McpConfigServer): void;
	onRemove(file: McpConfigFile, target: McpConfigTarget, name: string): void;
	onJson(target: McpConfigTarget): void;
}

function FilePath({
	file,
	i18nKey,
}: {
	file: McpConfigFile;
	i18nKey: "settings.mcp.globalFile" | "settings.mcp.projectFile";
}) {
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	return (
		<p>
			<Trans
				t={t}
				i18nKey={i18nKey}
				shouldUnescape
				tOptions={{ interpolation: { escapeValue: true } }}
				values={{ path: displayPath(file.path, homeDir) }}
				components={{ path: <code className="font-mono break-all" /> }}
			/>
		</p>
	);
}

function FileError({ file }: { file: McpConfigFile }) {
	const { t } = useTranslation();
	if (!file.error) return null;
	return (
		<p className="rounded-md bg-destructive/10 px-3 py-2 font-mono whitespace-pre-wrap text-destructive">
			{t("settings.mcp.fileError", { error: file.error })}
		</p>
	);
}

function FileActions({ target, onEdit, onJson }: { target: McpConfigTarget } & Pick<ViewActions, "onEdit" | "onJson">) {
	const { t } = useTranslation();
	return (
		<div className="-mt-3 mb-6 flex gap-2">
			<Button variant="outline" size="sm" onClick={() => onEdit(target)}>
				<Plus />
				{t("settings.mcp.add")}
			</Button>
			<Button variant="ghost" size="sm" onClick={() => onJson(target)}>
				<FileJson />
				{t("settings.mcp.editJson")}
			</Button>
		</div>
	);
}

function GlobalView({ file, onEdit, onRemove, onJson }: { file: McpConfigFile } & ViewActions) {
	const { t } = useTranslation();
	const target: McpConfigTarget = { scope: "global" };
	const setEnabled = async (name: string, enabled: boolean) => {
		try {
			await getClient().request("mcp.config.setEnabled", { name, enabled });
		} catch (e) {
			useSettings.getState().refreshMcp();
			throw e;
		}
		await useSettings.getState().refreshMcp();
	};
	return (
		<>
			<div className="mb-5 space-y-2 text-xs text-muted-foreground">
				<FilePath file={file} i18nKey="settings.mcp.globalFile" />
				<p>{t("settings.mcp.defaultsHint")}</p>
				<FileError file={file} />
			</div>
			<Group title={t("settings.mcp.servers")}>
				{file.servers.length === 0 && <Empty />}
				{file.servers.map((server) => (
					<ServerRow
						key={server.name}
						server={server}
						enabled={server.enabled}
						onToggle={(enabled) => void setEnabled(server.name, enabled).catch(() => {})}
						onEdit={() => onEdit(target, server)}
						onRemove={() => onRemove(file, target, server.name)}
					/>
				))}
			</Group>
			<FileActions target={target} onEdit={onEdit} onJson={onJson} />
		</>
	);
}

function ProjectView({
	global,
	project,
	target,
	onEdit,
	onRemove,
	onJson,
}: { global: McpConfigFile; project: McpConfigFile; target: McpConfigTarget } & ViewActions) {
	const { t } = useTranslation();
	const defaults = useSettings((s) => s.settings?.argonProject?.mcpServers) ?? {};
	const updateArgonProject = useSettings((s) => s.updateArgonProject);
	const own = project.servers.filter((server) => !server.override);
	const overrides = new Map(project.servers.filter((s) => s.override).map((s) => [s.name, s]));
	const inherited = global.servers.filter((server) => !own.some((o) => o.name === server.name));
	// The default before this project's private choice: the project file, else the global file.
	const fileEnabled = (server: McpConfigServer) => overrides.get(server.name)?.enabled ?? server.enabled;
	const setDefault = (name: string, enabled: boolean | undefined) => {
		const next = { ...defaults };
		if (enabled === undefined) delete next[name];
		else next[name] = enabled;
		void (Object.keys(next).length === 0
			? updateArgonProject({}, ["mcpServers"])
			: updateArgonProject({ mcpServers: next }));
	};
	const row = (server: McpConfigServer, editable: boolean) => (
		<ServerRow
			key={server.name}
			server={server}
			enabled={defaults[server.name] ?? fileEnabled(server)}
			onToggle={(enabled) => setDefault(server.name, enabled)}
			onReset={server.name in defaults ? () => setDefault(server.name, undefined) : undefined}
			onEdit={editable ? () => onEdit(target, server) : undefined}
			onRemove={editable ? () => onRemove(project, target, server.name) : undefined}
		/>
	);
	return (
		<>
			<div className="mb-5 space-y-2 text-xs text-muted-foreground">
				<FilePath file={project} i18nKey="settings.mcp.projectFile" />
				<p>{t("settings.mcp.projectPrivate")}</p>
				{project.trusted === false && (
					<p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
						{t("settings.mcp.projectUntrusted")}
					</p>
				)}
				<FileError file={project} />
			</div>
			<Group title={t("settings.mcp.projectServers")}>
				{own.length === 0 && <Empty />}
				{own.map((server) => row(server, true))}
			</Group>
			<FileActions target={target} onEdit={onEdit} onJson={onJson} />
			{inherited.length > 0 && (
				<Group title={t("settings.mcp.globalServers")}>{inherited.map((server) => row(server, false))}</Group>
			)}
		</>
	);
}

function Empty() {
	const { t } = useTranslation();
	return <p className="py-3 text-sm text-muted-foreground">{t("settings.mcp.empty")}</p>;
}

function ServerRow({
	server,
	enabled,
	onToggle,
	onReset,
	onEdit,
	onRemove,
}: {
	server: McpConfigServer;
	enabled: boolean;
	onToggle(enabled: boolean): void;
	/** Set when the project chose its own default; returns to the file's. */
	onReset?: () => void;
	onEdit?: () => void;
	onRemove?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex items-center justify-between gap-4 py-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2 text-sm">
					<span className="truncate font-medium">{server.name}</span>
					{server.form && (
						<Badge variant="secondary" className="shrink-0 font-normal">
							{server.form.transport === "stdio" ? "stdio" : "HTTP"}
						</Badge>
					)}
					{server.authProvider && (
						<Badge variant="outline" className="shrink-0 font-normal">
							{t("settings.mcp.authProvider", { provider: server.authProvider })}
						</Badge>
					)}
				</div>
				<div
					className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
					title={server.form ? describeForm(server.form) : undefined}
				>
					{server.form ? describeForm(server.form) : t("settings.mcp.jsonOnly")}
				</div>
				{onReset && (
					<span className="mt-0.5 flex items-center gap-1 text-xs text-primary">
						<span className="size-1.5 rounded-full bg-primary" />
						{t("settings.general.setForProject")}
					</span>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{onReset && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
						aria-label={t("settings.general.useGlobal")}
						title={t("settings.general.useGlobal")}
						onClick={onReset}
					>
						<RotateCcw />
					</Button>
				)}
				{onEdit && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
						disabled={!server.form}
						aria-label={t("settings.mcp.edit", { name: server.name })}
						title={server.form ? t("settings.mcp.edit", { name: server.name }) : t("settings.mcp.jsonOnly")}
						onClick={onEdit}
					>
						<Pencil />
					</Button>
				)}
				{onRemove && (
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
						aria-label={t("settings.mcp.remove", { name: server.name })}
						title={t("settings.mcp.remove", { name: server.name })}
						onClick={onRemove}
					>
						<Trash2 />
					</Button>
				)}
				<Switch
					className="ml-2"
					checked={enabled}
					aria-label={t("settings.mcp.defaultOn", { name: server.name })}
					title={t("settings.mcp.defaultOn", { name: server.name })}
					onCheckedChange={onToggle}
				/>
			</div>
		</div>
	);
}

function RemoveDialog({
	file,
	target,
	name,
	onClose,
}: {
	file: McpConfigFile;
	target: McpConfigTarget;
	name: string;
	onClose(): void;
}) {
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const remove = async () => {
		setBusy(true);
		try {
			await getClient().request("mcp.config.removeServer", { ...target, name });
			await useSettings.getState().refreshMcp();
			onClose();
		} catch (e) {
			setError(errorMessage(e));
			setBusy(false);
		}
	};
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("settings.mcp.confirmRemove", { name })}</DialogTitle>
					<DialogDescription>
						{t("settings.mcp.confirmRemoveBody", { path: displayPath(file.path, homeDir) })}
					</DialogDescription>
				</DialogHeader>
				{error && <p className="text-sm text-destructive">{error}</p>}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button variant="destructive" disabled={busy} onClick={() => void remove()}>
						{busy && <Loader2 className="animate-spin" />}
						{t("common.remove")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Add (no `server`) or edit a server through the form. */
function ServerDialog({
	target,
	server,
	names,
	onClose,
}: {
	target: McpConfigTarget;
	server?: McpConfigServer;
	/** Names already used in the file. */
	names: string[];
	onClose(): void;
}) {
	const { t } = useTranslation();
	const form = server?.form;
	const [name, setName] = useState(server?.name ?? "");
	const [transport, setTransport] = useState<McpServerForm["transport"]>(form?.transport ?? "stdio");
	const [command, setCommand] = useState(form?.transport === "stdio" ? form.command : "");
	const [args, setArgs] = useState(form?.transport === "stdio" ? (form.args ?? []).join("\n") : "");
	const [env, setEnv] = useState(form?.transport === "stdio" ? formatPairs(form.env, "=") : "");
	const [cwd, setCwd] = useState(form?.transport === "stdio" ? (form.cwd ?? "") : "");
	const [url, setUrl] = useState(form?.transport === "http" ? form.url : "");
	const [headers, setHeaders] = useState(form?.transport === "http" ? formatPairs(form.headers, ":") : "");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);

	const build = (): McpServerForm | string => {
		if (transport === "stdio") {
			if (!command.trim()) return t("settings.mcp.editor.commandRequired");
			const parsedEnv = parsePairs(env, "=");
			if ("error" in parsedEnv) return t("settings.mcp.editor.badLine", { line: parsedEnv.error });
			const list = parseLines(args);
			return {
				transport,
				command: command.trim(),
				...(list.length > 0 ? { args: list } : {}),
				...(Object.keys(parsedEnv.pairs).length > 0 ? { env: parsedEnv.pairs } : {}),
				...(cwd.trim() ? { cwd: cwd.trim() } : {}),
			};
		}
		if (!url.trim()) return t("settings.mcp.editor.urlRequired");
		const parsed = parsePairs(headers, ":");
		if ("error" in parsed) return t("settings.mcp.editor.badLine", { line: parsed.error });
		return {
			transport,
			url: url.trim(),
			...(Object.keys(parsed.pairs).length > 0 ? { headers: parsed.pairs } : {}),
		};
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return setError(t("settings.mcp.editor.nameRequired"));
		if (trimmed !== server?.name && names.includes(trimmed))
			return setError(t("settings.mcp.editor.nameTaken", { name: trimmed }));
		const built = build();
		if (typeof built === "string") return setError(built);
		setBusy(true);
		setError(undefined);
		try {
			await getClient().request("mcp.config.saveServer", {
				...target,
				name: trimmed,
				...(server ? { previousName: server.name } : {}),
				form: built,
				create: !server,
			});
			await useSettings.getState().refreshMcp();
			onClose();
		} catch (err) {
			setError(errorMessage(err));
			setBusy(false);
		}
	};

	const field = (label: string, hint: string | undefined, control: ReactNode) => (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the label's child
		<label className="block space-y-1.5">
			<span className="text-sm">{label}</span>
			{control}
			{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
		</label>
	);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{server ? t("settings.mcp.editor.titleEdit") : t("settings.mcp.editor.titleAdd")}</DialogTitle>
					<DialogDescription>
						{target.scope === "global" ? t("settings.mcp.editor.scopeGlobal") : t("settings.mcp.editor.scopeProject")}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={(e) => void submit(e)}
					onKeyDown={(e) => {
						// Enter confirms an IME candidate, not the form.
						if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
					}}
				>
					{field(
						t("settings.mcp.editor.name"),
						t("settings.mcp.editor.nameHint"),
						<Input value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} />,
					)}
					<fieldset className="m-0 flex rounded-lg border-0 bg-muted p-0.5">
						<legend className="sr-only">{t("settings.mcp.editor.transport")}</legend>
						{(["stdio", "http"] as const).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={transport === value}
								onClick={() => {
									setTransport(value);
									setError(undefined);
								}}
								className={cn(
									"flex-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
									transport === value && "bg-background font-medium text-foreground shadow-xs",
								)}
							>
								{value === "stdio" ? t("settings.mcp.editor.stdio") : t("settings.mcp.editor.http")}
							</button>
						))}
					</fieldset>
					{transport === "stdio" ? (
						<>
							{field(
								t("settings.mcp.editor.command"),
								undefined,
								<Input
									value={command}
									onChange={(e) => setCommand(e.target.value)}
									placeholder="npx"
									className="font-mono"
									spellCheck={false}
								/>,
							)}
							{field(
								t("settings.mcp.editor.args"),
								t("settings.mcp.editor.argsHint"),
								<Textarea
									value={args}
									onChange={(e) => setArgs(e.target.value)}
									placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
									rows={3}
									className="font-mono text-xs md:text-xs"
									spellCheck={false}
								/>,
							)}
							{field(
								t("settings.mcp.editor.env"),
								t("settings.mcp.editor.envHint"),
								<Textarea
									value={env}
									onChange={(e) => setEnv(e.target.value)}
									placeholder="API_TOKEN=${API_TOKEN}"
									rows={2}
									className="font-mono text-xs md:text-xs"
									spellCheck={false}
								/>,
							)}
							{field(
								t("settings.mcp.editor.cwd"),
								t("settings.mcp.editor.cwdHint"),
								<Input value={cwd} onChange={(e) => setCwd(e.target.value)} className="font-mono" spellCheck={false} />,
							)}
						</>
					) : (
						<>
							{field(
								t("settings.mcp.editor.url"),
								t("settings.mcp.editor.oauthHint"),
								<Input
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="https://example.com/mcp"
									className="font-mono"
									spellCheck={false}
								/>,
							)}
							{field(
								t("settings.mcp.editor.headers"),
								t("settings.mcp.editor.headersHint"),
								<Textarea
									value={headers}
									onChange={(e) => setHeaders(e.target.value)}
									placeholder="Authorization: Bearer ${DOCS_TOKEN}"
									rows={2}
									className="font-mono text-xs md:text-xs"
									spellCheck={false}
								/>,
							)}
						</>
					)}
					{error && <p className="text-sm whitespace-pre-wrap text-destructive">{error}</p>}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={busy}>
							{busy && <Loader2 className="animate-spin" />}
							{t("common.save")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
