import type { ProjectTrustStatus, SessionEvent, SessionEventEnvelope } from "@argon/shared";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionRuntime,
	type ModelRuntime,
	type ResourceDiagnostic,
	SessionManager,
	SettingsManager,
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

async function loadSession(
	options: { modelFallbackMessage?: string; diagnostics?: AgentSessionRuntimeDiagnostic[] } = {},
) {
	const sessionManager = SessionManager.inMemory(cwd);
	vi.spyOn(SessionManager, "create").mockReturnValue(sessionManager);
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
	const diagnostics: ResourceDiagnostic[] = [];
	const reload = vi.fn(async () => undefined);
	const bindExtensions = vi.fn(async (_bindings: Parameters<AgentSession["bindExtensions"]>[0]) =>
		emit({ type: "session_info_changed", name: "Set during bind" }),
	);
	const runtime = {
		cwd,
		services: { settingsManager },
		session: {
			sessionId: sessionManager.getSessionId(),
			sessionManager,
			subscribe(listener: (event: AgentSessionEvent) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			bindExtensions,
			reload,
			resourceLoader: {
				getExtensions: () => ({ errors: [] }),
				getSkills: () => ({ diagnostics }),
				getPrompts: () => ({ diagnostics: [] }),
				getThemes: () => ({ diagnostics: [] }),
			},
			extensionRunner: {
				getCommandDiagnostics: () => [],
				getShortcutDiagnostics: () => [],
			},
			getAvailableThinkingLevels: () => ["off"],
			getContextUsage: () => undefined,
		},
		diagnostics: options.diagnostics ?? [],
		modelFallbackMessage: options.modelFallbackMessage,
		takeUnreportedDiagnostics: vi
			.fn()
			.mockReturnValueOnce(options.diagnostics ?? [])
			.mockReturnValue([]),
	};
	// The SDK classes are nominal. The fake implements the runtime surface used by load and these events.
	vi.mocked(createAgentSessionRuntime).mockResolvedValueOnce(runtime as unknown as AgentSessionRuntime);
	let trustStatus: ProjectTrustStatus = "undecided";
	const managed = await ManagedSession.load(
		{ kind: "new", cwd },
		{
			agentDir: "/agent",
			modelRuntime: {} as ModelRuntime,
			settings: new ArgonSettingsStore("/argon"),
			resolveProjectTrust: () => ({ trusted: trustStatus === "trusted", info: { status: trustStatus } }),
		},
	);
	const events: SessionEventEnvelope[] = [];
	managed.subscribe((event) => events.push(event));
	const bindings = bindExtensions.mock.calls[0]![0];
	return {
		managed,
		emit,
		events,
		diagnostics,
		reload,
		settingsManager,
		bindings,
		session: runtime.session as Record<string, unknown>,
		sessionManager,
		setTrustStatus: (status: ProjectTrustStatus) => {
			trustStatus = status;
		},
	};
}

describe("ManagedSession trust and diagnostics", () => {
	it("defers reload until the run settles and applies the latest decision", async () => {
		const { managed, emit, events, reload, settingsManager, setTrustStatus } = await loadSession();
		// The mocked runtime skips the factory; establish the initial applied trust.
		await managed.refreshProjectTrust();
		reload.mockClear();
		events.length = 0;
		emit({ type: "agent_start" });
		setTrustStatus("untrusted");
		await managed.refreshProjectTrust();
		setTrustStatus("trusted");
		await managed.refreshProjectTrust();
		emit({ type: "agent_end", messages: [], willRetry: true });
		expect(reload).not.toHaveBeenCalled();
		expect(settingsManager.isProjectTrusted()).toBe(false);

		emit({ type: "agent_settled", aborted: true });
		await vi.waitFor(() => expect(managed.snapshot().state.projectTrust?.status).toBe("trusted"));
		expect(settingsManager.isProjectTrusted()).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(events.map(({ event }) => event.type)).toEqual(["run_started", "run_settled", "project_trust_changed"]);
	});

	it("publishes trust status changes without reloading when the effective trust is unchanged", async () => {
		const { managed, events, reload, setTrustStatus } = await loadSession();
		await managed.refreshProjectTrust();
		reload.mockClear();
		events.length = 0;

		setTrustStatus("untrusted");
		await managed.refreshProjectTrust();

		expect(reload).not.toHaveBeenCalled();
		expect(events.map(({ event }) => event)).toEqual([
			{ type: "project_trust_changed", trust: { status: "untrusted" } },
		]);
	});

	it("replaces resource diagnostics on reload and keeps model and extension diagnostics", async () => {
		const { managed, events, bindings, diagnostics } = await loadSession({
			modelFallbackMessage: "Could not restore model",
			diagnostics: [{ type: "error", message: "Initial resource error" }],
		});
		expect(managed.snapshot().state.diagnostics).toMatchObject([
			{ level: "error", source: "resources", message: "Initial resource error" },
			{ level: "warning", source: "model", message: "Could not restore model" },
		]);
		bindings.onError?.({ extensionPath: "/extension.ts", event: "test", error: "Broken handler" });
		expect(events.at(-1)?.event).toMatchObject({ type: "notification", level: "error" });
		diagnostics.push({ type: "collision", message: "Duplicate skill", path: "/skill.md" });
		await bindings.commandContextActions?.reload();
		const after = managed.snapshot().state.diagnostics;
		expect(after).toMatchObject([
			{ source: "model" },
			{ source: "extension", level: "error", path: "/extension.ts" },
			{ source: "resources", level: "warning", message: "Duplicate skill", path: "/skill.md" },
		]);
		events.length = 0;
		await bindings.commandContextActions?.reload();
		expect(managed.snapshot().state.diagnostics).toBe(after);
		expect(events).toEqual([]);
	});

	it("keeps the newest 100 diagnostics", async () => {
		const { managed, bindings } = await loadSession();
		for (let i = 0; i < 101; i++) {
			bindings.onError?.({ extensionPath: "/extension.ts", event: "test", error: `Error ${i}` });
		}
		const { diagnostics } = managed.snapshot().state;
		expect(diagnostics).toHaveLength(100);
		expect(diagnostics[0]?.message).toBe("Extension error in /extension.ts: Error 1");
		expect(diagnostics.at(-1)?.message).toBe("Extension error in /extension.ts: Error 100");
	});
});

describe("ManagedSession editMessage", () => {
	it("resends the original message's images with the edited text", async () => {
		const { managed, session, sessionManager } = await loadSession();
		const image = { type: "image", data: "aW1n", mimeType: "image/png" } as const;
		const entryId = sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "what is this?" }, image],
			timestamp: 1,
		});
		const navigateTree = vi.fn(async () => ({ cancelled: false }));
		const prompt = vi.fn(async (_text: string, options: { preflightResult?: (d: "started") => void }) => {
			options.preflightResult?.("started");
		});
		Object.assign(session, { navigateTree, prompt, isStreaming: false });

		await expect(managed.editMessage({ itemId: entryId, text: "and now?", clientMessageId: "c1" })).resolves.toBe(
			"started",
		);
		expect(navigateTree).toHaveBeenCalledWith(entryId, {});
		expect(prompt).toHaveBeenCalledWith(
			"and now?",
			expect.objectContaining({ images: [{ type: "image", data: "aW1n", mimeType: "image/png" }] }),
		);
	});

	it("sends no images when the original message had none", async () => {
		const { managed, session, sessionManager } = await loadSession();
		const entryId = sessionManager.appendMessage({ role: "user", content: "plain", timestamp: 1 });
		const prompt = vi.fn(async (_text: string, options: { preflightResult?: (d: "started") => void }) => {
			options.preflightResult?.("started");
		});
		Object.assign(session, { navigateTree: vi.fn(async () => ({ cancelled: false })), prompt, isStreaming: false });

		await managed.editMessage({ itemId: entryId, text: "edited", clientMessageId: "c2" });
		expect(prompt).toHaveBeenCalledWith("edited", expect.objectContaining({ images: undefined }));
	});
});

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
