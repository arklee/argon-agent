import type { SessionSummary } from "@argon/shared";
import { describe, expect, it } from "vitest";
import { groupByProject } from "./session-order";

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
