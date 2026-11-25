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

const children = [
	spawn("npm", ["run", "dev", "-w", "@argon/backend"], { env, stdio: "inherit" }),
	spawn("npm", ["run", "dev", "-w", "@argon/web"], {
		env: { ...env, VITE_ARGON_BACKEND_URL: `ws://127.0.0.1:${port}` },
		stdio: "inherit",
	}),
];

setTimeout(() => {
	console.log(`\n  Argon: open http://localhost:${webPort}/#token=${token}\n`);
}, 1500);

let exiting = false;
const stop = (code = 0) => {
	if (exiting) return;
	exiting = true;
	for (const child of children) child.kill("SIGTERM");
	setTimeout(() => process.exit(code), 3000).unref();
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
