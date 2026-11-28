import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionRuntime,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedSession } from "./managed-session.ts";
import { ArgonSettingsStore } from "./settings.ts";
import { MESSAGE_TIMING_ENTRY, messageToItem, projectHistory } from "./translate.ts";

vi.mock(import("@earendil-works/pi-coding-agent"), async (importOriginal) => ({
	...(await importOriginal()),
	createAgentSessionRuntime: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());
const cwd = "/project";

async function loadSession() {
	const sessionManager = SessionManager.inMemory(cwd);
	vi.spyOn(SessionManager, "create").mockReturnValue(sessionManager);
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const runtime = {
		cwd,
		services: { settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }) },
		session: {
			sessionId: sessionManager.getSessionId(),
			sessionManager,
			getActiveToolNames: () => [],
			setActiveToolsByName: vi.fn(),
			subscribe(listener: (event: AgentSessionEvent) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			bindExtensions: vi.fn(),
			resourceLoader: {
				getExtensions: () => ({ errors: [] }),
				getSkills: () => ({ diagnostics: [] }),
				getPrompts: () => ({ diagnostics: [] }),
				getThemes: () => ({ diagnostics: [] }),
			},
			extensionRunner: { getCommandDiagnostics: () => [], getShortcutDiagnostics: () => [] },
			getAllTools: () => [],
			getAvailableThinkingLevels: () => ["off"],
			getContextUsage: () => undefined,
		},
		diagnostics: [],
		takeUnreportedDiagnostics: () => [],
	};
	vi.mocked(createAgentSessionRuntime).mockResolvedValueOnce(runtime as unknown as AgentSessionRuntime);
	const managed = await ManagedSession.load(
		{ kind: "new", cwd },
		{
			agentDir: "/agent",
			settings: new ArgonSettingsStore("/argon", undefined, { supported: true, mechanism: "seatbelt" }),
			modelRuntime: {} as ModelRuntime,
			resolveProjectTrust: async () => ({ trusted: false, info: { status: "undecided" } }),
		},
	);
	return { managed, emit, sessionManager };
}

describe("assistant message timing", () => {
	const message = () => ({
		role: "assistant" as const,
		timestamp: 10,
		content: [{ type: "text" as const, text: "Done" }],
		api: "openai-responses" as const,
		provider: "openai",
		model: "test",
		stopReason: "stop" as const,
		usage: {
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});

	it.each(["text_delta", "thinking_delta", "toolcall_start", "toolcall_delta"] as const)(
		"times from the first %s and persists after pi appends the message",
		async (type) => {
			const { managed, emit, sessionManager } = await loadSession();
			const assistant = message();
			const now = vi.spyOn(Date, "now").mockReturnValue(100);
			emit({ type: "message_start", message: assistant });
			emit({
				type: "message_update",
				message: assistant,
				assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: assistant },
			});
			now.mockReturnValue(200);
			const delta = {
				type: "message_update",
				message: assistant,
				assistantMessageEvent: { type, contentIndex: 0, delta: "x", partial: assistant },
			} as AgentSessionEvent;
			emit(delta);
			now.mockReturnValue(300);
			emit(delta);
			now.mockReturnValue(500);
			emit({ type: "message_end", message: assistant });
			// Match pi 1.7's ordering: subscribers run before synchronous persistence.
			expect(sessionManager.getEntries()).toHaveLength(0);
			const entryId = sessionManager.appendMessage(assistant);
			// Exercise the identity lookup when other metadata is now the leaf.
			sessionManager.appendCustomEntry("other", {});
			await Promise.resolve();
			const history = projectHistory(sessionManager.getBranch());
			const live = managed.snapshot().state.items[0];
			expect(live).toMatchObject({ timestamp: 10, completedAt: 500, generationMs: 300, streaming: false });
			expect(history.items).toEqual([{ ...live, id: entryId }]);
			expect(sessionManager.getLeafEntry()).toMatchObject({
				type: "custom",
				customType: MESSAGE_TIMING_ENTRY,
				data: { messageEntryId: entryId, completedAt: 500, generationMs: 300 },
			});
			expect(sessionManager.buildSessionContext().messages).toEqual([assistant]);

			// A subsequent assistant with no deltas must not inherit the previous start time.
			const next = message();
			emit({ type: "message_start", message: next });
			emit({ type: "message_end", message: next });
			sessionManager.appendMessage(next);
			await Promise.resolve();
			expect(managed.snapshot().state.items[1]).not.toHaveProperty("generationMs");
			expect(projectHistory(sessionManager.getBranch()).items[1]).not.toHaveProperty("generationMs");
		},
	);

	it("ignores malformed and orphan timings, without adding transcript items", () => {
		const manager = SessionManager.inMemory(cwd);
		const id = manager.appendMessage(message());
		for (const data of [
			null,
			[],
			"bad",
			{},
			{ messageEntryId: id },
			{ messageEntryId: id, completedAt: NaN },
			{ messageEntryId: id, completedAt: Infinity },
			{ messageEntryId: id, completedAt: -1 },
			{ messageEntryId: id, completedAt: "500" },
			{ messageEntryId: id, completedAt: 500, generationMs: -1 },
			{ messageEntryId: id, completedAt: 500, generationMs: Infinity },
			{ messageEntryId: id, completedAt: 500, generationMs: null },
			{ messageEntryId: "missing", completedAt: 500 },
		]) {
			manager.appendCustomEntry(MESSAGE_TIMING_ENTRY, data);
		}
		expect(projectHistory(manager.getBranch()).items).toEqual([messageToItem(message(), id)]);
		manager.appendCustomEntry(MESSAGE_TIMING_ENTRY, { messageEntryId: id, completedAt: 500 });
		const item = projectHistory(manager.getBranch()).items[0];
		expect(item).toMatchObject({ id, timestamp: 10, completedAt: 500 });
		expect(item).not.toHaveProperty("generationMs");
	});

	it("restores the same timings from the persisted session file", () => {
		const dir = mkdtempSync(join(tmpdir(), "argon-message-timing-"));
		try {
			const manager = SessionManager.create(cwd, dir);
			const id = manager.appendMessage(message());
			manager.appendCustomEntry(MESSAGE_TIMING_ENTRY, { messageEntryId: id, completedAt: 500, generationMs: 300 });
			const reopened = SessionManager.open(manager.getSessionFile()!);
			expect(projectHistory(reopened.getBranch()).items).toEqual(projectHistory(manager.getBranch()).items);
			expect(projectHistory(reopened.getBranch()).items[0]).toMatchObject({ id, completedAt: 500, generationMs: 300 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("retains timings through compaction, user-message branching and forks", () => {
		const manager = SessionManager.inMemory(cwd);
		const id = manager.appendMessage(message());
		const timingId = manager.appendCustomEntry(MESSAGE_TIMING_ENTRY, {
			messageEntryId: id,
			completedAt: 500,
			generationMs: 0,
		});
		const userId = manager.appendMessage({ role: "user", content: "next", timestamp: 600 });
		manager.appendCompaction("summary", userId, 100);
		expect(projectHistory(manager.getBranch()).items[0]).toMatchObject({ completedAt: 500, generationMs: 0 });
		// Fork/edit of a user message starts from its parent, retaining the previous timing.
		expect(manager.getEntry(userId)?.parentId).toBe(timingId);
		manager.branch(timingId);
		manager.createBranchedSession(timingId);
		expect(projectHistory(manager.getBranch()).items).toHaveLength(1);
		expect(projectHistory(manager.getBranch()).items[0]).toMatchObject({ id, completedAt: 500, generationMs: 0 });
		expect(manager.buildSessionContext().messages).toEqual([message()]);
	});
});
