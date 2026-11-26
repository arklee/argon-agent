/**
 * The only place that maps pi SDK types to Argon wire types. Keep pi types out of everything
 * else that leaves the backend, so a pi upgrade stays contained here and in the session adapter.
 */

import type { AssistantBlock, TranscriptItem, UsageInfo } from "@argon/shared";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { resultDiff } from "./diff-preview.ts";

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

export function toAssistantBlocks(content: AnyMessage[]): AssistantBlock[] {
	const blocks: AssistantBlock[] = [];
	for (const part of content ?? []) {
		if (part.type === "text") blocks.push({ type: "text", text: part.text ?? "" });
		else if (part.type === "thinking")
			blocks.push({ type: "thinking", text: part.thinking ?? "", redacted: part.redacted || undefined });
		else if (part.type === "toolCall")
			blocks.push({ type: "toolCall", toolCallId: part.id, name: part.name, args: part.arguments ?? {} });
	}
	return blocks;
}

/**
 * Convert one pi message into a transcript item. Tool results return `undefined`: they are folded
 * into tool state (see `toolResultOutput`), not shown as standalone items.
 */
export function messageToItem(message: AnyMessage, id: string, streaming = false): TranscriptItem | undefined {
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
				blocks: toAssistantBlocks(message.content),
				provider: message.provider,
				model: message.model,
				stopReason: message.stopReason,
				errorMessage: message.errorMessage,
				usage: toUsage(message.usage),
				streaming,
				timestamp,
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
				text: message.summary,
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
	items: TranscriptItem[];
	toolResults: Array<{
		toolCallId: string;
		isError: boolean;
		output: string;
		imageCount: number;
		durationMs?: number;
		diff?: string;
	}>;
}

/**
 * Build the UI history from the active branch of the session tree. This is the full branch
 * (including entries before a compaction), not the model's possibly compacted context.
 */
export function projectHistory(entries: SessionEntry[]): HistoryProjection {
	const items: TranscriptItem[] = [];
	const toolResults: HistoryProjection["toolResults"] = [];
	for (const entry of entries) {
		const parsed = Date.parse(entry.timestamp);
		const timestamp = Number.isNaN(parsed) ? Date.now() : parsed;
		switch (entry.type) {
			case "message": {
				const message = entry.message as AnyMessage;
				if (message.role === "toolResult") {
					const { output, imageCount } = toolResultOutput(message);
					toolResults.push({
						toolCallId: message.toolCallId,
						isError: Boolean(message.isError),
						output,
						imageCount,
						durationMs: message.durationMs,
						diff: resultDiff(message),
					});
					break;
				}
				const item = messageToItem(message, entry.id);
				if (item) items.push(item);
				break;
			}
			case "compaction":
				items.push({
					kind: "notice",
					id: entry.id,
					variant: "compaction",
					title: "Context compacted",
					text: entry.summary,
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
	return { items, toolResults };
}
