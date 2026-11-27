/** Adapted from sst/opencode model-policy.ts (MIT, see ../vendor/opencode-patch/LICENSE), usesPatch's model ID rule. */
export function isGpt5Family(modelId: string): boolean {
	const id = modelId.toLowerCase();
	return id.includes("gpt-") && !id.includes("gpt-4") && !id.includes("oss");
}

/** Reconcile only tools owned by this policy. removed records edits hidden by our previous pass. */
export function activeToolNames(
	current: string[],
	options: {
		codemode: boolean;
		patchMode: boolean;
		registered: string[];
		removed?: readonly string[];
	},
): string[] {
	const registered = new Set(options.registered);
	const patchMode = options.patchMode && registered.has("apply_patch");
	const active = new Set(current);
	if (options.codemode) active.add("codemode");
	else active.delete("codemode");
	if (patchMode) {
		active.add("apply_patch");
		active.delete("edit");
		active.delete("write");
	} else {
		active.delete("apply_patch");
		for (const name of options.removed ?? []) if (registered.has(name)) active.add(name);
	}
	return [...active];
}
