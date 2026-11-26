import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("desktop-probe", { description: "Desktop packaging probe", handler: async () => {} });
	pi.on("session_start", async () => {
		const { CodemodeSandbox } = await import(process.env.ARGON_SMOKE_CODEMODE!);
		const result = await new CodemodeSandbox().execute('text("codemode-ok")');
		assert(JSON.stringify(result).includes("codemode-ok"), "Codemode worker and QuickJS WASM");
		const worker = new Worker(process.env.ARGON_SMOKE_IMAGE_WORKER!);
		try {
			const result = await new Promise<{ result?: { width: number }; error?: string }>((resolve, reject) => {
				worker.once("message", resolve);
				worker.once("error", reject);
				worker.postMessage({
					inputBytes: new Uint8Array(
						Buffer.from(
							"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
							"base64",
						),
					),
					mimeType: "image/png",
				});
			});
			assert(!result.error, result.error);
			assert.equal(result.result?.width, 1);
			await writeFile(join(process.env.ARGON_HOME!, "worker-ok"), "ok");
		} finally {
			await worker.terminate();
		}
	});
	pi.on("session_shutdown", async () => {
		await writeFile(join(process.env.ARGON_HOME!, "shutdown-ok"), "ok");
	});
}
