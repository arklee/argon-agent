import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProjectTrustInfo } from "@argon/shared";
import {
	type DefaultProjectTrust,
	hasTrustRequiringProjectResources,
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
