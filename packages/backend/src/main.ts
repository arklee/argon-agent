#!/usr/bin/env node
/** Argon backend entry point: `tsx src/main.ts` (dev) or spawned by the desktop shell (later). */

import { loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { SessionRegistry } from "./registry.ts";
import { startServer } from "./server.ts";

async function main(): Promise<void> {
	const config = loadConfig();
	const registry = await SessionRegistry.create({
		agentDir: config.agentDir,
		defaultPermissionMode: config.defaultPermissionMode,
	});
	const server = await startServer(registry, config);

	log.info(`Argon backend ${config.environment.argonVersion} (pi ${config.environment.piVersion})`);
	log.info(`listening on ${server.url}  environment=${config.environment.name} (${config.environment.id})`);
	if (!process.env.ARGON_TOKEN) {
		log.info(`token: ${config.token}`);
	}

	let shuttingDown = false;
	const shutdown = async (signal: string) => {
		if (shuttingDown) {
			log.warn(`${signal} again, exiting immediately`);
			process.exit(1);
		}
		shuttingDown = true;
		log.info(`${signal} received, shutting down`);
		await server.close().catch((error) => log.error("server close failed", error));
		await registry.dispose().catch((error) => log.error("registry dispose failed", error));
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
	log.error("backend failed to start", error);
	process.exit(1);
});
