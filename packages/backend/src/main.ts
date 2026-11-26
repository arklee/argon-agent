#!/usr/bin/env node
/** Argon backend entry point: `tsx src/main.ts`; the desktop utility entry shares runtime.ts. */

import "./bootstrap.ts";

import { log } from "./log.ts";
import { startBackend } from "./runtime.ts";

async function main(): Promise<void> {
	const backend = await startBackend();
	const { config } = backend;
	log.info(`Argon backend ${config.environment.argonVersion} (pi ${config.environment.piVersion})`);
	log.info(`listening on ${backend.url}  environment=${config.environment.name} (${config.environment.id})`);
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
		await backend.close().catch((error) => log.error("backend close failed", error));
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
	log.error("backend failed to start", error);
	process.exit(1);
});
