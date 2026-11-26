import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const output = "packages/desktop/dist";
const defaultExecutable =
	process.platform === "darwin"
		? `${output}/mac${process.arch === "x64" ? "" : `-${process.arch}`}/Argon.app/Contents/MacOS/Argon`
		: process.platform === "win32"
			? `${output}/win${process.arch === "x64" ? "" : `-${process.arch}`}-unpacked/Argon.exe`
			: `${output}/linux${process.arch === "x64" ? "" : `-${process.arch}`}-unpacked/argon`;
const executable = resolve(process.argv[2] ?? defaultExecutable);
const home = await mkdtemp(join(tmpdir(), "argon-desktop-"));
try {
	await mkdir(join(home, "agent", "extensions"), { recursive: true });
	if (process.env.ARGON_SMOKE_MODEL) {
		await copyFile(
			join(process.env.ARGON_HOME ?? join(homedir(), ".argon"), "agent", "auth.json"),
			join(home, "agent", "auth.json"),
		);
	}
	await copyFile("scripts/fixtures/desktop-extension.ts", join(home, "agent", "extensions", "probe.ts"));
	await writeFile(
		join(home, "agent", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				probe: {
					command: process.execPath,
					args: [resolve("scripts/fixtures/desktop-mcp.mjs")],
					env: { ARGON_SMOKE_MCP_PID: join(home, "mcp-pid") },
				},
			},
		}),
	);
	const resources =
		process.platform === "darwin"
			? resolve(dirname(executable), "../Resources")
			: resolve(dirname(executable), "resources");
	const imageWorker = resolve(
		resources,
		"app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize-worker.js",
	);
	const child = spawn(executable, [], {
		env: {
			...process.env,
			ARGON_HOME: home,
			ARGON_DESKTOP_SMOKE: home,
			ARGON_SMOKE_IMAGE_WORKER: imageWorker,
			ARGON_SMOKE_CODEMODE: pathToFileURL(resolve(imageWorker, "../../../../pi-codemode/dist/index.js")).href,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (data) => {
		output += data;
		process.stdout.write(data);
	});
	child.stderr.on("data", (data) => {
		output += data;
		process.stderr.write(data);
	});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 180_000);
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	}).finally(() => clearTimeout(timeout));
	assert.equal(code, 0);
	assert(output.includes("DESKTOP_SMOKE_OK"));
	if (process.env.ARGON_SMOKE_MODEL) {
		assert(output.includes("DESKTOP_MODEL_OK"));
		assert.equal((await readFile(join(home, "desktop-smoke.txt"), "utf8")).trim(), "desktop-ok");
	}
	assert.equal(await readFile(join(home, "worker-ok"), "utf8"), "ok");
	assert.equal(await readFile(join(home, "shutdown-ok"), "utf8"), "ok");
	const pid = Number(await readFile(join(home, "mcp-pid"), "utf8"));
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	console.log(
		"✓ Packaged app, TS extension, Codemode + image workers, QuickJS + Photon WASM, MCP and graceful shutdown",
	);
} finally {
	await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
