import type { SessionSummary } from "@argon/shared";
import { Ellipsis, FolderOpen, FolderPlus, Pin, Plus, Server, Settings, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionMenu, SessionNameInput } from "@/components/SessionMenu";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basename, relativeTime, sessionTitle } from "@/lib/format";
import { groupByProject, visibleProjects } from "@/lib/session-order";
import { shortcutLabels } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { openSettings } from "@/stores/settings";

function SessionRow({ session }: { session: SessionSummary }) {
	const [menu, setMenu] = useState(false);
	const [editing, setEditing] = useState(false);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const openSession = useApp((s) => s.openSession);

	return (
		<li
			className="group/row flex items-center"
			onContextMenu={(e) => {
				if (!editing) {
					e.preventDefault();
					setMenu(true);
				}
			}}
		>
			{editing ? (
				<SessionNameInput session={session} close={() => setEditing(false)} />
			) : (
				<button
					type="button"
					onClick={() => void openSession(session)}
					className={cn(
						"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
						session.sessionId === activeSessionId && "bg-sidebar-accent font-medium",
					)}
				>
					<span className="min-w-0 flex-1 truncate">{sessionTitle(session)}</span>
					{session.running ? (
						<span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
					) : (
						<span className="shrink-0 text-xs text-muted-foreground">{relativeTime(session.modifiedAt)}</span>
					)}
				</button>
			)}
			<SessionMenu
				session={session}
				open={menu}
				onOpenChange={setMenu}
				onRename={() => setEditing(true)}
				className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
			/>
		</li>
	);
}

export function Sidebar() {
	const { t } = useTranslation();
	const sessions = useApp((s) => s.sessions);
	const environment = useApp((s) => s.environment);
	const connection = useApp((s) => s.connection);
	const setAddProjectOpen = useApp((s) => s.setAddProjectOpen);
	const newSession = useApp((s) => s.newSession);
	const projects = useApp((s) => s.projects);
	const search = useApp((s) => s.search);
	const showHidden = useApp((s) => s.showHidden);
	const updateProject = useApp((s) => s.updateProject);
	const all = useMemo(() => groupByProject(sessions, projects, search), [sessions, projects, search]);
	const groups = visibleProjects(all, showHidden);
	const hidden = all.filter((g) => g.hidden).length;

	return (
		<aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
			<div className="flex h-12 items-center justify-between px-3">
				<span className="text-sm font-semibold tracking-tight">Argon</span>
				<div className="flex items-center">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("common.addProject")}
								onClick={() => setAddProjectOpen(true)}
								disabled={!environment}
							>
								<FolderPlus />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("common.addProject")}</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("common.newSession")}
								onClick={() => void newSession()}
								disabled={!environment}
							>
								<SquarePen />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("sidebar.newSessionShortcut", { shortcut: shortcutLabels.newSession })}</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<div className="px-3 pb-3">
				<Input
					aria-label={t("sidebar.search")}
					placeholder={t("sidebar.search")}
					value={search}
					onChange={(e) => useApp.setState({ search: e.target.value })}
					onKeyDown={(e) => {
						if (!e.nativeEvent.isComposing && e.key === "Escape") useApp.setState({ search: "" });
					}}
				/>
			</div>
			<nav className="flex-1 overflow-y-auto px-2 pb-2">
				{groups.length === 0 && (
					<div className="flex flex-col items-center px-2 py-6 text-center text-sm text-muted-foreground">
						{search ? (
							t("sidebar.noMatch")
						) : (
							<>
								{t("sidebar.noProjects")}
								<Button
									variant="outline"
									size="sm"
									className="mt-3"
									onClick={() => setAddProjectOpen(true)}
									disabled={!environment}
								>
									<FolderPlus />
									{t("common.addProject")}
								</Button>
							</>
						)}
					</div>
				)}
				{groups.map((group) => (
					<section key={group.cwd} className="mb-3">
						<div className="group/project flex items-center justify-between px-2 py-1">
							<span
								className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
								title={group.cwd}
							>
								{group.pinned && <Pin className="size-3 shrink-0" />}
								<FolderOpen className="size-3.5 shrink-0" />
								<span className="truncate">{basename(group.cwd) || group.cwd}</span>
							</span>
							<div className="ml-auto flex items-center">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-label={t("sidebar.projectActions", { path: group.cwd })}
										>
											<Ellipsis />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onSelect={() => void updateProject({ cwd: group.cwd, pinned: !group.pinned })}>
											{group.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => void updateProject({ cwd: group.cwd, hidden: !group.hidden })}>
											{group.hidden ? t("sidebar.unhide") : t("sidebar.hide")}
										</DropdownMenuItem>
										{group.addedAt !== undefined && group.sessions.length === 0 && !search && (
											<DropdownMenuItem onSelect={() => void updateProject({ cwd: group.cwd, addedAt: 0 })}>
												{t("sidebar.remove")}
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={t("sidebar.newInProject", { path: group.cwd })}
									className="opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
									onClick={() => void newSession(group.cwd)}
								>
									<Plus />
								</Button>
							</div>
						</div>
						{group.sessions.length === 0 && (
							<p className="px-2 pb-1 text-xs text-muted-foreground/70">{t("sidebar.noSessions")}</p>
						)}
						<ul>
							{group.sessions.map((session) => (
								<SessionRow key={session.sessionId} session={session} />
							))}
						</ul>
					</section>
				))}
				{hidden > 0 && (
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={showHidden}
						onClick={() => useApp.setState({ showHidden: !showHidden })}
					>
						{t(showHidden ? "sidebar.hideHidden" : "sidebar.showHidden", { count: hidden })}
					</Button>
				)}
			</nav>

			<div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
				<Server className="size-3.5" />
				<span className="min-w-0 flex-1 truncate" title={environment?.homeDir}>
					{environment ? environment.name : "—"}
				</span>
				<span
					className={cn(
						"size-2 rounded-full",
						connection?.status === "connected" ? "bg-emerald-500" : "animate-pulse bg-amber-500",
					)}
					title={connection && t(`connection.status.${connection.status}`)}
				/>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={t("settings.title")}
					title={t("sidebar.settingsShortcut", { shortcut: shortcutLabels.settings })}
					disabled={!environment}
					onClick={() => openSettings()}
				>
					<Settings />
				</Button>
			</div>
		</aside>
	);
}
