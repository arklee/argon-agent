// Configure pi before evaluating any module that imports the SDK.
import "../../backend/src/bootstrap.ts";

const { startBackend } = await import("../../backend/src/runtime.ts");
const starting = startBackend();
let closing = false;
const shutdown = async () => {
	if (closing) return;
	closing = true;
	try {
		await (await starting).close();
		process.exit(0);
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
};
process.parentPort?.on("message", ({ data }) => {
	if (data === "shutdown") void shutdown();
});
process.on("SIGTERM", () => void shutdown());
const backend = await starting;
if (!closing) process.parentPort?.postMessage({ type: "ready", url: backend.url, node: process.versions.node });
