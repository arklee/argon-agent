/**
 * Tool display (decisions D13). The backend describes each call as a `ToolDisplay` (by meaning, not by
 * tool name); this registry picks the renderer: a per-tool override (source + name, or name alone)
 * first, then the renderer for the display kind, then the generic one. Unknown kinds from a newer
 * backend therefore degrade to the generic card instead of failing.
 */

import type { AssistantBlock, ToolCallState, ToolDisplay, TranscriptItem } from "@argon/shared";
import type { ComponentType, ReactNode } from "react";

/** Everything a renderer may need about one call. */
export interface ToolView {
	toolCallId: string;
	name: string;
	source?: string;
	display: ToolDisplay;
	args: unknown;
	/** Execution state; absent until the call starts. */
	tool?: ToolCallState;
	/** Calls this one made (e.g. from a codemode script), in order. */
	children: ToolCallState[];
	/** Renders `children` as nested cards; renderers that set `placesChildren` call it themselves. */
	renderChildren: () => ReactNode;
}

export interface ToolRenderer {
	/** Header line next to the title. Defaults to `display.summary`. */
	summary?: (view: ToolView) => string;
	/** Expanded card content. */
	Body: ComponentType<{ view: ToolView }>;
	/** What the approval card shows before the call runs. `diff` is the backend's preview, if any. */
	Preview?: ComponentType<{ view: ToolView; diff?: string }>;
	/** Body places the nested calls itself (via view.renderChildren); otherwise the card appends them. */
	placesChildren?: boolean;
}

const kindRenderers = new Map<string, ToolRenderer>();
const overrides = new Map<string, ToolRenderer>();

function overrideKey(name: string, source?: string): string {
	return source === undefined ? name : `${source}\u0000${name}`;
}

/** Renderer for one display kind. */
export function registerKindRenderer(kind: ToolDisplay["kind"], renderer: ToolRenderer): void {
	kindRenderers.set(kind, renderer);
}

/**
 * Special-case one tool. With `source`, only that tool from that source (pi's sourceInfo.source), so
 * same-named tools from different presets stay apart; without it, the tool name from any source.
 */
export function registerToolRenderer(name: string, renderer: ToolRenderer, source?: string): void {
	overrides.set(overrideKey(name, source), renderer);
}

export function rendererFor(view: ToolView): ToolRenderer {
	const renderer =
		(view.source !== undefined ? overrides.get(overrideKey(view.name, view.source)) : undefined) ??
		overrides.get(overrideKey(view.name)) ??
		kindRenderers.get(view.display.kind) ??
		kindRenderers.get("generic");
	if (!renderer) throw new Error("No generic tool renderer registered");
	return renderer;
}

/** The backend's description, or a generic one while the call streams or when the backend sent none. */
export function displayFor(
	name: string,
	args: unknown,
	display: ToolDisplay | undefined,
	argsText?: string,
): ToolDisplay {
	if (display) return display;
	return { kind: "generic", title: name, summary: compactArgs(args) || (argsText ?? "").slice(0, 120) };
}

export function compactArgs(args: unknown): string {
	if (args === undefined) return "";
	const json = JSON.stringify(args);
	return json && json !== "{}" ? json.slice(0, 120) : "";
}

type ToolCallBlock = Extract<AssistantBlock, { type: "toolCall" }>;

/** The transcript block of a call, which carries its display (e.g. for the approval card). */
export function findToolCallBlock(items: readonly TranscriptItem[], toolCallId: string): ToolCallBlock | undefined {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item?.kind !== "assistant") continue;
		for (const block of item.blocks) {
			if (block.type === "toolCall" && block.toolCallId === toolCallId) return block;
		}
	}
	return undefined;
}

/** Nested calls of `toolCallId`, ordered by their `<parent>/<n>` suffix. */
export function childToolsOf(tools: Record<string, ToolCallState>, toolCallId: string): ToolCallState[] {
	const prefix = `${toolCallId}/`;
	const order = (tool: ToolCallState) => Number(tool.toolCallId.slice(prefix.length).split("/")[0]);
	return Object.values(tools)
		.filter((tool) => tool.parentToolCallId === toolCallId)
		.sort((a, b) => order(a) - order(b) || a.toolCallId.localeCompare(b.toolCallId));
}
