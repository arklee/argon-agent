import type { SessionSummary } from "@argon/shared";

interface ProjectGroup {
	cwd: string;
	sessions: SessionSummary[];
	latest: number;
}

export function groupByProject(sessions: SessionSummary[]): ProjectGroup[] {
	const groups = new Map<string, ProjectGroup>();
	for (const session of sessions) {
		const group = groups.get(session.cwd) ?? { cwd: session.cwd, sessions: [], latest: 0 };
		if (group.sessions.length < 20) group.sessions.push(session);
		group.latest = Math.max(group.latest, session.modifiedAt);
		groups.set(session.cwd, group);
	}
	return [...groups.values()].sort((a, b) => b.latest - a.latest);
}
