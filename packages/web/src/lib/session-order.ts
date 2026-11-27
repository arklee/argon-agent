import type { ProjectPrefs, SessionSummary } from "@argon/shared";

interface ProjectGroup extends ProjectPrefs {
	sessions: SessionSummary[];
	latest: number;
}

export function groupByProject(
	sessions: SessionSummary[],
	projects: ProjectPrefs[],
	search: string,
	options?: { archived?: boolean },
): ProjectGroup[] {
	const groups = new Map<string, ProjectGroup>();
	const prefs = new Map(projects.map((p) => [p.cwd, p]));
	const query = search.trim().toLowerCase();
	// Added projects are listed even before their first session (while searching: when the path matches).
	for (const project of projects) {
		if (options?.archived || !project.addedAt || (query && !project.cwd.toLowerCase().includes(query))) continue;
		groups.set(project.cwd, { ...project, sessions: [], latest: project.addedAt });
	}
	for (const session of sessions) {
		if (!!session.archived !== !!options?.archived) continue;
		// Pinned sessions are listed apart (pinnedSessions), not under their project.
		if (!options?.archived && session.pinnedAt !== undefined) continue;
		if (!matches(session, query)) continue;
		const group = groups.get(session.cwd) ?? { cwd: session.cwd, ...prefs.get(session.cwd), sessions: [], latest: 0 };
		group.sessions.push(session);
		group.latest = Math.max(group.latest, session.modifiedAt);
		groups.set(session.cwd, group);
	}
	return [...groups.values()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.latest - a.latest);
}

function matches(session: SessionSummary, query: string): boolean {
	return (
		!query || [session.name, session.firstMessage, session.cwd].some((value) => value?.toLowerCase().includes(query))
	);
}

/** Pinned, unarchived sessions matching the search, most recently pinned first (whatever their project's visibility). */
export function pinnedSessions(sessions: SessionSummary[], search: string): SessionSummary[] {
	const query = search.trim().toLowerCase();
	return sessions
		.filter((session) => session.pinnedAt !== undefined && !session.archived && matches(session, query))
		.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
}

/**
 * The sessions a collapsed project shows: the first `limit`, plus the active one when it is further
 * down (so the open session never disappears from the sidebar).
 */
export function collapsedSessions(sessions: SessionSummary[], limit: number, activeSessionId?: string) {
	const shown = sessions.slice(0, limit);
	const active = sessions.slice(limit).find((session) => session.sessionId === activeSessionId);
	return active ? [...shown, active] : shown;
}

export function visibleProjects(groups: ProjectGroup[], showHidden: boolean) {
	return groups.filter((group) => showHidden || !group.hidden);
}
