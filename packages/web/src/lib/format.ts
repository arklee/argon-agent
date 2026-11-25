import type { SessionSummary } from "@argon/shared";

export function basename(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, "");
	const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed;
}

/** Show a backend path relative to the backend's home directory. Display only; never used for IO. */
export function displayPath(path: string, homeDir?: string): string {
	if (homeDir && (path === homeDir || path.startsWith(`${homeDir}/`))) return `~${path.slice(homeDir.length)}`;
	return path;
}

export function sessionTitle(session: Pick<SessionSummary, "name" | "firstMessage">): string {
	if (session.name) return session.name;
	const first = session.firstMessage.trim().split("\n")[0] ?? "";
	return first ? first.slice(0, 80) : "New session";
}

export function relativeTime(epochMs: number, now = Date.now()): string {
	const seconds = Math.round((now - epochMs) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d`;
	return new Date(epochMs).toLocaleDateString();
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** One-line description of a tool call for the collapsed card. */
export function summarizeToolArgs(name: string, args: unknown): string {
	const a = (args ?? {}) as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === "string" ? v : undefined);
	switch (name) {
		case "bash":
		case "powershell":
			return str(a.command) ?? "";
		case "read":
		case "write":
		case "edit":
			return str(a.path) ?? str(a.file_path) ?? "";
		case "grep":
			return [str(a.pattern), str(a.path)].filter(Boolean).join("  in  ");
		case "find":
			return [str(a.pattern), str(a.path)].filter(Boolean).join("  in  ");
		case "ls":
			return str(a.path) ?? ".";
		case "exec":
			return (str(a.code) ?? "").split("\n")[0] ?? "";
		default: {
			const json = JSON.stringify(args);
			return json && json !== "{}" ? json.slice(0, 120) : "";
		}
	}
}
