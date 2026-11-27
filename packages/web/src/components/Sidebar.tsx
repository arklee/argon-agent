import type { SessionSummary } from "@argon/shared";
import {
	Archive,
	ArrowLeft,
	FolderOpen,
	FolderPlus,
	Pin,
	Plus,
	Server,
	Settings,
	SquarePen,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionContextMenu, SessionNameInput, useSessionActions } from "@/components/SessionMenu";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basename, relativeTime, sessionTitle } from "@/lib/format";
import { collapsedSessions, groupByProject, pinnedSessions, visibleProjects } from "@/lib/session-order";
import { shortcutLabels } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { openSettings } from "@/stores/settings";

/** Sessions a project shows before "Show more". */
const COLLAPSED_SESSIONS = 5;

function SessionRow({ session, showProject = false }: { session: SessionSummary; showProject?: boolean }) {
	const { t } = useTranslation();
	const [editing, setEditing] = useState(false);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const openSession = useApp((s) => s.openSession);
	const { actions, onCloseAutoFocus, deleteDialog, requestDelete } = useSessionActions(session, () => setEditing(true));
	const title = sessionTitle(session);
	// The row's quick action: archive, or delete in the archived view.
	const quick = session.archived
		? { label: t("sessionMenu.delete"), icon: <Trash2 />, run: requestDelete }
		: {
				label: t("sessionMenu.archive"),
				icon: <Archive />,
				run: () => void useApp.getState().setArchived(session, true),
			};

	return (
		<li className="group/row relative">
			{editing ? (
				<SessionNameInput session={session} close={() => setEditing(false)} />
			) : (
				<SessionContextMenu actions={actions} onCloseAutoFocus={onCloseAutoFocus}>
					<button
						type="button"
						onClick={() => void openSession(session)}
						title={showProject ? `${title}\n${session.cwd}` : undefined}
						className={cn(
							"flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
							session.sessionId === activeSessionId && "bg-sidebar-accent font-medium",
						)}
					>
						<span className="min-w-0 flex-1 truncate">{title}</span>
						{showProject && (
							<span className="max-w-24 shrink-0 truncate text-xs font-normal text-muted-foreground">
								{basename(session.cwd) || session.cwd}
							</span>
						)}
						<span
							className={cn(
								"flex min-w-6 shrink-0 justify-end",
								session.sessionPath && "group-hover/row:invisible group-focus-within/row:invisible",
							)}
						>
							{session.running ? (
								<span className="size-2 animate-pulse rounded-full bg-emerald-500" />
							) : (
								<span className="text-xs font-normal text-muted-foreground">{relativeTime(session.modifiedAt)}</span>
							)}
						</span>
					</button>
				</SessionContextMenu>
			)}
			{!editing && session.sessionPath && (
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`${quick.label}: ${title}`}
					title={quick.label}
					onClick={quick.run}
					className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
				>
					{quick.icon}
				</Button>
			)}
			{deleteDialog}
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
	const showArchived = useApp((s) => s.showArchived);
	const updateProject = useApp((s) => s.updateProject);
	const all = useMemo(
		() => groupByProject(sessions, projects, search, { archived: showArchived }),
		[sessions, projects, search, showArchived],
	);
	// Archived sessions are shown whatever their project's visibility.
	const groups = showArchived ? all : visibleProjects(all, showHidden);
	const hidden = showArchived ? 0 : all.filter((g) => g.hidden).length;
	const archivedCount = useMemo(() => sessions.filter((s) => s.archived).length, [sessions]);
	const pinned = useMemo(
		() => (showArchived ? [] : pinnedSessions(sessions, search)),
		[sessions, search, showArchived],
	);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const toggleExpanded = (cwd: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(cwd)) next.add(cwd);
			return next;
		});

	return (
		<aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
			<div className="window-sidebar-header flex h-12 shrink-0 items-center justify-between px-3">
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
				{showArchived && (
					<div className="mb-2 flex items-center gap-1 px-1">
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={t("sidebar.backToSessions")}
							title={t("sidebar.backToSessions")}
							onClick={() => useApp.setState({ showArchived: false })}
						>
							<ArrowLeft />
						</Button>
						<span className="text-xs font-medium">{t("sidebar.archivedTitle")}</span>
					</div>
				)}
				{showArchived && groups.length === 0 && (
					<p className="px-2 py-6 text-center text-sm text-muted-foreground">
						{search ? t("sidebar.noMatch") : t("sidebar.noArchived")}
					</p>
				)}
				{!showArchived && groups.length === 0 && pinned.length === 0 && (
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
				{pinned.length > 0 && (
					<section className="mb-3" aria-label={t("sidebar.pinnedTitle")}>
						<h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("sidebar.pinnedTitle")}</h3>
						<ul>
							{pinned.map((session) => (
								<SessionRow key={session.sessionId} session={session} showProject />
							))}
						</ul>
					</section>
				)}
				{pinned.length > 0 && groups.length > 0 && (
					<h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("sidebar.projectsTitle")}</h3>
				)}
				{groups.map((group) => {
					const collapsible = !search && group.sessions.length > COLLAPSED_SESSIONS;
					const open = expanded.has(group.cwd);
					const shown =
						collapsible && !open
							? collapsedSessions(group.sessions, COLLAPSED_SESSIONS, activeSessionId)
							: group.sessions;
					return (
						<section key={group.cwd} className="mb-3">
							<ContextMenu>
								<ContextMenuTrigger asChild disabled={showArchived}>
									<div className="group/project flex items-center justify-between rounded-md px-2 py-1 data-[state=open]:bg-sidebar-accent">
										<span
											className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
											title={group.cwd}
										>
											{group.pinned && <Pin className="size-3 shrink-0" />}
											<FolderOpen className="size-3.5 shrink-0" />
											<span className="truncate">{basename(group.cwd) || group.cwd}</span>
										</span>
										{!showArchived && (
											<Button
												variant="ghost"
												size="icon-xs"
												aria-label={t("sidebar.newInProject", { path: group.cwd })}
												className="opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
												onClick={() => void newSession(group.cwd)}
											>
												<Plus />
											</Button>
										)}
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onSelect={() => void newSession(group.cwd)}>
										{t("sidebar.newSession")}
									</ContextMenuItem>
									<ContextMenuItem onSelect={() => openSettings("general", group.cwd)}>
										{t("sidebar.projectSettings")}
									</ContextMenuItem>
									<ContextMenuSeparator />
									<ContextMenuItem onSelect={() => void updateProject({ cwd: group.cwd, pinned: !group.pinned })}>
										{group.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
									</ContextMenuItem>
									<ContextMenuItem onSelect={() => void updateProject({ cwd: group.cwd, hidden: !group.hidden })}>
										{group.hidden ? t("sidebar.unhide") : t("sidebar.hide")}
									</ContextMenuItem>
									{group.addedAt !== undefined && group.sessions.length === 0 && !search && (
										<ContextMenuItem onSelect={() => void updateProject({ cwd: group.cwd, addedAt: 0 })}>
											{t("sidebar.remove")}
										</ContextMenuItem>
									)}
								</ContextMenuContent>
							</ContextMenu>
							{group.sessions.length === 0 && !pinned.some((session) => session.cwd === group.cwd) && (
								<p className="px-2 pb-1 text-xs text-muted-foreground/70">{t("sidebar.noSessions")}</p>
							)}
							<ul>
								{shown.map((session) => (
									<SessionRow key={session.sessionId} session={session} />
								))}
							</ul>
							{collapsible && (
								<button
									type="button"
									aria-expanded={open}
									onClick={() => toggleExpanded(group.cwd)}
									className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
								>
									{open
										? t("sidebar.showLess")
										: t("sidebar.showMore", { count: group.sessions.length - shown.length })}
								</button>
							)}
						</section>
					);
				})}
				{!showArchived && archivedCount > 0 && (
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => useApp.setState({ showArchived: true })}
					>
						<Archive />
						{t("sidebar.archived", { count: archivedCount })}
					</Button>
				)}
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
