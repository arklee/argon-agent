import { FolderOpen, Plus, Server, SquarePen } from "lucide-react";
import { useMemo } from "react";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basename, relativeTime, sessionTitle } from "@/lib/format";
import { groupByProject } from "@/lib/session-order";
import { shortcutLabels } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

export function Sidebar() {
	const sessions = useApp((s) => s.sessions);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const openSession = useApp((s) => s.openSession);
	const environment = useApp((s) => s.environment);
	const connection = useApp((s) => s.connection);
	const dialog = useApp((s) => s.newSessionDialog);
	const setDialog = useApp((s) => s.setNewSessionDialog);
	const groups = useMemo(() => groupByProject(sessions), [sessions]);

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

			<nav className="flex-1 overflow-y-auto px-2 pb-2">
				{groups.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No sessions yet</p>}
				{groups.map((group) => (
					<section key={group.cwd} className="mb-3">
						<div className="group/project flex items-center justify-between px-2 py-1">
							<span
								className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
								title={group.cwd}
							>
								<FolderOpen className="size-3.5 shrink-0" />
								<span className="truncate">{basename(group.cwd) || group.cwd}</span>
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								className="opacity-0 group-hover/project:opacity-100"
								onClick={() => setDialog({ open: true, path: group.cwd })}
							>
								<Plus />
							</Button>
						</div>
						<ul>
							{group.sessions.map((session) => (
								<li key={session.sessionId}>
									<button
										type="button"
										onClick={() => void openSession(session)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent",
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
								</li>
							))}
						</ul>
					</section>
				))}
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
