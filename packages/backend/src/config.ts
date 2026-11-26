/**
 * Backend configuration and environment identity. Everything lives under ARGON_HOME (default
 * ~/.argon) on the machine the backend runs on; embedded pi data lives in its private agent/ subdirectory.
 */

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir, hostname, platform } from "node:os";
import { join, resolve } from "node:path";
import type { EnvironmentInfo, PermissionMode } from "@argon/shared";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import { log } from "./log.ts";
import { effectiveMode, sandboxSupport } from "./sandbox-policy.ts";

export const ARGON_VERSION = "0.1.0";

export interface BackendConfig {
	argonHome: string;
	agentDir: string;
	host: string;
	port: number;
	token: string;
	/** Allowed Origin headers for WebSocket upgrades. Requests without Origin (non-browser) are allowed. */
	allowedOrigins: string[];
	/** ARGON_PERMISSION_MODE, when set; otherwise the default comes from Argon settings. */
	permissionModeOverride?: PermissionMode;
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

function run(command: string, args: string[]): string | undefined {
	try {
		return execFileSync(command, args, { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

/**
 * A readable machine name for the environment. os.hostname() is the network name, which on some
 * networks is an IP address (or `*.local` noise); the OS usually knows the name the user chose.
 */
export function friendlyHostName(
	platformName: string = platform(),
	host: string = hostname(),
	exec: typeof run = run,
): string {
	const named =
		platformName === "darwin"
			? exec("scutil", ["--get", "ComputerName"])
			: platformName === "linux"
				? exec("hostnamectl", ["--pretty"])
				: undefined;
	if (named) return named;
	const short = host.replace(/\.local$/i, "");
	if (short && !isIP(short) && !isIP(host)) return short;
	return host || "localhost";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
	const argonHome = resolve(env.ARGON_HOME ?? join(homedir(), ".argon"));
	mkdirSync(argonHome, { recursive: true, mode: 0o700 });
	const port = Number(env.ARGON_PORT ?? 7878);
	const host = env.ARGON_HOST ?? "127.0.0.1";
	const token = env.ARGON_TOKEN ?? randomBytes(24).toString("base64url");
	const allowedOrigins = (env.ARGON_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	let permissionModeOverride: PermissionMode | undefined =
		env.ARGON_PERMISSION_MODE === "auto" ? "auto" : env.ARGON_PERMISSION_MODE === "ask" ? "ask" : undefined;
	if (permissionModeOverride === "ask" && !sandboxSupport().supported) {
		log.warn("ARGON_PERMISSION_MODE=ask is unavailable on this platform; using auto");
		permissionModeOverride = effectiveMode(permissionModeOverride);
	}
	return {
		argonHome,
		agentDir: join(argonHome, "agent"),
		host,
		port,
		token,
		allowedOrigins,
		permissionModeOverride,
		environment: {
			id: loadEnvironmentId(argonHome),
			name: env.ARGON_ENV_NAME ?? friendlyHostName(),
			hostname: hostname(),
			platform: platform(),
			homeDir: homedir(),
			argonVersion: ARGON_VERSION,
			piVersion: PI_VERSION,
			sandbox: sandboxSupport(),
		},
	};
}
