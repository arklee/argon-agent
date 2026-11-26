/**
 * Persists the diff of pi's built-in `write` tool. pi's `edit` result carries `details.diff`, but
 * `write` returns no details, so a reopened session could only show the new file content. The diff
 * Argon previews before the call (see ManagedSession.checkToolCall) is stored in the result's details,
 * which pi writes to the session file and translate.ts reads back like an edit diff.
 *
 * Kept as its own inline extension so it can be dropped as one unit if pi's tool set changes. It is
 * inert when there is no `write` tool, when the arguments no longer have the `{ path, content }`
 * shape (no preview is computed), or when pi starts returning its own `details.diff`.
 */

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

export interface WriteDiffHost {
	/** The diff previewed for this call, removed from the host once taken. */
	takeWriteDiff(toolCallId: string): string | undefined;
}

export function createWriteDiffExtension(host: WriteDiffHost): InlineExtension {
	const factory: ExtensionFactory = (pi) => {
		pi.on("tool_result", (event) => {
			if (event.toolName !== "write") return undefined;
			const diff = host.takeWriteDiff(event.toolCallId);
			if (!diff || event.isError) return undefined;
			const details: Record<string, unknown> =
				event.details && typeof event.details === "object" ? { ...(event.details as object) } : {};
			// Never replace a diff pi supplies itself.
			if (typeof details.diff === "string" && details.diff) return undefined;
			return { details: { ...details, diff } };
		});
	};
	return { name: "argon-write-diff", factory, hidden: true };
}
