/**
 * Bridge to pi's built-in MCP extension. pi keeps MCP server state private to the extension, so
 * Argon patches it (patches/@earendil-works+pi-coding-agent+*.patch) to publish a snapshot and accept
 * actions over the session's `pi.events` bus. This module is the only place that knows those channels
 * and the raw snapshot shape; it converts them to Argon's `McpStatus`.
 *
 * Event bus subscriptions are tracked by pi and dropped on reload, so the factory can run again.
 */

import type { McpAction, McpExposure, McpServerStatus, McpStatus } from "@argon/shared";
import type { EventBus, InlineExtension } from "@earendil-works/pi-coding-agent";

const STATE_CHANNEL = "argon:mcp:state";
const REQUEST_STATE_CHANNEL = "argon:mcp:request-state";
const ACTION_CHANNEL = "argon:mcp:action";

/** What the patched extension's sign-in needs from a UI (pi's `McpUi`, minus the TUI menus). */
export interface McpSignInUi {
	status(title: string, message: string, onCancel?: () => void): void;
	redirectUrl(title: string, authorizationUrl: string, signal: AbortSignal): Promise<string | undefined>;
}

export interface McpBridge {
	extension: InlineExtension;
	/** Latest status, if the MCP extension reported one. */
	readonly status: McpStatus | undefined;
	onStatus(listener: (status: McpStatus) => void): void;
	run(request: {
		server: string;
		action: McpAction | "exposure";
		exposure?: McpExposure;
		ui: McpSignInUi;
	}): Promise<string | undefined>;
}

const ACTION_TIMEOUT_MS = 10 * 60_000;

export function createMcpBridge(): McpBridge {
	let events: EventBus | undefined;
	let status: McpStatus | undefined;
	let listener: ((status: McpStatus) => void) | undefined;

	const extension: InlineExtension = {
		name: "argon-mcp-bridge",
		hidden: true,
		factory: (pi) => {
			events = pi.events;
			pi.events.on(STATE_CHANNEL, (raw) => {
				status = toMcpStatus(raw);
				listener?.(status);
			});
			// The MCP extension may have published before this subscription existed.
			pi.on("session_start", () => pi.events.emit(REQUEST_STATE_CHANNEL, undefined));
		},
	};

	return {
		extension,
		get status() {
			return status;
		},
		onStatus(next) {
			listener = next;
		},
		run({ server, action, exposure, ui }) {
			const bus = events;
			if (!bus) return Promise.resolve("MCP is not loaded in this session.");
			return new Promise((resolve) => {
				let settled = false;
				const finish = (error: string | undefined) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(error);
				};
				// Without the patch (or with MCP disabled) nobody answers.
				const timer = setTimeout(
					() => finish("MCP did not answer. Is builtin:mcp enabled?"),
					action === "signin" ? ACTION_TIMEOUT_MS : 30_000,
				);
				bus.emit(ACTION_CHANNEL, { server, action, exposure, ui, done: finish });
			});
		},
	};
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function toMcpStatus(raw: unknown): McpStatus {
	const data = (raw ?? {}) as Record<string, unknown>;
	const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
	const servers = Array.isArray(data.servers) ? data.servers : [];
	return {
		configErrors: strings(data.configErrors),
		overridden: strings(data.overridden),
		servers: servers.map((entry): McpServerStatus => {
			const s = (entry ?? {}) as Record<string, unknown>;
			const tools = Array.isArray(s.tools) ? s.tools : [];
			return {
				name: str(s.name) ?? "?",
				source: str(s.source) ?? "",
				scope: str(s.scope),
				transport: str(s.transport) ?? "",
				enabled: s.enabled !== false,
				exposure: (str(s.exposure) ?? "codemode") as McpExposure,
				state: str(s.state) ?? "starting",
				error: str(s.error),
				message: str(s.message),
				oauth: s.oauth === true,
				hasResources: s.hasResources === true,
				tools: tools.map((tool) => {
					const t = (tool ?? {}) as Record<string, unknown>;
					return { name: str(t.name) ?? "?", description: str(t.description) };
				}),
			};
		}),
	};
}
