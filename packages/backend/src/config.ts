/**
 * Backend configuration and environment identity. Everything lives under ARGON_HOME (default
 * ~/.argon) on the machine the backend runs on; pi's own config stays in its agentDir (~/.pi/agent).
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";
import type { EnvironmentInfo, PermissionMode } from "@argon/shared";
import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

export const ARGON_VERSION = "0.1.0";

export interface BackendConfig {
	argonHome: string;
	agentDir: string;
	host: string;
	port: number;
	token: string;
	/** Allowed Origin headers for WebSocket upgrades. Requests without Origin (non-browser) are allowed. */
	allowedOrigins: string[];
	defaultPermissionMode: PermissionMode;
	environment: EnvironmentInfo;
}

function readJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function loadEnvironmentId(argonHome: string): string {
	const path = join(argonHome, "environment.json");
	const existing = readJson<{ id?: string }>(path);
	if (existing?.id) return existing.id;
	const id = randomUUID();
	writeFileSync(path, `${JSON.stringify({ id }, null, 2)}\n`, { mode: 0o600 });
	return id;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
	const argonHome = env.ARGON_HOME ?? join(homedir(), ".argon");
	mkdirSync(argonHome, { recursive: true, mode: 0o700 });
	const port = Number(env.ARGON_PORT ?? 7878);
	const host = env.ARGON_HOST ?? "127.0.0.1";
	const token = env.ARGON_TOKEN ?? randomBytes(24).toString("base64url");
	const allowedOrigins = (env.ARGON_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const defaultPermissionMode: PermissionMode = env.ARGON_PERMISSION_MODE === "auto" ? "auto" : "ask";
	return {
		argonHome,
		agentDir: env.ARGON_PI_AGENT_DIR ?? getAgentDir(),
		host,
		port,
		token,
		allowedOrigins,
		defaultPermissionMode,
		environment: {
			id: loadEnvironmentId(argonHome),
			name: env.ARGON_ENV_NAME ?? hostname(),
			hostname: hostname(),
			platform: platform(),
			homeDir: homedir(),
			argonVersion: ARGON_VERSION,
			piVersion: PI_VERSION,
		},
	};
}
