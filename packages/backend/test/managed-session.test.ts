import type { SessionEvent, SessionEventEnvelope } from "@argon/shared";
import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionRuntime,
	type ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedSession } from "../src/managed-session.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

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
		session: {
			sessionId: sessionManager.getSessionId(),
			sessionManager,
			subscribe(listener: (event: AgentSessionEvent) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			bindExtensions: async () => emit({ type: "session_info_changed", name: "Set during bind" }),
			getAvailableThinkingLevels: () => ["off"],
			getContextUsage: () => undefined,
		},
		takeUnreportedDiagnostics: () => [],
	};
	// The SDK classes are nominal. The fake implements the runtime surface used by load and these events.
	vi.mocked(createAgentSessionRuntime).mockResolvedValueOnce(runtime as unknown as AgentSessionRuntime);
	const managed = await ManagedSession.load(
		{ kind: "new", cwd },
		{ agentDir: "/agent", modelRuntime: {} as ModelRuntime, settings: new ArgonSettingsStore("/argon") },
	);
	const events: SessionEventEnvelope[] = [];
	managed.subscribe((event) => events.push(event));
	return { managed, emit, events };
}

describe("ManagedSession event translation", () => {
	it("subscribes before binding and keeps the run active until agent_settled", async () => {
		const { managed, emit, events } = await loadSession();
		const initial = managed.snapshot();
		expect(initial.state.name).toBe("Set during bind");

		emit({ type: "agent_start" });
		expect(managed.snapshot().state.status).toBe("running");
		emit({ type: "agent_end", messages: [], willRetry: true });
		expect(managed.snapshot().state.status).toBe("running");
		emit({ type: "agent_settled", aborted: true });

		expect(events).toEqual([
			{ sessionId: managed.sessionId, seq: initial.seq + 1, event: { type: "run_started" } },
			{ sessionId: managed.sessionId, seq: initial.seq + 2, event: { type: "run_settled", aborted: true } },
		]);
		expect(managed.snapshot().state.status).toBe("idle");
		expect(managed.eventsSince(initial.seq)).toEqual(events);
	});

	it("streams assistant text and replaces the same item on message_end", async () => {
		const { managed, emit, events } = await loadSession();
		const message = {
			role: "assistant",
			api: "openai-responses",
			provider: "openai",
			model: "test-model",
			timestamp: 42,
			content: [],
			stopReason: "stop",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} as const;
		const partial = { ...message, content: [{ type: "text" as const, text: "Hel" }] };
		emit({ type: "message_start", message: { ...message, content: [] } });
		const itemId = managed.snapshot().state.items[0]?.id;
		expect(itemId).toBeDefined();
		emit({
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel", partial },
		});
		expect(managed.snapshot().state.items).toMatchObject([
			{ id: itemId, streaming: true, blocks: [{ type: "text", text: "Hel" }] },
		]);

		const finalBlock = { type: "text" as const, text: "Hello" };
		emit({ type: "message_end", message: { ...message, content: [finalBlock] } });

		expect(events.map(({ event }) => event)).toMatchObject([
			{ type: "item_added", item: { id: itemId, streaming: true, blocks: [] } },
			{ type: "assistant_delta", itemId, contentIndex: 0, blockType: "text", delta: "Hel" },
			{ type: "item_replaced", item: { id: itemId, streaming: false, blocks: [finalBlock] } },
		]);
		expect(managed.snapshot().state.items).toMatchObject([{ id: itemId, streaming: false, blocks: [finalBlock] }]);
	});

	it("translates top-level tool events and ignores nested tool events", async () => {
		const { managed, emit, events } = await loadSession();
		const args = { path: "note.txt" };
		const partialResult = { content: [{ type: "text", text: "Editing" }] };
		const result = {
			content: [
				{ type: "text", text: "Edited" },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			],
			details: { diff: "+1 updated" },
		};
		const toolEvents = [
			{ type: "tool_execution_start", toolCallId: "t1", toolName: "edit", args },
			{ type: "tool_execution_update", toolCallId: "t1", toolName: "edit", args, partialResult },
			{ type: "tool_execution_end", toolCallId: "t1", toolName: "edit", isError: false, durationMs: 23, result },
		] satisfies AgentSessionEvent[];
		for (const event of toolEvents) {
			emit({ ...event, toolCallId: "nested", parentToolCallId: "t1" });
			emit(event);
		}

		expect(events.map(({ event }) => event)).toEqual([
			{ type: "tool_started", toolCallId: "t1", name: "edit", args },
			{ type: "tool_updated", toolCallId: "t1", output: "Editing" },
			{
				type: "tool_ended",
				toolCallId: "t1",
				isError: false,
				output: "Edited",
				imageCount: 1,
				durationMs: 23,
				diff: "+1 updated",
			},
		] satisfies SessionEvent[]);
		expect(Object.keys(managed.snapshot().state.tools)).toEqual(["t1"]);
	});
});
