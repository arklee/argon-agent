import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProjectTrustInfo } from "@argon/shared";
import {
	type DefaultProjectTrust,
	hasTrustRequiringProjectResources,
	type LoadExtensionsResult,
	type ProjectTrustContext,
	type ProjectTrustEventResult,
	type ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

export interface ResolvedProjectTrust {
	trusted: boolean;
	info: ProjectTrustInfo;
}

export function canonicalProjectPath(cwd: string): string {
	const path = resolve(cwd);
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function projectTrustParent(cwd: string): string | undefined {
	const parent = dirname(cwd);
	return parent === cwd ? undefined : parent;
}

export function resolveProjectTrust(
	cwd: string,
	store: ProjectTrustStore,
	sessionDecisions: ReadonlyMap<string, boolean>,
	defaultTrust: DefaultProjectTrust,
): ResolvedProjectTrust {
	const path = canonicalProjectPath(cwd);
	const parentPath = projectTrustParent(path);
	const sessionDecision = sessionDecisions.get(path);
	if (sessionDecision !== undefined) {
		return { trusted: sessionDecision, info: { status: sessionDecision ? "trusted" : "untrusted", parentPath } };
	}

	const requiresTrust = hasTrustRequiringProjectResources(path);
	const saved = store.getEntry(path);
	const savedPath = saved?.path;
	if (!requiresTrust)
		return { trusted: saved?.decision ?? true, info: { status: "not_required", savedPath, parentPath } };
	if (saved) {
		return {
			trusted: saved.decision,
			info: { status: saved.decision ? "trusted" : "untrusted", savedPath, parentPath },
		};
	}

	return {
		trusted: defaultTrust === "always",
		info: {
			status: defaultTrust === "ask" ? "undecided" : defaultTrust === "always" ? "trusted" : "untrusted",
			parentPath,
		},
	};
}

/** Extensions cannot show dialogs while a session loads (Argon never blocks loading on a question). */
const NO_UI: ProjectTrustContext["ui"] = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
};

/**
 * Like `resolveProjectTrust`, but first asks user-level extensions, as pi does: the first
 * `project_trust` handler that answers yes/no decides (and saves the decision when it says `remember`).
 * Argon's "this session only" choice still wins, since the user made it explicitly in the GUI.
 */
export async function resolveProjectTrustWithExtensions(
	cwd: string,
	store: ProjectTrustStore,
	sessionDecisions: ReadonlyMap<string, boolean>,
	defaultTrust: DefaultProjectTrust,
	extensions: LoadExtensionsResult | undefined,
	onError?: (message: string) => void,
): Promise<ResolvedProjectTrust> {
	const path = canonicalProjectPath(cwd);
	const fallback = () => resolveProjectTrust(path, store, sessionDecisions, defaultTrust);
	if (!extensions || sessionDecisions.has(path) || !hasTrustRequiringProjectResources(path)) return fallback();
	const context: ProjectTrustContext = { cwd: path, mode: "rpc", hasUI: false, ui: NO_UI };
	for (const extension of extensions.extensions) {
		for (const handler of extension.handlers.get("project_trust") ?? []) {
			let result: ProjectTrustEventResult | undefined;
			try {
				result = (await handler({ type: "project_trust", cwd: path }, context)) as ProjectTrustEventResult | undefined;
			} catch (error) {
				onError?.(
					`Extension "${extension.path}" project_trust error: ${error instanceof Error ? error.message : error}`,
				);
				continue;
			}
			if (!result || result.trusted === "undecided") continue;
			const trusted = result.trusted === "yes";
			if (result.remember === true) store.set(path, trusted);
			const { info } = fallback();
			return {
				trusted,
				info: {
					...info,
					status: trusted ? "trusted" : "untrusted",
					decidedBy: extensionLabel(extension),
				},
			};
		}
	}
	return fallback();
}

/** A package name for package extensions, else the extension's file. */
function extensionLabel(extension: LoadExtensionsResult["extensions"][number]): string {
	const source = extension.sourceInfo?.source ?? "";
	return /^(npm|git|https?):/.test(source) ? source : extension.path;
}
