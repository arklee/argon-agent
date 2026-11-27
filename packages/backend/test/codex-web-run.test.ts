import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { beforeEach, expect, it, vi } from "vitest";
import { createWebSearchExtension, refreshWebSearchExposure } from "../src/codex-web-run.ts";
import { ArgonSettingsStore } from "../src/settings.ts";
import { projectHistory } from "../src/translate.ts";
import { fetchCodexTool } from "../vendor/codex-web-run/src/codex-runtime/http.ts";

vi.mock("../vendor/codex-web-run/src/codex-runtime/http.ts", () => ({ fetchCodexTool: vi.fn() }));
const http = vi.mocked(fetchCodexTool);
beforeEach(() => http.mockReset());

function setup() {
	const settings = new ArgonSettingsStore("/unused");
	const defaults = settings.get();
	let mode: "on" | "off" | "openai" = "on";
	vi.spyOn(settings, "get").mockImplementation(() => ({ ...defaults, openaiFeatures: mode }));
	const registerTool = vi.fn();
	const on = vi.fn();
	const factory = createWebSearchExtension(settings);
	factory({ registerTool, on } as unknown as ExtensionAPI);
	const tool = () => registerTool.mock.lastCall?.[0] as ToolDefinition;
	const model = {
		provider: "openai-codex",
		id: "gpt-6-luna",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
	};
	const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.signature`;
	const getApiKeyAndHeaders = vi.fn().mockResolvedValue({ ok: true, apiKey: token });
	const ctx = {
		model: { provider: "anthropic", id: "test" },
		modelRegistry: { find: () => model, getApiKeyAndHeaders },
		sessionManager: { getSessionId: () => "stable-session" },
	} as unknown as ExtensionToolContext;
	return {
		setMode: (v: typeof mode) => {
			mode = v;
			refreshWebSearchExposure(settings);
		},
		select: (provider: string) =>
			on.mock.calls.find(([event]) => event === "model_select")?.[1]({ model: { provider } }),
		tool,
		ctx,
		getApiKeyAndHeaders,
		model,
		registerTool,
		settings,
		setEnabled: (v: boolean) => {
			mode = v ? "on" : "off";
			refreshWebSearchExposure(settings);
		},
		shutdown: () => on.mock.calls.find(([event]) => event === "session_shutdown")?.[1](),
	};
}

it("uses Argon's registry Codex credentials from another model and keeps navigation session IDs stable", async () => {
	const s = setup();
	const text = "Example (https://example.com/)\nA source";
	http.mockResolvedValue({
		status: 200,
		statusText: "OK",
		headers: new Headers(),
		text: JSON.stringify({ output: text, results: [] }),
	});
	const result = await s.tool().execute("call", { search_query: [{ q: "test" }] }, undefined, undefined, s.ctx);
	expect(s.getApiKeyAndHeaders).toHaveBeenCalledWith(s.model);
	expect(result.content).toEqual([{ type: "text", text }]);
	expect(http.mock.calls[0]?.[0]).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
	expect(http.mock.calls[0]?.[1].headers?.get("ChatGPT-Account-ID")).toBe("test-account");
	await s.tool().execute("next", { open: [{ ref_id: "turn0search0" }] }, undefined, undefined, s.ctx);
	for (const [, options] of http.mock.calls) expect(JSON.parse(options.body ?? "{}").id).toBe("stable-session");
	// The same text survives the existing history projection used after reconnect/reopen.
	const history = projectHistory([
		{
			type: "message",
			id: "result",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "toolResult",
				toolCallId: "call",
				toolName: "web_run",
				content: result.content,
				details: result.details,
				isError: false,
				timestamp: Date.now(),
			},
		},
	] as Parameters<typeof projectHistory>[0]);
	expect(history.toolResults[0]?.output).toBe(text);
	await s.shutdown();
});

it("hides immediately, blocks stale tool calls, and removes refresh handlers on shutdown", async () => {
	const s = setup();
	const old = s.tool();
	s.setEnabled(false);
	expect(s.tool().exposure).toBe("hidden");
	await expect(old.execute("call", {}, undefined, undefined, s.ctx)).rejects.toThrow("disabled");
	expect(http).not.toHaveBeenCalled();
	s.setEnabled(true);
	expect(s.tool().exposure).toBe("direct");
	await s.shutdown();
	s.registerTool.mockClear();
	refreshWebSearchExposure(s.settings);
	expect(s.registerTool).not.toHaveBeenCalled();
	await expect(old.execute("call", {}, undefined, undefined, s.ctx)).rejects.toThrow();
	expect(http).not.toHaveBeenCalled();
});

it("passes cancellation and reports rejected login without exposing the response body", async () => {
	const s = setup();
	http.mockResolvedValue({ status: 401, statusText: "Unauthorized", headers: new Headers(), text: "secret-token" });
	await expect(s.tool().execute("call", {}, undefined, undefined, s.ctx)).rejects.toThrow("Argon Settings");
	const signal = http.mock.calls[0]?.[1].signal;
	expect(signal?.aborted).toBe(false);
	await s.shutdown();
	expect(signal?.aborted).toBe(true);
});

it("updates exposure on model selection and blocks stale calls on other providers", async () => {
	const s = setup();
	s.setMode("openai");
	expect(s.tool().exposure).toBe("hidden");
	for (const provider of ["openai", "openai-codex", "azure", "anthropic"]) {
		await s.select(provider);
		expect(s.tool().exposure).toBe(provider === "openai" || provider === "openai-codex" ? "direct" : "hidden");
	}
	await expect(s.tool().execute("id", {}, undefined, undefined, s.ctx)).rejects.toThrow("disabled");
	expect(http).not.toHaveBeenCalled();
	await s.shutdown();
});
