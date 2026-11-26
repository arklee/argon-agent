import { loadConfig } from "./config.ts";
import { SessionRegistry } from "./registry.ts";
import { sandboxFor } from "./sandbox.ts";
import { startServer } from "./server.ts";
import { ArgonSettingsStore } from "./settings.ts";

/** Shared Node lifecycle for CLI and the desktop utility process. */
export async function startBackend() {
	const config = loadConfig();
	const settings = new ArgonSettingsStore(config.argonHome, config.permissionModeOverride, config.environment.sandbox);
	await settings.load();
	const sandbox = sandboxFor(settings);
	if (config.environment.sandbox.supported) await sandbox.initialize().catch(() => {});
	const registry = await SessionRegistry.create({
		settings,
		argonHome: config.argonHome,
		agentDir: config.agentDir,
	});
	const server = await startServer(registry, config).catch(async (error) => {
		await registry.dispose();
		await sandbox.dispose();
		throw error;
	});

	return {
		config,
		url: server.url,
		async close(): Promise<void> {
			try {
				await server.close();
			} finally {
				await registry.dispose();
				await sandbox.dispose();
			}
		},
	};
}
