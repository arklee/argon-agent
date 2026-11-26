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
		if (
			query &&
			![session.name, session.firstMessage, session.cwd].some((value) => value?.toLowerCase().includes(query))
		)
			continue;
		const group = groups.get(session.cwd) ?? { cwd: session.cwd, ...prefs.get(session.cwd), sessions: [], latest: 0 };
		if (group.sessions.length < 20) group.sessions.push(session);
		group.latest = Math.max(group.latest, session.modifiedAt);
		groups.set(session.cwd, group);
	}
	return [...groups.values()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.latest - a.latest);
}

export function visibleProjects(groups: ProjectGroup[], showHidden: boolean) {
	return groups.filter((group) => showHidden || !group.hidden);
}
