import type { PluginInfo } from "@argon/shared";

function parseVersion(version: string) {
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
			version,
		);
	if (!match) return undefined;
	const pre = match[4]?.split(".");
	if (pre?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return undefined;
	return { core: [match[1]!, match[2]!, match[3]!].map(BigInt), pre };
}

/** Compare exact npm versions, including prereleases; unknown versions never offer an update. */
export function isNewerPluginVersion(candidate: string, installed: string): boolean {
	const next = parseVersion(candidate);
	const current = parseVersion(installed);
	if (!next || !current) return false;
	for (let i = 0; i < 3; i++) {
		if (next.core[i] !== current.core[i]) return next.core[i]! > current.core[i]!;
	}
	if (!next.pre || !current.pre) return !!current.pre && !next.pre;
	for (let i = 0; i < Math.max(next.pre.length, current.pre.length); i++) {
		const a = next.pre[i];
		const b = current.pre[i];
		if (a === b) continue;
		if (a === undefined) return false;
		if (b === undefined) return true;
		const an = /^\d+$/.test(a);
		const bn = /^\d+$/.test(b);
		if (an && bn) return BigInt(a) > BigInt(b);
		if (an !== bn) return !an;
		return a > b;
	}
	return false;
}

export function pluginSearchState(plugins: PluginInfo[], name: string, version: string) {
	const matches = plugins.filter((plugin) => {
		const spec = plugin.spec.replace(/^npm:/, "");
		return spec === name || spec.startsWith(`${name}@`);
	});
	if (!matches.length) return "install";
	return matches.every(
		(plugin) =>
			plugin.managed && isNewerPluginVersion(version, plugin.spec.replace(/^npm:/, "").slice(name.length + 1)),
	)
		? "update"
		: "installed";
}
