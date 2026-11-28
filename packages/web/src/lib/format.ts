import type { SessionSummary } from "@argon/shared";
import { getLanguage, t } from "@/i18n";

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
	return first ? first.slice(0, 80) : t("common.untitledSession");
}

export function relativeTime(epochMs: number, now = Date.now()): string {
	const seconds = Math.round((now - epochMs) / 1000);
	if (seconds < 60) return t("format.justNow");
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return t("format.relativeMinute", { value: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 24) return t("format.relativeHour", { value: hours });
	const days = Math.round(hours / 24);
	if (days < 30) return t("format.relativeDay", { value: days });
	return new Intl.DateTimeFormat(getLanguage()).format(epochMs);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(getLanguage(), options).format(value);
}

export function formatPercent(percent: number): string {
	return formatNumber(percent / 100, { style: "percent" });
}

export function formatCurrency(value: number): string {
	return formatNumber(value, {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 3,
		maximumFractionDigits: 3,
	});
}

export function formatTokens(n: number): string {
	if (n < 1000) return formatNumber(n);
	return formatNumber(n, { notation: "compact", maximumFractionDigits: n < 10_000 || n >= 1_000_000 ? 1 : 0 });
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return t("format.milliseconds", { value: ms });
	const seconds = ms / 1000;
	if (seconds < 60)
		return t("format.seconds", {
			value: formatNumber(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		});
	const rounded = Math.round(seconds);
	return t("format.minutesAndSeconds", { minutes: Math.floor(rounded / 60), seconds: rounded % 60 });
}

/** Elapsed wall time in whole units: 42s, 3m 05s, 1h 02m. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return t("format.seconds", { value: String(total) });
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	if (hours > 0) return t("format.hoursAndMinutes", { hours, minutes });
	return t("format.minutesAndSeconds", { minutes, seconds: total % 60 });
}

const thinkingKeys = new Map<string, `thinking.${"off" | "minimal" | "low" | "medium" | "high" | "xhigh"}`>([
	["off", "thinking.off"],
	["minimal", "thinking.minimal"],
	["low", "thinking.low"],
	["medium", "thinking.medium"],
	["high", "thinking.high"],
	["xhigh", "thinking.xhigh"],
]);

export function thinkingLevelLabel(level: string, translate: typeof t): string {
	const key = thinkingKeys.get(level);
	return key ? translate(key) : level;
}
