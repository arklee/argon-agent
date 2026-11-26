import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@argon/shared";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadConfig } from "../src/config.ts";
import type { SessionRegistry } from "../src/registry.ts";
import { isUpgradeAllowed, startServer } from "../src/server.ts";

describe("desktop WebSocket transport", () => {
	it("uses the bound random port for Host validation and still requires the desktop origin and token", async () => {
		const home = await mkdtemp(join(tmpdir(), "argon-server-"));
		const config = loadConfig({
			ARGON_HOME: home,
			ARGON_PORT: "0",
			ARGON_TOKEN: "test-token",
			ARGON_ALLOWED_ORIGINS: "argon://app",
		});
		const registry = { onGlobalEvent: () => () => {} } as unknown as SessionRegistry;
		const server = await startServer(registry, config);
		try {
			expect(config.port).toBeGreaterThan(0);
			expect(new URL(server.url).port).toBe(String(config.port));
			const check = (host: string, origin: string) =>
				isUpgradeAllowed({ headers: { host, origin } } as IncomingMessage, config);
			expect(check(`127.0.0.1:${config.port}`, "argon://app")).toEqual({ ok: true });
			expect(check("evil.example", "argon://app").ok).toBe(false);
			expect(check(`127.0.0.1:${config.port}`, "null").ok).toBe(false);
			expect(check(`127.0.0.1:${config.port}`, "https://evil.example").ok).toBe(false);
			for (const [token, kind] of [
				["test-token", "welcome"],
				["wrong-token", "fatal"],
			]) {
				const socket = new WebSocket(server.url, { origin: "argon://app" });
				const response = await new Promise<{ kind: string }>((resolve, reject) => {
					socket.once("error", reject);
					socket.once("open", () =>
						socket.send(
							JSON.stringify({ kind: "hello", token, protocolVersion: PROTOCOL_VERSION, clientName: "test" }),
						),
					);
					socket.once("message", (data) => resolve(JSON.parse(data.toString())));
				});
				expect(response.kind).toBe(kind);
				socket.terminate();
			}
		} finally {
			await server.close();
			await rm(home, { recursive: true, force: true });
		}
	});
});
