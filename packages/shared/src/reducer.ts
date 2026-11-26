/**
 * Pure session-state reducer. The backend runs it to keep the authoritative snapshot; clients run
 * the same code on the same events, so a snapshot plus the events after its `seq` always yields
 * the backend's current state.
 *
 * Returns new objects for anything it changes (safe for React/zustand), and leaves the rest shared.
 */

import type { SessionEvent, SessionState } from "./protocol.ts";
import type { AssistantBlock, TranscriptItem } from "./transcript.ts";

export function createEmptySessionState(init: { sessionId: string; cwd: string; sessionPath?: string }): SessionState {
	return {
		sessionId: init.sessionId,
		sessionPath: init.sessionPath,
		cwd: init.cwd,
		status: "idle",
		thinkingLevel: "off",
		availableThinkingLevels: [],
		permissionMode: "ask",
		diagnostics: [],
		items: [],
		tools: {},
		pendingInteractions: [],
		queue: { steering: [], followUp: [] },
		statusEntries: [],
		compacting: false,
	};
}

function replaceItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
	const index = findItemIndex(items, item.id);
	if (index === -1) return [...items, item];
	const next = items.slice();
	next[index] = item;
	return next;
}

function findItemIndex(items: TranscriptItem[], id: string): number {
	// Updates almost always target the last items; search from the end.
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i]!.id === id) return i;
	}
	return -1;
}

function applyAssistantDelta(
	blocks: AssistantBlock[],
	event: Extract<SessionEvent, { type: "assistant_delta" }>,
): AssistantBlock[] {
	const next = blocks.slice();
	const existing = next[event.contentIndex];
	if (event.blockType === "toolCall") {
		if (existing?.type === "toolCall") {
			next[event.contentIndex] = { ...existing, argsText: (existing.argsText ?? "") + event.delta };
		} else {
			next[event.contentIndex] = {
				type: "toolCall",
				toolCallId: event.toolCall?.toolCallId ?? `pending-${event.contentIndex}`,
				name: event.toolCall?.name ?? "",
				args: {},
				argsText: event.delta,
			};
		}
		return next;
	}
	if (existing && existing.type === event.blockType) {
		next[event.contentIndex] = { ...existing, text: existing.text + event.delta };
	} else {
		next[event.contentIndex] = { type: event.blockType, text: event.delta };
	}
	// Fill holes so array indexes always map to content indexes.
	for (let i = 0; i < next.length; i++) {
		if (next[i] === undefined) next[i] = { type: "text", text: "" };
	}
	return next;
}

export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
	switch (event.type) {
		case "reset":
			return event.state;
		case "run_started":
			return { ...state, status: "running" };
		case "run_settled": {
			// Anything still marked streaming/running can no longer progress.
			let items = state.items;
			if (items.some((item) => item.kind === "assistant" && item.streaming)) {
				items = items.map((item) =>
					item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item,
				);
			}
			let tools = state.tools;
			const unfinished = Object.values(tools).filter((t) => t.status === "running" || t.status === "pending");
			if (unfinished.length > 0) {
				tools = { ...tools };
				for (const tool of unfinished) {
					tools[tool.toolCallId] = { ...tool, status: event.aborted ? "error" : tool.status };
				}
			}
			return { ...state, status: "idle", items, tools, retry: undefined };
		}
		case "item_added":
		case "item_replaced": {
			const item = event.item;
			let lastUsage = state.lastUsage;
			let tools = state.tools;
			if (item.kind === "assistant") {
				if (item.usage && !item.streaming) lastUsage = item.usage;
				// Register tool calls so the UI can show them before execution starts.
				for (const block of item.blocks) {
					if (block.type === "toolCall" && !tools[block.toolCallId] && !block.toolCallId.startsWith("pending-")) {
						if (tools === state.tools) tools = { ...tools };
						tools[block.toolCallId] = {
							toolCallId: block.toolCallId,
							name: block.name,
							args: block.args,
							status: "pending",
						};
					}
				}
			}
			return { ...state, items: replaceItem(state.items, item), lastUsage, tools };
		}
		case "assistant_delta": {
			const index = findItemIndex(state.items, event.itemId);
			if (index === -1) return state;
			const item = state.items[index]!;
			if (item.kind !== "assistant") return state;
			const items = state.items.slice();
			items[index] = { ...item, blocks: applyAssistantDelta(item.blocks, event) };
			return { ...state, items };
		}
		case "tool_started": {
			const prev = state.tools[event.toolCallId];
			return {
				...state,
				tools: {
					...state.tools,
					[event.toolCallId]: {
						...prev,
						toolCallId: event.toolCallId,
						name: event.name,
						args: event.args,
						status: "running",
					},
				},
			};
		}
		case "tool_updated": {
			const prev = state.tools[event.toolCallId];
			if (!prev) return state;
			return { ...state, tools: { ...state.tools, [event.toolCallId]: { ...prev, output: event.output } } };
		}
		case "tool_ended": {
			const prev = state.tools[event.toolCallId];
			const status = prev?.status === "blocked" ? "blocked" : event.isError ? "error" : "done";
			return {
				...state,
				tools: {
					...state.tools,
					[event.toolCallId]: {
						toolCallId: event.toolCallId,
						name: prev?.name ?? "",
						args: prev?.args,
						status,
						output: event.output,
						imageCount: event.imageCount,
						durationMs: event.durationMs,
						diff: event.diff ?? prev?.diff,
					},
				},
			};
		}
		case "tool_diff": {
			// May arrive before tool_started (previews are computed in the tool_call hook).
			const prev = state.tools[event.toolCallId];
			return {
				...state,
				tools: {
					...state.tools,
					[event.toolCallId]: prev
						? { ...prev, diff: event.diff }
						: { toolCallId: event.toolCallId, name: "", args: undefined, status: "pending", diff: event.diff },
				},
			};
		}
		case "tool_blocked": {
			const prev = state.tools[event.toolCallId];
			return {
				...state,
				tools: {
					...state.tools,
					[event.toolCallId]: {
						toolCallId: event.toolCallId,
						name: prev?.name ?? "",
						args: prev?.args,
						status: "blocked",
						output: event.reason,
						diff: prev?.diff,
					},
				},
			};
		}
		case "queue_updated":
			return { ...state, queue: { steering: event.steering, followUp: event.followUp } };
		case "compaction_started":
			return { ...state, compacting: true };
		case "compaction_ended":
			return { ...state, compacting: false };
		case "retry_started":
			return {
				...state,
				retry: { attempt: event.attempt, maxAttempts: event.maxAttempts, errorMessage: event.errorMessage },
			};
		case "retry_ended":
			return { ...state, retry: undefined };
		case "name_changed":
			return { ...state, name: event.name };
		case "model_changed":
			return { ...state, model: event.model };
		case "thinking_level_changed":
			return { ...state, thinkingLevel: event.level };
		case "permission_mode_changed":
			return { ...state, permissionMode: event.mode };
		case "project_trust_changed":
			return { ...state, projectTrust: event.trust };
		case "diagnostics_changed":
			return { ...state, diagnostics: event.diagnostics };
		case "interaction_requested":
			if (state.pendingInteractions.some((i) => i.id === event.interaction.id)) return state;
			return { ...state, pendingInteractions: [...state.pendingInteractions, event.interaction] };
		case "interaction_resolved":
			return {
				...state,
				pendingInteractions: state.pendingInteractions.filter((i) => i.id !== event.interactionId),
			};
		case "status_entry": {
			const rest = state.statusEntries.filter((s) => s.key !== event.key);
			return {
				...state,
				statusEntries: event.text === undefined ? rest : [...rest, { key: event.key, text: event.text }],
			};
		}
		case "branches_changed":
			return { ...state, userBranches: event.userBranches };
		case "context_usage_changed":
			return { ...state, contextUsage: event.usage };
		case "mcp_changed":
			return { ...state, mcp: event.mcp };
		case "notification":
			// Notifications are transient; clients surface them as toasts. Not part of state.
			return state;
		default: {
			const exhaustive: never = event;
			return exhaustive;
		}
	}
}
