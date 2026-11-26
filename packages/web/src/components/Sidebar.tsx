import type { SessionSummary } from "@argon/shared";
import { Ellipsis, FolderOpen, Pin, Plus, Server, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import { NewSessionDialog } from "@/components/NewSessionDialog";
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
	const sessions = useApp((s) => s.sessions);
	const environment = useApp((s) => s.environment);
	const connection = useApp((s) => s.connection);
	const dialog = useApp((s) => s.newSessionDialog);
	const setDialog = useApp((s) => s.setNewSessionDialog);
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
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="New session"
							onClick={() => setDialog({ open: true })}
							disabled={!environment}
						>
							<SquarePen />
						</Button>
					</TooltipTrigger>
					<TooltipContent>New session ({shortcutLabels.newSession})</TooltipContent>
				</Tooltip>
			</div>

			<div className="px-3 pb-3">
				<Input
					aria-label="Search sessions"
					placeholder="Search sessions"
					value={search}
					onChange={(e) => useApp.setState({ search: e.target.value })}
					onKeyDown={(e) => {
						if (!e.nativeEvent.isComposing && e.key === "Escape") useApp.setState({ search: "" });
					}}
				/>
			</div>
			<nav className="flex-1 overflow-y-auto px-2 pb-2">
				{groups.length === 0 && (
					<p className="px-2 py-6 text-center text-sm text-muted-foreground">
						{search ? "No matching sessions" : "No sessions to show"}
					</p>
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
										<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${group.cwd}`}>
											<Ellipsis />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onSelect={() => void updateProject({ cwd: group.cwd, pinned: !group.pinned })}>
											{group.pinned ? "Unpin" : "Pin"}
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={() => void updateProject({ cwd: group.cwd, hidden: !group.hidden })}>
											{group.hidden ? "Unhide" : "Hide project"}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={`New session in ${group.cwd}`}
									className="opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
									onClick={() => setDialog({ open: true, path: group.cwd })}
								>
									<Plus />
								</Button>
							</div>
						</div>
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
						{showHidden ? "Hide" : "Show"} {hidden} hidden {hidden === 1 ? "project" : "projects"}
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
					title={connection?.status}
				/>
			</div>

			<NewSessionDialog
				open={dialog.open}
				initialPath={dialog.path}
				onOpenChange={(open) => setDialog({ ...dialog, open })}
			/>
		</aside>
	);
}
