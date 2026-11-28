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
import { type ExtensionSessionHost, ManagedSession } from "../src/managed-session.ts";
import { ArgonSettingsStore } from "../src/settings.ts";
import { resolveToolPreset } from "../src/tool-presets.ts";

vi.mock(import("@earendil-works/pi-coding-agent"), async (importOriginal) => ({
	...(await importOriginal()),
	createAgentSessionRuntime: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

const cwd = "/project";

async function loadSession(
	options: {
		modelFallbackMessage?: string;
		sessionHost?: ExtensionSessionHost;
		shutdownDuringBind?: boolean;
		diagnostics?: AgentSessionRuntimeDiagnostic[];
		setup?: (sessionManager: SessionManager) => void;
		activeTools?: string[];
		modelId?: string;
		defaultPreset?: string;
		sandboxSupported?: boolean;
		toolSources?: Record<string, string>;
	} = {},
) {
	const sessionManager = SessionManager.inMemory(cwd);
	options.setup?.(sessionManager);
	vi.spyOn(SessionManager, "create").mockReturnValue(sessionManager);
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
	const diagnostics: ResourceDiagnostic[] = [];
	const reload = vi.fn(async () => undefined);
	const bindExtensions = vi.fn(async (_bindings: Parameters<AgentSession["bindExtensions"]>[0]) => {
		emit({ type: "session_info_changed", name: "Set during bind" });
		if (options.shutdownDuringBind) _bindings.shutdownHandler?.();
	});
	let activeTools = options.activeTools ?? ["read", "custom"];
	const setActiveToolsByName = vi.fn((names: string[]) => {
		activeTools = names;
	});
	const runtime = {
		cwd,
		services: { settingsManager },
		session: {
			sessionId: sessionManager.getSessionId(),
			model: options.modelId ? { id: options.modelId } : undefined,
			getActiveToolNames: () => activeTools,
			setActiveToolsByName,
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
			getAllTools: () =>
				Object.entries(options.toolSources ?? {}).map(([name, source]) => ({ name, sourceInfo: { source } })),
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
	const settings = new ArgonSettingsStore("/argon", undefined, {
		supported: options.sandboxSupported ?? true,
		mechanism: "seatbelt",
	});
	if (options.defaultPreset)
		vi.spyOn(settings, "get").mockReturnValue({ ...settings.get(), defaultToolPreset: options.defaultPreset });
	const managed = await ManagedSession.load(
		{ kind: "new", cwd },
		{
			agentDir: "/agent",
			sessionHost: options.sessionHost,
			modelRuntime: {} as ModelRuntime,
			settings,
			resolveProjectTrust: async () => ({ trusted: trustStatus === "trusted", info: { status: trustStatus } }),
		},
	);
	const events: SessionEventEnvelope[] = [];
	managed.subscribe((event) => events.push(event));
	const bindings = bindExtensions.mock.calls[0]![0];
	return {
		managed,
		setActiveToolsByName,
		emit,
		events,
		diagnostics,
		reload,
		settingsManager,
		settings,
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

	it("defers MCP config reloads until settle and coalesces edits with the same trust decision", async () => {
		const { managed, emit, reload } = await loadSession();
		await managed.refreshProjectTrust();
		reload.mockClear();
		emit({ type: "agent_start" });
		await managed.refreshProjectTrust(true);
		await managed.refreshProjectTrust(true);
		emit({ type: "agent_end", messages: [], willRetry: true });
		expect(reload).not.toHaveBeenCalled();
		expect(managed.configRefreshPending).toBe(true);
		emit({ type: "agent_settled", aborted: false });
		await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(managed.configRefreshPending).toBe(false));
	});
	it("keeps a failed configuration reload pending and allows retry", async () => {
		const { managed, reload } = await loadSession();
		await managed.refreshProjectTrust();
		reload.mockRejectedValueOnce(new Error("reload failed"));
		await expect(managed.refreshProjectTrust(true)).rejects.toThrow("reload failed");
		expect(managed.configRefreshPending).toBe(true);
		await managed.refreshProjectTrust(true);
		expect(managed.configRefreshPending).toBe(false);
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

describe("ManagedSession diagnostics, notifications and approvals", () => {
	it("folds repeated extension errors and clears everything but resource problems", async () => {
		const { managed, bindings } = await loadSession({ diagnostics: [{ type: "error", message: "Resource error" }] });
		for (let i = 0; i < 3; i++) bindings.onError?.({ extensionPath: "/e.ts", event: "test", error: "Same" });
		bindings.onError?.({ extensionPath: "/e.ts", event: "test", error: "Other" });
		expect(managed.snapshot().state.diagnostics).toMatchObject([
			{ source: "resources", message: "Resource error" },
			{ source: "extension", message: "Extension error in /e.ts: Same", count: 3 },
			{ source: "extension", message: "Extension error in /e.ts: Other" },
		]);
		managed.clearDiagnostics();
		expect(managed.snapshot().state.diagnostics).toMatchObject([{ source: "resources", message: "Resource error" }]);
		expect(managed.snapshot().state.diagnostics).toHaveLength(1);
	});

	it("hands notifications sent while no client was attached to the first client snapshot", async () => {
		const { managed, bindings } = await loadSession();
		bindings.uiContext?.notify("Set up the session", "info");
		expect(managed.clientSnapshot().notifications).toEqual([
			{ type: "notification", level: "info", message: "Set up the session" },
		]);
		expect(managed.clientSnapshot().notifications).toBeUndefined();
		const unsubscribe = managed.subscribeClient(() => {});
		bindings.uiContext?.notify("Seen live", "info");
		unsubscribe();
		expect(managed.clientSnapshot().notifications).toBeUndefined();
	});

	it("clears only replayed notifications from later snapshots", async () => {
		const { managed, bindings } = await loadSession();
		bindings.uiContext?.notify("Replayed", "info");
		const throughSeq = managed.snapshot().seq;
		bindings.uiContext?.notify("Still pending", "info");
		managed.markDelivered(throughSeq);
		expect(managed.clientSnapshot().notifications?.map((event) => event.message)).toEqual(["Still pending"]);
	});

	it("disposes and clears widgets on each reload while keeping the bridge usable", async () => {
		const { managed, bindings, reload, events } = await loadSession();
		const ui = bindings.uiContext!;
		const dispose = vi.fn();
		const mount = () => {
			ui.setWidget("plain", ["text"]);
			ui.setWidget("component", () => ({ render: () => ["component"], invalidate() {}, dispose }));
		};
		mount();
		reload.mockImplementation(async () => {
			expect(managed.snapshot().state.widgets).toEqual([]);
			mount();
		});
		await bindings.commandContextActions?.reload();
		await bindings.commandContextActions?.reload();
		expect(dispose).toHaveBeenCalledTimes(2);
		expect(managed.snapshot().state.widgets).toHaveLength(2);
		expect(events.filter(({ event }) => event.type === "widget_changed" && !event.widget)).toHaveLength(4);
		ui.setWidget("component", undefined);
	});

	it("retries shutdown requested during initial bind after registration", async () => {
		const shutdown = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
		const { managed } = await loadSession({
			shutdownDuringBind: true,
			sessionHost: { shutdown, createSession: vi.fn(), openSession: vi.fn(), announce: vi.fn() },
		});
		expect(shutdown).toHaveBeenCalledTimes(1);
		managed.resumeAfterRegister();
		expect(shutdown).toHaveBeenCalledTimes(2);
		managed.resumeAfterRegister();
		expect(shutdown).toHaveBeenCalledTimes(2);
	});

	it("keeps text and component widgets and the working message in the state", async () => {
		const { managed, bindings } = await loadSession();
		const ui = bindings.uiContext!;
		ui.setWidget("plain", ["\u001b[1mBold\u001b[0m", "two"]);
		let text = "first";
		let requestRender: (() => void) | undefined;
		ui.setWidget(
			"component",
			(tui) => {
				requestRender = () => (tui as { requestRender(): void }).requestRender();
				return { render: (width: number) => [`${text} @${width}`], invalidate() {} };
			},
			{ placement: "belowEditor" },
		);
		ui.setWorkingMessage("Indexing");
		expect(managed.snapshot().state.widgets).toEqual([
			{ key: "plain", lines: ["Bold", "two"], placement: "aboveEditor" },
			{ key: "component", lines: ["first @100"], placement: "belowEditor" },
		]);
		expect(managed.snapshot().state.workingMessage).toBe("Indexing");
		text = "second";
		requestRender?.();
		await vi.waitFor(() => expect(managed.snapshot().state.widgets[1]?.lines).toEqual(["second @100"]));
		ui.setWidget("plain", undefined);
		expect(managed.snapshot().state.widgets.map((w) => w.key)).toEqual(["component"]);
	});

	it("stores allow-for-session choices and denied calls in the session file", async () => {
		type Check = { checkToolCall(check: unknown): Promise<unknown> };
		const check = (managed: unknown, toolCallId: string, toolName = "extension_tool") =>
			(managed as Check).checkToolCall({ toolCallId, toolName, input: { command: "make" }, signal: undefined });
		const answer = async (managed: ManagedSession, response: Parameters<ManagedSession["respond"]>[1]) => {
			await vi.waitFor(() => expect(managed.snapshot().state.pendingInteractions).toHaveLength(1));
			managed.respond(managed.snapshot().state.pendingInteractions[0]!.id, response);
		};
		const first = await loadSession();
		const allowed = check(first.managed, "t1");
		await answer(first.managed, { decision: "allow_session" });
		await expect(allowed).resolves.toEqual({ allow: true });
		await expect(check(first.managed, "t2")).resolves.toEqual({ allow: true });
		const denied = check(first.managed, "t3", "custom");
		await answer(first.managed, { decision: "deny", reason: "not now" });
		await expect(denied).resolves.toEqual({ allow: false, reason: "Denied by user: not now" });

		const custom = first.sessionManager
			.getEntries()
			.flatMap((e) => (e.type === "custom" ? [{ type: e.customType, data: e.data }] : []));
		expect(custom).toEqual([
			{ type: "argon.session_allow", data: { tool: "extension_tool" } },
			{ type: "argon.tool_blocked", data: { toolCallId: "t3", reason: "Denied by user: not now" } },
		]);

		const reopened = await loadSession({
			setup: (sessionManager) => {
				for (const entry of custom) sessionManager.appendCustomEntry(entry.type, entry.data);
			},
		});
		await expect(check(reopened.managed, "t4")).resolves.toEqual({ allow: true });
		expect(reopened.managed.snapshot().state.pendingInteractions).toEqual([]);
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

	it("describes history and completed live tool calls using the current tool sources", async () => {
		const block = { type: "toolCall", id: "history", name: "read", arguments: { path: "note.txt" } } as const;
		const message = {
			role: "assistant",
			api: "openai-responses",
			provider: "openai",
			model: "test-model",
			timestamp: 42,
			content: [block],
			stopReason: "toolUse",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} satisfies Extract<AgentSessionEvent, { type: "message_end" }>["message"];
		const toolSources: Record<string, string> = { read: "builtin" };
		const { managed, emit, events, bindings } = await loadSession({
			setup: (sessionManager) => sessionManager.appendMessage(message),
			toolSources,
		});
		const display = { kind: "file_read", title: "read", path: "note.txt", summary: "note.txt" };
		const expected = { type: "toolCall", name: "read", args: block.arguments, display };
		expect(managed.snapshot().state.items).toMatchObject([
			{ blocks: [{ ...expected, toolCallId: "history", source: "builtin" }] },
		]);

		toolSources.read = "npm:test-extension";
		await bindings.commandContextActions?.reload();
		const live = { ...message, content: [{ ...block, id: "live" }] };
		emit({ type: "message_start", message: { ...live, content: [] } });
		emit({
			type: "message_update",
			message: live,
			assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: live },
		});
		const streaming = managed.snapshot().state.items.at(-1);
		expect(streaming).toMatchObject({ streaming: true, blocks: [{ type: "toolCall", toolCallId: "live" }] });
		expect(streaming?.kind === "assistant" && streaming.blocks[0]).not.toHaveProperty("display");
		expect(streaming?.kind === "assistant" && streaming.blocks[0]).not.toHaveProperty("source");

		emit({ type: "message_end", message: live });
		expect(events.at(-1)?.event).toMatchObject({
			type: "item_replaced",
			item: { blocks: [{ ...expected, toolCallId: "live", source: "npm:test-extension" }] },
		});

		delete toolSources.read;
		const removed = { ...live, content: [{ ...block, id: "removed" }] };
		emit({ type: "message_start", message: { ...removed, content: [] } });
		emit({ type: "message_end", message: removed });
		const item = managed.snapshot().state.items.at(-1);
		expect(item?.kind === "assistant" && item.blocks[0]).toStrictEqual({
			...expected,
			toolCallId: "removed",
		});
	});

	it("translates top-level tool events and nested tool events without disturbing the run", async () => {
		const { managed, emit, events } = await loadSession({ toolSources: { edit: "builtin" } });
		emit({ type: "agent_start" });
		events.length = 0;
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
			emit({ ...event, toolCallId: "t1/1", parentToolCallId: "t1" });
			emit(event);
		}

		expect(events.map(({ event }) => event)).toEqual([
			{
				type: "tool_started",
				toolCallId: "t1/1",
				parentToolCallId: "t1",
				name: "edit",
				args,
				source: "builtin",
				display: {
					kind: "file_change",
					title: "edit",
					summary: "note.txt",
					files: [{ path: "note.txt", op: "update" }],
				},
			},
			{ type: "tool_started", toolCallId: "t1", name: "edit", args },
			{ type: "tool_updated", toolCallId: "t1/1", output: "Editing" },
			{ type: "tool_updated", toolCallId: "t1", output: "Editing" },
			{
				type: "tool_ended",
				toolCallId: "t1/1",
				isError: false,
				output: "Edited",
				imageCount: 1,
				durationMs: 23,
				diffs: [{ path: "note.txt", diff: "+1 updated" }],
			},
			{
				type: "tool_ended",
				toolCallId: "t1",
				isError: false,
				output: "Edited",
				imageCount: 1,
				durationMs: 23,
				diffs: [{ path: "note.txt", diff: "+1 updated" }],
			},
		] satisfies SessionEvent[]);
		expect(Object.keys(managed.snapshot().state.tools)).toEqual(["t1/1", "t1"]);
		expect(managed.snapshot().state.status).toBe("running");
		expect(managed.snapshot().state.items).toEqual([]);
	});
});

describe("session tool presets", () => {
	it("enforces classic on load and reload while preserving other active tools", async () => {
		const { managed, session, bindings, setActiveToolsByName } = await loadSession({
			activeTools: ["read", "codemode", "custom"],
		});
		expect(setActiveToolsByName).toHaveBeenCalledWith(["read", "custom"]);
		managed.setToolPreset(resolveToolPreset("codemode_only"));
		expect(setActiveToolsByName).toHaveBeenLastCalledWith(["read", "custom", "codemode"]);
		session.reload = async () => setActiveToolsByName(["extension"]);
		await bindings.commandContextActions?.reload();
		expect(setActiveToolsByName).toHaveBeenLastCalledWith(["extension", "codemode"]);
	});

	it("persists the choice immediately and applies it once the run settles", async () => {
		const { managed, emit, events, sessionManager, setActiveToolsByName } = await loadSession();
		emit({ type: "agent_start" });
		managed.setToolPreset(resolveToolPreset("codemode"));
		managed.setToolPreset(resolveToolPreset("codemode"));
		expect(sessionManager.getEntries()).toMatchObject([
			{ customType: "argon.tool_preset", data: { preset: "codemode" } },
		]);
		expect(setActiveToolsByName).not.toHaveBeenCalled();
		expect(managed.snapshot().state.toolPresetPending).toBe(true);
		emit({ type: "agent_settled", aborted: false });
		expect(setActiveToolsByName).toHaveBeenCalledWith(["read", "custom", "codemode"]);
		expect(events.map((e) => e.event).filter((e) => e.type === "tool_preset_changed")).toEqual([
			{ type: "tool_preset_changed", preset: "codemode", pending: true },
			{ type: "tool_preset_changed", preset: "codemode", pending: false },
		]);
	});

	it.each([
		["codemode", "codemode"],
		["retired", "codemode_only"],
	])("restores stored preset %s", async (stored, expected) => {
		const { managed, setActiveToolsByName } = await loadSession({
			defaultPreset: "codemode_only",
			setup: (manager) => {
				manager.appendCustomEntry("argon.tool_preset", { preset: stored });
			},
		});
		expect(managed.snapshot().state.toolPreset).toBe(expected);
		expect(setActiveToolsByName).toHaveBeenCalledWith(["read", "custom", "codemode"]);
	});
});

describe("sandbox permission boundary", () => {
	type Check = { checkToolCall(check: unknown): Promise<unknown> };
	const check = (managed: ManagedSession, input: unknown, toolName = "bash") =>
		(managed as unknown as Check).checkToolCall({ toolCallId: "sandbox-check", toolName, input, signal: undefined });
	const answer = async (managed: ManagedSession, decision: "allow" | "allow_session" | "deny") => {
		await vi.waitFor(() => expect(managed.snapshot().state.pendingInteractions).toHaveLength(1));
		const interaction = managed.snapshot().state.pendingInteractions[0]!;
		managed.respond(interaction.id, { decision });
		return interaction;
	};

	it("auto-allows sandbox bash but never reuses ordinary bash grants for unsandboxed calls", async () => {
		const { managed, settings } = await loadSession({
			setup(manager) {
				manager.appendCustomEntry("argon.session_allow", { tool: "bash" });
			},
		});
		vi.spyOn(settings, "allows").mockReturnValue(true);
		await expect(check(managed, { command: "make" })).resolves.toEqual({ allow: true });
		const denied = check(managed, { command: "make", dangerouslyDisableSandbox: true });
		expect(await answer(managed, "deny")).toMatchObject({
			kind: "tool_approval",
			unsandboxed: true,
			suggestedRule: undefined,
		});
		await expect(denied).resolves.toMatchObject({ allow: false });
		const allowed = check(managed, { command: "make", dangerouslyDisableSandbox: true });
		await answer(managed, "allow_session");
		await expect(allowed).resolves.toEqual({ allow: true });
		await expect(check(managed, { command: "other", dangerouslyDisableSandbox: true })).resolves.toEqual({
			allow: true,
		});
	});

	it("allows workspace writes and asks for protected reads and writes", async () => {
		const { managed } = await loadSession();
		await expect(check(managed, { path: "/project/new.txt", content: "test" }, "write")).resolves.toEqual({
			allow: true,
		});
		for (const [tool, path] of [
			["write", "/project/.git/config"],
			["read", "~/.npmrc"],
			["grep", "~"],
			["find", "/"],
			["edit", "/outside/file"],
		]) {
			const pending = check(managed, { path }, tool);
			await answer(managed, "deny");
			await expect(pending).resolves.toMatchObject({ allow: false });
		}
	});

	it("allows image output in the workspace and asks for unsafe or missing paths", async () => {
		const { managed } = await loadSession();
		await expect(check(managed, { prompt: "A cat", path: "/project/cat.png" }, "codex_imagegen")).resolves.toEqual({
			allow: true,
		});
		for (const path of ["/outside/cat.png", "/project/.git/cat.png", undefined, 42]) {
			const pending = check(managed, { prompt: "A cat", path }, "codex_imagegen");
			await answer(managed, "deny");
			await expect(pending).resolves.toMatchObject({ allow: false });
		}
	});

	it("checks all patch paths including move destinations and asks on invalid syntax", async () => {
		const { managed } = await loadSession();
		const input = (body: string) => ({ input: `*** Begin Patch\n${body}\n*** End Patch` });
		await expect(check(managed, input("*** Add File: a\n+one\n*** Add File: b\n+two"), "apply_patch")).resolves.toEqual(
			{ allow: true },
		);
		for (const args of [
			input("*** Add File: a\n+one\n*** Add File: /outside/b\n+two"),
			input("*** Update File: a\n*** Move to: /outside/b\n@@\n-old\n+new"),
			{ input: "invalid" },
		]) {
			const pending = check(managed, args, "apply_patch");
			await answer(managed, "deny");
			await expect(pending).resolves.toMatchObject({ allow: false });
		}
	});

	it("auto mode bypasses approvals even for unsandboxed requests", async () => {
		const { managed } = await loadSession();
		managed.setPermissionMode("auto");
		await expect(check(managed, { command: "make", dangerouslyDisableSandbox: true })).resolves.toEqual({
			allow: true,
		});
	});
});

it("loads stored ask as auto on unsupported platforms and rejects switching back", async () => {
	const { managed } = await loadSession({
		sandboxSupported: false,
		setup(manager) {
			manager.appendCustomEntry("argon.permission_mode", { mode: "ask" });
		},
	});
	expect(managed.snapshot().state.permissionMode).toBe("auto");
	expect(() => managed.setPermissionMode("ask")).toThrow("not available");
});

it("reconciles model/settings changes only when idle and remembers disabled edits", async () => {
	const { managed, emit, settings, setActiveToolsByName } = await loadSession({
		activeTools: ["read", "edit"],
		modelId: "gpt-6-astra",
		toolSources: { read: "builtin", edit: "builtin", write: "builtin", apply_patch: "builtin" },
	});
	expect(setActiveToolsByName).toHaveBeenLastCalledWith(["read", "apply_patch"]);
	emit({ type: "agent_start" });
	vi.spyOn(settings, "get").mockReturnValue({ ...settings.get(), gptApplyPatch: false });
	setActiveToolsByName.mockClear();
	managed.refreshToolSet();
	expect(setActiveToolsByName).not.toHaveBeenCalled();
	emit({ type: "agent_settled", aborted: false });
	expect(setActiveToolsByName).toHaveBeenLastCalledWith(["read", "edit"]);
});

it("defers model-driven switching until agent_settled", async () => {
	const { managed, session, emit, setActiveToolsByName } = await loadSession({
		activeTools: ["read", "edit", "write"],
		modelId: "claude-opus",
		toolSources: { read: "builtin", edit: "builtin", write: "builtin", apply_patch: "builtin" },
	});
	session.setModel = async (model: unknown) => {
		session.model = model;
	};
	const runtime = { getModel: (_provider: string, id: string) => ({ id }) } as unknown as ModelRuntime;
	emit({ type: "agent_start" });
	await managed.setModel({ provider: "openai", id: "gpt-6-astra" }, runtime);
	expect(setActiveToolsByName).not.toHaveBeenCalled();
	emit({ type: "agent_settled", aborted: false });
	expect(setActiveToolsByName).toHaveBeenLastCalledWith(["read", "apply_patch"]);
	await managed.setModel({ provider: "anthropic", id: "claude-opus" }, runtime);
	expect(setActiveToolsByName).toHaveBeenLastCalledWith(["read", "edit", "write"]);
});

it("adds the compaction notice when compaction ends, once even if entry_appended follows", async () => {
	let manager: SessionManager | undefined;
	const { managed, emit } = await loadSession({
		setup: (sessionManager) => {
			manager = sessionManager;
			sessionManager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		},
	});
	const kept = manager!.appendMessage({ role: "user", content: "again", timestamp: 2 });
	manager!.appendCompaction("placeholder", kept, 100, { kind: "pi-codex-remote-compaction" }, true);
	const result = { summary: "placeholder", firstKeptEntryId: kept, tokensBefore: 100 };
	emit({ type: "compaction_end", reason: "manual", result, aborted: false, willRetry: false } as AgentSessionEvent);
	const notices = () => managed.snapshot().state.items.filter((item) => item.kind === "notice");
	expect(notices()).toEqual([expect.objectContaining({ variant: "compaction", remoteCheckpoint: true })]);
	const entry = manager!.getBranch().findLast((e) => e.type === "compaction")!;
	emit({ type: "entry_appended", entry } as AgentSessionEvent);
	expect(notices()).toHaveLength(1);
	emit({
		type: "compaction_end",
		reason: "manual",
		result: undefined,
		aborted: false,
		willRetry: false,
		errorMessage: "x",
	} as AgentSessionEvent);
	expect(notices()).toHaveLength(1);
});
