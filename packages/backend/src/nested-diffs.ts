/**
 * pi records nested call metadata but omits nested results. Store their diffs on the parent's
 * result so history can restore them. This inline extension can be removed as one unit if pi
 * starts persisting nested results.
 */

import type { FileDiff } from "@argon/shared";
import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";
import { capDiff } from "./diff-preview.ts";

export interface NestedDiffHost {
	getNestedDiffs(parentToolCallId: string): Record<string, FileDiff[]>;
}

export function createNestedDiffExtension(host: NestedDiffHost): InlineExtension {
	const factory: ExtensionFactory = (pi) => {
		pi.on("tool_result", (event) => {
			const { details } = event;
			if (event.parentToolCallId) return;
			if (
				details !== undefined &&
				(details === null ||
					typeof details !== "object" ||
					(Object.getPrototypeOf(details) !== Object.prototype && Object.getPrototypeOf(details) !== null))
			)
				return;
			const diffs = Object.entries(host.getNestedDiffs(event.toolCallId));
			if (!diffs.length) return;
			return {
				details: {
					...details,
					argonNestedDiffs: Object.fromEntries(
						diffs.map(([id, diff]) => [id, diff.map((entry) => ({ ...entry, diff: capDiff(entry.diff) }))]),
					),
				},
			};
		});
	};
	return { name: "argon-nested-diffs", factory, hidden: true };
}
