import type { SessionSummary } from "@argon/shared";
import { ArchiveRestore, FolderOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionActions } from "@/components/SessionMenu";
import { Group } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { basename, relativeTime, sessionTitle } from "@/lib/format";
import { groupByProject } from "@/lib/session-order";
import { useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";

function ArchivedRow({ session }: { session: SessionSummary }) {
	const { t } = useTranslation();
	const { deleteDialog, requestDelete } = useSessionActions(session, () => undefined);
	const title = sessionTitle(session);
	const open = () => {
		useSettings.getState().close();
		void useApp.getState().openSession(session);
	};
	return (
		<div className="flex items-center gap-3 py-2">
			<button
				type="button"
				onClick={open}
				title={t("settings.archived.open")}
				className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
			>
				{title}
			</button>
			<span className="shrink-0 text-xs text-muted-foreground">{relativeTime(session.modifiedAt)}</span>
			<div className="flex shrink-0 items-center">
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`${t("sessionMenu.unarchive")}: ${title}`}
					title={t("sessionMenu.unarchive")}
					onClick={() => void useApp.getState().setArchived(session, false)}
				>
					<ArchiveRestore />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					className="text-muted-foreground hover:text-destructive"
					aria-label={`${t("sessionMenu.delete")}: ${title}`}
					title={t("sessionMenu.delete")}
					onClick={requestDelete}
				>
					<Trash2 />
				</Button>
			</div>
			{deleteDialog}
		</div>
	);
}

/** Archived sessions, by project: open, unarchive or delete them. They are not listed in the sidebar. */
export function ArchivedSection() {
	const { t } = useTranslation();
	const sessions = useApp((s) => s.sessions);
	const projects = useApp((s) => s.projects);
	const [search, setSearch] = useState("");
	const groups = useMemo(
		() => groupByProject(sessions, projects, search, { archived: true }),
		[sessions, projects, search],
	);
	const hasArchived = sessions.some((s) => s.archived);

	if (!hasArchived)
		return <p className="py-8 text-center text-sm text-muted-foreground">{t("settings.archived.empty")}</p>;
	return (
		<>
			<Input
				aria-label={t("settings.archived.search")}
				placeholder={t("settings.archived.search")}
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				className="mb-5 h-8"
			/>
			{groups.length === 0 && (
				<p className="py-8 text-center text-sm text-muted-foreground">{t("settings.archived.noMatch")}</p>
			)}
			{groups.map((group) => (
				<section key={group.cwd} className="mb-6 last:mb-0">
					<h3
						className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
						title={group.cwd}
					>
						<FolderOpen className="size-3.5 shrink-0" />
						<span className="truncate">{basename(group.cwd) || group.cwd}</span>
					</h3>
					<Group>
						{group.sessions.map((session) => (
							<ArchivedRow key={session.sessionId} session={session} />
						))}
					</Group>
				</section>
			))}
		</>
	);
}
