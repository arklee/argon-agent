/** Minimal stderr logger. stdout stays free for a future stdio transport (e.g. over SSH). */

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.ARGON_LOG_LEVEL as Level) ?? "info"] ?? order.info;

function write(level: Level, message: string, extra?: unknown): void {
	if (order[level] < threshold) return;
	const time = new Date().toISOString().slice(11, 23);
	const suffix =
		extra instanceof Error ? `\n${extra.stack ?? extra.message}` : extra !== undefined ? ` ${String(extra)}` : "";
	process.stderr.write(`${time} ${level.padEnd(5)} ${message}${suffix}\n`);
}

export const log = {
	debug: (message: string, extra?: unknown) => write("debug", message, extra),
	info: (message: string, extra?: unknown) => write("info", message, extra),
	warn: (message: string, extra?: unknown) => write("warn", message, extra),
	error: (message: string, extra?: unknown) => write("error", message, extra),
};
