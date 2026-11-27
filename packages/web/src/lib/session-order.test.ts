import type { SessionSummary } from "@argon/shared";
import { describe, expect, it } from "vitest";
import { collapsedSessions, groupByProject, pinnedSessions } from "./session-order";

const session = (sessionId: string, archived?: boolean): SessionSummary => ({
	sessionId,
	sessionPath: `/project/${sessionId}.jsonl`,
	cwd: "/project",
	createdAt: 1,
	modifiedAt: 2,
	messageCount: 1,
	firstMessage: "",
	loaded: false,
	running: false,
	archived,
});
const sessions = [session("active"), session("archived", true)];
const projects = [{ cwd: "/empty", addedAt: 1 }];

describe("groupByProject archives", () => {
	it("excludes archives by default and preserves added empty projects", () => {
		const groups = groupByProject(sessions, projects, "");
		expect(groups.map((group) => group.cwd)).toEqual(["/project", "/empty"]);
		expect(groups[0]?.sessions.map((item) => item.sessionId)).toEqual(["active"]);
	});
	it("shows only archives and omits empty added projects", () => {
		const groups = groupByProject(sessions, projects, "", { archived: true });
		expect(groups).toHaveLength(1);
		expect(groups[0]?.sessions.map((item) => item.sessionId)).toEqual(["archived"]);
		expect(groupByProject(sessions, projects, "missing", { archived: true })).toEqual([]);
	});
});

describe("pinned sessions", () => {
	const pinned = (sessionId: string, pinnedAt: number, extra?: Partial<SessionSummary>) => ({
		...session(sessionId),
		pinnedAt,
		...extra,
	});
	const list = [session("plain"), pinned("old", 1), pinned("new", 2, { name: "Release notes" })];

	it("lists pins apart, newest pin first, and keeps them out of project groups", () => {
		expect(pinnedSessions(list, "").map((s) => s.sessionId)).toEqual(["new", "old"]);
		expect(groupByProject(list, [], "")[0]?.sessions.map((s) => s.sessionId)).toEqual(["plain"]);
	});
	it("filters pins by the search and ignores archived ones", () => {
		expect(pinnedSessions(list, "release").map((s) => s.sessionId)).toEqual(["new"]);
		expect(pinnedSessions([pinned("gone", 3, { archived: true })], "")).toEqual([]);
	});
});

describe("collapsedSessions", () => {
	const list = ["a", "b", "c", "d"].map((id) => session(id));
	it("shows the first ones plus the active session when it is further down", () => {
		expect(collapsedSessions(list, 2).map((s) => s.sessionId)).toEqual(["a", "b"]);
		expect(collapsedSessions(list, 2, "d").map((s) => s.sessionId)).toEqual(["a", "b", "d"]);
		expect(collapsedSessions(list, 2, "a").map((s) => s.sessionId)).toEqual(["a", "b"]);
	});
});
