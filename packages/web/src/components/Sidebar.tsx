import type { SessionSummary } from "@argon/shared";
import { Archive, FolderOpen, FolderPlus, PanelLeft, Pin, Plus, Server, Settings, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapse } from "@/components/Collapse";
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
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, useSidebar } from "@/stores/sidebar";

/** Dragging the edge this far below the minimum width hides the sidebar. */
const COLLAPSE_DRAG_THRESHOLD = SIDEBAR_MIN_WIDTH - 80;

/** Shows and hides the sidebar. Fixed in the top-left corner (after the macOS traffic lights). */
export function SidebarToggle() {
	const { t } = useTranslation();
	const collapsed = useSidebar((s) => s.collapsed);
	const toggle = useSidebar((s) => s.toggle);
	useEffect(() => {
		document.documentElement.toggleAttribute("data-sidebar-collapsed", collapsed);
	}, [collapsed]);
	const label = t(collapsed ? "sidebar.expand" : "sidebar.collapse", { shortcut: shortcutLabels.toggleSidebar });
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					className="sidebar-toggle text-muted-foreground hover:text-foreground"
					aria-label={label}
					aria-expanded={!collapsed}
					onClick={toggle}
				>
					<PanelLeft />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

/** The sidebar's right edge: drag to resize (far enough left hides it), double-click for the default width. */
function ResizeHandle() {
	const { t } = useTranslation();
	const width = useSidebar((s) => s.width);
	const collapsed = useSidebar((s) => s.collapsed);
	const resizing = useSidebar((s) => s.resizing);
	const { setWidth, setCollapsed, setResizing } = useSidebar.getState();
	return (
		<div className={cn("relative z-20 w-0 shrink-0", collapsed && !resizing && "pointer-events-none")}>
			{/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA window splitter pattern. */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={t("sidebar.resize")}
				aria-valuemin={SIDEBAR_MIN_WIDTH}
				aria-valuenow={collapsed ? 0 : width}
				tabIndex={collapsed ? -1 : 0}
				className={cn(
					"absolute inset-y-0 -left-1 w-2 cursor-col-resize outline-none",
					"after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-ring/50 focus-visible:after:bg-ring",
					resizing && "after:bg-ring/50",
				)}
				onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					setWidth(width + (event.key === "ArrowRight" ? 16 : -16));
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					const handle = event.currentTarget;
					handle.setPointerCapture(event.pointerId);
					const startX = event.clientX;
					const startWidth = collapsed ? 0 : width;
					setResizing(true);
					const body = document.body.style;
					const restore = { cursor: body.cursor, userSelect: body.userSelect };
					body.cursor = "col-resize";
					body.userSelect = "none";
					const onMove = (move: PointerEvent) => {
						const next = startWidth + move.clientX - startX;
						if (next < COLLAPSE_DRAG_THRESHOLD) {
							if (!useSidebar.getState().collapsed) {
								// Reopening restores the width from before this drag.
								if (startWidth > 0) setWidth(startWidth);
								setCollapsed(true);
							}
							return;
						}
						if (useSidebar.getState().collapsed) setCollapsed(false);
						setWidth(next);
					};
					const onEnd = () => {
						handle.removeEventListener("pointermove", onMove);
						handle.removeEventListener("pointerup", onEnd);
						handle.removeEventListener("pointercancel", onEnd);
						body.cursor = restore.cursor;
						body.userSelect = restore.userSelect;
						setResizing(false);
					};
					handle.addEventListener("pointermove", onMove);
					handle.addEventListener("pointerup", onEnd);
					handle.addEventListener("pointercancel", onEnd);
				}}
			/>
		</div>
	);
}

/** Sessions a project shows before "Show more". */
const COLLAPSED_SESSIONS = 5;

function SessionRow({ session, showProject = false }: { session: SessionSummary; showProject?: boolean }) {
	const { t } = useTranslation();
	const [editing, setEditing] = useState(false);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const openSession = useApp((s) => s.openSession);
	const { actions, onCloseAutoFocus, deleteDialog } = useSessionActions(session, () => setEditing(true));
	const title = sessionTitle(session);
	const archiveLabel = t("sessionMenu.archive");

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
					aria-label={`${archiveLabel}: ${title}`}
					title={archiveLabel}
					onClick={() => void useApp.getState().setArchived(session, true)}
					className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
				>
					<Archive />
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
	const updateProject = useApp((s) => s.updateProject);
	// Archived sessions are not listed here; they live in Settings → Archived sessions.
	const all = useMemo(() => groupByProject(sessions, projects, search), [sessions, projects, search]);
	const groups = visibleProjects(all, showHidden);
	const hidden = all.filter((g) => g.hidden).length;
	const pinned = useMemo(() => pinnedSessions(sessions, search), [sessions, search]);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const toggleExpanded = (cwd: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(cwd)) next.add(cwd);
			return next;
		});

	const collapsed = useSidebar((s) => s.collapsed);
	const width = useSidebar((s) => s.width);
	const resizing = useSidebar((s) => s.resizing);

	return (
		<>
			<aside
				inert={collapsed}
				style={{ width: collapsed ? 0 : width }}
				className={cn(
					"shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground",
					!collapsed && "border-r",
					!resizing && "transition-[width] duration-200 ease-out motion-reduce:transition-none",
				)}
			>
				{/* Keeps its width while the sidebar slides shut, so the content does not reflow. */}
				<div style={{ width }} className="flex h-full flex-col">
					<div className="window-sidebar-header flex h-12 shrink-0 items-center justify-end px-3">
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
								<TooltipContent>
									{t("sidebar.newSessionShortcut", { shortcut: shortcutLabels.newSession })}
								</TooltipContent>
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
						{groups.length === 0 && pinned.length === 0 && (
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
							// Past the limit, the rest folds; the active session stays visible below the fold while it is shut.
							const head = collapsible ? group.sessions.slice(0, COLLAPSED_SESSIONS) : group.sessions;
							const rest = collapsible ? group.sessions.slice(COLLAPSED_SESSIONS) : [];
							const activeInRest = open ? undefined : rest.find((session) => session.sessionId === activeSessionId);
							const shownCount =
								collapsible && !open
									? collapsedSessions(group.sessions, COLLAPSED_SESSIONS, activeSessionId).length
									: group.sessions.length;
							return (
								<section key={group.cwd} className="mb-3">
									<ContextMenu>
										<ContextMenuTrigger asChild>
											<div className="group/project flex items-center justify-between rounded-md px-2 py-1 data-[state=open]:bg-sidebar-accent">
												<span
													className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
													title={group.cwd}
												>
													{group.pinned && <Pin className="size-3 shrink-0" />}
													<FolderOpen className="size-3.5 shrink-0" />
													<span className="truncate">{basename(group.cwd) || group.cwd}</span>
												</span>
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
										{head.map((session) => (
											<SessionRow key={session.sessionId} session={session} />
										))}
									</ul>
									{rest.length > 0 && (
										<Collapse open={open}>
											<ul>
												{rest
													.filter((session) => session !== activeInRest)
													.map((session) => (
														<SessionRow key={session.sessionId} session={session} />
													))}
											</ul>
										</Collapse>
									)}
									{activeInRest && (
										<ul>
											<SessionRow session={activeInRest} />
										</ul>
									)}
									{collapsible && (
										<button
											type="button"
											aria-expanded={open}
											onClick={() => toggleExpanded(group.cwd)}
											className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
										>
											{open
												? t("sidebar.showLess")
												: t("sidebar.showMore", { count: group.sessions.length - shownCount })}
										</button>
									)}
								</section>
							);
						})}
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
				</div>
			</aside>
			<ResizeHandle />
		</>
	);
}
