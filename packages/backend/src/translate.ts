/**
 * The only place that maps pi SDK types to Argon wire types. Keep pi types out of everything
 * else that leaves the backend, so a pi upgrade stays contained here and in the session adapter.
 */

import type { AssistantBlock, FileDiff, SessionEvent, TranscriptItem, UsageInfo } from "@argon/shared";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { resultDiff } from "./diff-preview.ts";
import { describeToolCall } from "./tool-display.ts";

// pi's AgentMessage is a wide union (with declaration-merged custom roles). We read it
// structurally so this file does not depend on pi-agent-core's module augmentation.
// biome-ignore lint/suspicious/noExplicitAny: structural read of a pi union type
type AnyMessage = any;

type ContentPart = { type: string; text?: string; data?: string; mimeType?: string };

export function contentToText(content: string | ContentPart[] | undefined): { text: string; imageCount: number } {
	if (content === undefined) return { text: "", imageCount: 0 };
	if (typeof content === "string") return { text: content, imageCount: 0 };
	let text = "";
	let imageCount = 0;
	for (const part of content) {
		if (part.type === "text" && part.text) text += (text ? "\n" : "") + part.text;
		else if (part.type === "image") imageCount++;
	}
	return { text, imageCount };
}

export function toUsage(usage: AnyMessage): UsageInfo | undefined {
	if (!usage) return undefined;
	return {
		input: usage.input ?? 0,
		output: usage.output ?? 0,
		cacheRead: usage.cacheRead ?? 0,
		cacheWrite: usage.cacheWrite ?? 0,
		totalTokens: usage.totalTokens ?? 0,
		costTotal: usage.cost?.total ?? 0,
	};
}

function compactionContent(details: unknown, summary: string): { remoteCheckpoint: true } | { text: string } {
	return typeof details === "object" &&
		details !== null &&
		"kind" in details &&
		details.kind === "pi-codex-remote-compaction"
		? { remoteCheckpoint: true }
		: { text: summary };
}

export const MESSAGE_TIMING_ENTRY = "argon.message_timing";

export interface MessageTiming {
	completedAt: number;
	generationMs?: number;
}

function readMessageTiming(data: unknown): (MessageTiming & { messageEntryId: string }) | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const value = data as Record<string, unknown>;
	if (
		typeof value.messageEntryId !== "string" ||
		!value.messageEntryId ||
		typeof value.completedAt !== "number" ||
		!Number.isFinite(value.completedAt) ||
		value.completedAt < 0 ||
		(value.generationMs !== undefined &&
			(typeof value.generationMs !== "number" || !Number.isFinite(value.generationMs) || value.generationMs < 0))
	)
		return undefined;
	return {
		messageEntryId: value.messageEntryId,
		completedAt: value.completedAt,
		...(value.generationMs === undefined ? {} : { generationMs: value.generationMs as number }),
	};
}

type ToolSourceResolver = (name: string) => string | undefined;

export function toAssistantBlocks(
	content: AnyMessage[],
	streaming = false,
	resolveToolSource?: ToolSourceResolver,
): AssistantBlock[] {
	const blocks: AssistantBlock[] = [];
	for (const part of content ?? []) {
		if (part.type === "text") blocks.push({ type: "text", text: part.text ?? "" });
		else if (part.type === "thinking")
			blocks.push({ type: "thinking", text: part.thinking ?? "", redacted: part.redacted || undefined });
		else if (part.type === "toolCall") {
			const name: string = part.name;
			const args: unknown = part.arguments ?? {};
			const block: AssistantBlock = { type: "toolCall", toolCallId: part.id, name, args };
			if (!streaming) {
				block.display = describeToolCall(name, args);
				const source = resolveToolSource?.(name);
				if (source !== undefined) block.source = source;
			}
			blocks.push(block);
		}
	}
	return blocks;
}

/**
 * Convert one pi message into a transcript item. Tool results return `undefined`: they are folded
 * into tool state (see `toolResultOutput`), not shown as standalone items.
 */
export function messageToItem(
	message: AnyMessage,
	id: string,
	streaming = false,
	resolveToolSource?: ToolSourceResolver,
	timing?: MessageTiming,
): TranscriptItem | undefined {
	const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
	switch (message.role) {
		case "user": {
			const { text, imageCount } = contentToText(message.content);
			return { kind: "user", id, text, imageCount, timestamp };
		}
		case "assistant":
			return {
				kind: "assistant",
				id,
				blocks: toAssistantBlocks(message.content, streaming, resolveToolSource),
				provider: message.provider,
				model: message.model,
				stopReason: message.stopReason,
				errorMessage: message.errorMessage,
				usage: toUsage(message.usage),
				streaming,
				timestamp,
				...timing,
			};
		case "toolResult":
			return undefined;
		case "bashExecution":
			return {
				kind: "notice",
				id,
				variant: "bash",
				title: `$ ${message.command}`,
				text: message.output,
				timestamp,
			};
		case "compactionSummary":
			return {
				kind: "notice",
				id,
				variant: "compaction",
				title: "Context compacted",
				...compactionContent(message.details, message.summary),
				timestamp,
			};
		case "branchSummary":
			return {
				kind: "notice",
				id,
				variant: "branchSummary",
				title: "Branch summary",
				text: message.summary,
				timestamp,
			};
		case "custom": {
			if (message.display === false) return undefined;
			const { text } = contentToText(message.content);
			return { kind: "notice", id, variant: "custom", title: message.customType ?? "Extension", text, timestamp };
		}
		default:
			return undefined;
	}
}

export function toolResultOutput(result: AnyMessage): { output: string; imageCount: number } {
	// Tool execution results carry `content` like tool result messages.
	const { text, imageCount } = contentToText(result?.content);
	return { output: text, imageCount };
}

export interface HistoryProjection {
	nestedToolEvents: Extract<SessionEvent, { type: "tool_started" | "tool_ended" }>[];
	/** Calls the user denied (Argon's `argon.tool_blocked` entries), with the reason. */
	blockedTools: Map<string, string>;
	items: TranscriptItem[];
	toolResults: Array<{
		toolCallId: string;
		isError: boolean;
		output: string;
		imageCount: number;
		durationMs?: number;
		diffs?: FileDiff[];
	}>;
}

/**
 * Build the UI history from the active branch of the session tree. This is the full branch
 * (including entries before a compaction), not the model's possibly compacted context.
 */
export function projectHistory(entries: SessionEntry[], resolveToolSource?: ToolSourceResolver): HistoryProjection {
	const nestedToolEvents: HistoryProjection["nestedToolEvents"] = [];
	const items: TranscriptItem[] = [];
	const toolResults: HistoryProjection["toolResults"] = [];
	const blockedTools = new Map<string, string>();
	const callArgs = new Map<string, unknown>();
	const timings = new Map<string, MessageTiming>();
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === MESSAGE_TIMING_ENTRY) {
			const timing = readMessageTiming(entry.data);
			if (timing) {
				const { messageEntryId, ...fields } = timing;
				timings.set(messageEntryId, fields);
			}
		}
		if (entry.type === "message" && entry.message.role === "assistant")
			for (const block of entry.message.content) if (block.type === "toolCall") callArgs.set(block.id, block.arguments);
	}
	for (const entry of entries) {
		const parsed = Date.parse(entry.timestamp);
		const timestamp = Number.isNaN(parsed) ? Date.now() : parsed;
		switch (entry.type) {
			case "message": {
				const message = entry.message;
				if (message.role === "toolResult") {
					const { output, imageCount } = toolResultOutput(message);
					toolResults.push({
						toolCallId: message.toolCallId,
						isError: Boolean(message.isError),
						output,
						imageCount,
						durationMs: message.durationMs,
						diffs: resultDiff(message, callArgs.get(message.toolCallId)),
					});
					for (const record of message.nestedCalls?.calls ?? []) {
						const diff = (message.details as { argonNestedDiffs?: Record<string, unknown> } | undefined)
							?.argonNestedDiffs?.[record.id];
						nestedToolEvents.push(
							{
								type: "tool_started",
								toolCallId: record.id,
								parentToolCallId: message.toolCallId,
								name: record.name,
								args: record.arguments,
								display: describeToolCall(record.name, record.arguments),
								source: resolveToolSource?.(record.name),
							},
							{
								type: "tool_ended",
								toolCallId: record.id,
								isError: record.status !== "ok",
								imageCount: 0,
								output:
									record.status === "unfinished"
										? "Unfinished: still running when the calling tool finished"
										: (record.error ?? ""),
								durationMs: record.durationMs,
								diffs: resultDiff({ details: typeof diff === "string" ? { diff } : { diffs: diff } }, record.arguments),
							},
						);
					}
					break;
				}
				const item = messageToItem(message, entry.id, false, resolveToolSource, timings.get(entry.id));
				if (item) items.push(item);
				break;
			}
			case "compaction":
				items.push({
					kind: "notice",
					id: entry.id,
					variant: "compaction",
					title: "Context compacted",
					...compactionContent(entry.details, entry.summary),
					timestamp,
				});
				break;
			case "branch_summary":
				items.push({
					kind: "notice",
					id: entry.id,
					variant: "branchSummary",
					title: "Branch summary",
					text: entry.summary,
					timestamp,
				});
				break;
			case "custom": {
				if (entry.customType !== "argon.tool_blocked") break;
				const data = entry.data as { toolCallId?: unknown; reason?: unknown } | undefined;
				if (typeof data?.toolCallId === "string") {
					blockedTools.set(data.toolCallId, typeof data.reason === "string" ? data.reason : "Denied by user");
				}
				break;
			}
			case "custom_message": {
				if (!entry.display) break;
				const { text } = contentToText(entry.content as ContentPart[] | string);
				items.push({ kind: "notice", id: entry.id, variant: "custom", title: entry.customType, text, timestamp });
				break;
			}
			default:
				break;
		}
	}
	return { items, toolResults, nestedToolEvents, blockedTools };
}
