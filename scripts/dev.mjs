#!/usr/bin/env node
/**
 * Dev runner: starts the backend (tsx watch) and the web frontend (Vite) with a shared token.
 * The token is persisted in $ARGON_HOME/dev-token so browser tabs keep working across restarts.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argonHome = process.env.ARGON_HOME ?? join(homedir(), ".argon");
mkdirSync(argonHome, { recursive: true, mode: 0o700 });
const tokenPath = join(argonHome, "dev-token");
let token;
try {
	token = readFileSync(tokenPath, "utf8").trim();
} catch {}
if (!token) {
	token = randomBytes(24).toString("base64url");
	writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
}

const port = process.env.ARGON_PORT ?? "7878";
const webPort = "5173";
const env = { ...process.env, ARGON_TOKEN: token, ARGON_PORT: port, FORCE_COLOR: "1" };

let exiting = false;

const children = [
	spawn("npm", ["run", "dev", "-w", "@argon/backend"], { env, stdio: "inherit" }),
	spawn("npm", ["run", "dev", "-w", "@argon/web"], {
		env: { ...env, VITE_ARGON_BACKEND_URL: `ws://127.0.0.1:${port}` },
		stdio: "inherit",
	}),
];

// Vite listens on 127.0.0.1 only; "localhost" may resolve to ::1 first and be refused.
const url = `http://127.0.0.1:${webPort}/#token=${token}`;
const noOpen =
	process.argv.includes("--no-open") ||
	/^(1|true)$/i.test(process.env.ARGON_NO_OPEN ?? "") ||
	process.env.BROWSER?.toLowerCase() === "none";

/** Open a URL in the user's browser. On WSL that is the Windows browser. Best effort. */
function openBrowser(target) {
	let command;
	let args;
	let cwd;
	// $BROWSER (as in CRA and others) picks a browser other than the system default; on WSL it can be a
	// Windows executable, e.g. "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe".
	if (process.env.BROWSER) [command, args] = [process.env.BROWSER, [target]];
	else if (process.platform === "darwin") [command, args] = ["open", [target]];
	else if (process.platform === "win32") [command, args] = ["cmd", ["/c", "start", '""', target]];
	else if (isWsl()) [command, args, cwd] = ["cmd.exe", ["/c", "start", '""', target], "/mnt/c"];
	else [command, args] = ["xdg-open", [target]];
	const child = spawn(command, args, { cwd, stdio: "ignore", detached: true });
	child.on("error", () => console.log("  (Could not open a browser; use the link above.)"));
	child.unref();
}

function isWsl() {
	try {
		return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
	} catch {
		return false;
	}
}

async function waitForWeb(timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (!exiting && Date.now() < deadline) {
		try {
			if ((await fetch(`http://127.0.0.1:${webPort}/`)).ok) return true;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return false;
}

void waitForWeb().then((ready) => {
	if (exiting) return;
	console.log(`\n  Argon: ${url}\n`);
	if (ready && !noOpen) openBrowser(url);
});

const stop = (code = 0) => {
	if (exiting) return;
	exiting = true;
	for (const child of children) child.kill("SIGTERM");
	setTimeout(() => process.exit(code), 3000).unref();
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
