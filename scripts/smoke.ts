import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { mkdtempSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync } from "node:zlib";
import { AgentClientError, type MethodParams, type SessionState, WebSocketAgentClient } from "@argon/shared";

const STEP_TIMEOUT = 120_000;
const SHUTDOWN_TIMEOUT = 5_000;
const OAUTH_REFRESH_WINDOW = 5 * 60_000;
const HOST = "127.0.0.1";
const MODEL = { provider: "openai", id: "gpt-6-luna" };
const MARKER = "SMOKE-OK";
const COMMAND = "echo argon > smoke.txt";
const ARGON_HOME = process.env.ARGON_HOME ?? join(homedir(), ".argon");
const AUTH_PATH = join(ARGON_HOME, "agent", "auth.json");

/** A solid red PNG, base64. */
function redPng(size = 64): string {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf: Buffer) => {
		let c = 0xffffffff;
		for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc(body), body.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [255, 0, 0]).flat())]);
	const pixels = Buffer.concat(Array.from({ length: size }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

function lastReplyText(state: SessionState): string {
	const reply = state.items.findLast((item) => item.kind === "assistant");
	assert(reply, "Missing assistant reply");
	assert(!reply.errorMessage, reply.errorMessage);
	return reply.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function step(name: string, interrupted: AbortSignal, action: (signal: AbortSignal) => Promise<void>) {
	const start = performance.now();
	const finished = new AbortController();
	const signal = AbortSignal.any([interrupted, AbortSignal.timeout(STEP_TIMEOUT), finished.signal]);
	const aborted = Promise.withResolvers<never>();
	using _listener = addAbortListener(signal, () => {
		aborted.reject(interrupted.aborted ? interrupted.reason : new Error("Timed out after 120s"));
	});
	try {
		const work = Promise.resolve().then(() => {
			signal.throwIfAborted();
			return action(signal);
		});
		await Promise.race([aborted.promise, work]);
		console.log(`✓ ${name} (${Math.round(performance.now() - start)}ms)`);
	} catch (error) {
		console.error(`✗ ${name}: ${reason(error)}`);
		throw error;
	} finally {
		finished.abort();
	}
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, HOST, resolve);
	});
	const address = server.address();
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	assert(address && typeof address === "object", "Could not reserve a port");
	return address.port;
}

async function waitForPort(port: number, signal: AbortSignal) {
	while (!signal.aborted) {
		const ready = await new Promise<boolean>((resolve) => {
			const socket = createConnection({ host: HOST, port, signal });
			socket.once("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.once("error", () => resolve(false));
		});
		if (ready) return;
		await delay(100, undefined, { signal });
	}
	signal.throwIfAborted();
}

async function welcome(client: WebSocketAgentClient, signal: AbortSignal) {
	const received = Promise.withResolvers<void>();
	const unsubscribe = client.onConnectionChange((state) => {
		if (state.status === "failed") received.reject(new AgentClientError(state.error));
		if (state.status === "connected") {
			if (state.environment?.id && state.environment.piVersion) received.resolve();
			else received.reject(new Error("Welcome missing environment or piVersion"));
		}
	});
	using _listener = addAbortListener(signal, () => received.reject(signal.reason));
	try {
		await received.promise;
	} finally {
		unsubscribe();
	}
}

type Prompt = MethodParams<"sessions.prompt">;

async function checkCredentialLifetime() {
	// pi refreshes OAuth credentials with less than five minutes remaining and persists the result.
	const auth = JSON.parse((await readFile(AUTH_PATH, "utf8")).replace(/^\uFEFF/, "")) as Record<
		string,
		{ type?: string; expires?: number } | undefined
	>;
	const credential = auth[MODEL.provider];
	if (credential?.type === "oauth") {
		const minimum = Date.now() + OAUTH_REFRESH_WINDOW + STEP_TIMEOUT + SHUTDOWN_TIMEOUT;
		assert(
			(credential.expires ?? 0) > minimum,
			"OpenAI OAuth would need a refresh during this run. Refresh the Argon login before running smoke.",
		);
	}
}

async function runPrompt(client: WebSocketAgentClient, prompt: Prompt, signal: AbortSignal, approveBash = false) {
	await checkCredentialLifetime();
	signal.throwIfAborted();
	const settled = Promise.withResolvers<void>();
	let approved = false;
	let approval: Promise<void> | undefined;
	const unsubscribe = client.onSessionEvent(({ sessionId, event }) => {
		if (sessionId !== prompt.sessionId) return;
		if (event.type === "notification" && event.level === "error") settled.reject(new Error(event.message));
		if (event.type === "run_settled") {
			if (event.aborted) settled.reject(new Error("Run was aborted"));
			else settled.resolve();
		}
		if (event.type === "interaction_requested") {
			const interaction = event.interaction;
			const args = interaction.kind === "tool_approval" ? (interaction.args as { command?: unknown } | null) : null;
			if (
				interaction.kind !== "tool_approval" ||
				!approveBash ||
				approved ||
				interaction.toolName !== "bash" ||
				args?.command !== COMMAND
			) {
				settled.reject(new Error(`Unexpected interaction: ${interaction.kind}`));
				return;
			}
			if (signal.aborted) return;
			approved = true;
			approval = client
				.request("interactions.respond", {
					sessionId,
					interactionId: interaction.id,
					response: { decision: "allow" },
				})
				.then(({ accepted }) => assert(accepted, "Bash approval was not accepted"));
			void approval.catch(settled.reject);
		}
	});
	using _listener = addAbortListener(signal, () => settled.reject(signal.reason));
	try {
		const [result] = await Promise.all([client.request("sessions.prompt", prompt), settled.promise]);
		assert.equal(result.disposition, "started");
		if (approveBash) {
			assert(approval, "Run settled without requesting Bash approval");
			await approval;
		}
	} finally {
		unsubscribe();
	}
}

function assertSettings(state: SessionState) {
	assert.equal(state.model?.provider, MODEL.provider, "Unexpected model provider");
	assert.equal(state.model?.id, MODEL.id, "Unexpected model ID");
	assert.equal(state.thinkingLevel, "low", "Unexpected thinking level");
	assert.equal(state.permissionMode, "ask", "Unexpected permission mode");
}

async function snapshot(client: WebSocketAgentClient, sessionId: string) {
	const result = await client.request("sessions.attach", { sessionId });
	assert("snapshot" in result, "Attach without sinceSeq must return a snapshot");
	return result.snapshot.state;
}

async function main() {
	const interrupted = new AbortController();
	const interrupt = (signal: NodeJS.Signals) => interrupted.abort(new Error(`Interrupted by ${signal}`));
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", interrupt);

	let backend: ChildProcess | undefined;
	let cwd: string | undefined;
	let sessionPath: string | undefined;
	let activeClient: WebSocketAgentClient | undefined;
	let backendExit: Promise<string> | undefined;
	const killBackend = () => backend?.kill("SIGKILL");
	process.once("exit", killBackend);

	const token = randomBytes(32).toString("base64url");
	let port: number;
	let sessionId: string;
	let lastSeq: number;
	let plain: Prompt;
	const connect = () => {
		activeClient = new WebSocketAgentClient({ url: `ws://${HOST}:${port}`, token, clientName: "argon-smoke" });
		return activeClient;
	};
	// Each step after Handshake has an active client.
	const client = () => {
		assert(activeClient, "Missing client");
		return activeClient;
	};
	const check = (name: string, action: (signal: AbortSignal) => Promise<void>) =>
		step(name, interrupted.signal, action);

	try {
		await check("Handshake", async (signal) => {
			// A fresh Argon home would make the backend initialize non-session files.
			const environment = JSON.parse(await readFile(join(ARGON_HOME, "environment.json"), "utf8")) as { id?: string };
			assert(environment?.id, "ARGON_HOME has no initialized environment ID");
			await access(AUTH_PATH);
			port = await freePort();
			signal.throwIfAborted();
			backend = spawn(process.execPath, ["--import", "tsx", "packages/backend/src/main.ts"], {
				env: {
					...process.env,
					ARGON_HOST: HOST,
					ARGON_PORT: String(port),
					ARGON_TOKEN: token,
					ARGON_LOG_LEVEL: "warn",
					ARGON_TITLE_MODEL: `${MODEL.provider}/${MODEL.id}`,
				},
				stdio: ["ignore", "ignore", "inherit"],
			});
			backendExit = new Promise<string>((resolve) => {
				backend?.once("error", (error) => resolve(reason(error)));
				backend?.once("exit", (code, signal) => resolve(`exit ${signal ?? code}`));
			});
			const ready = async () => {
				await waitForPort(port, signal);
				signal.throwIfAborted();
				await welcome(connect(), signal);
			};
			await Promise.race([
				ready(),
				backendExit.then((status) => {
					throw new Error(`Backend stopped during startup (${status})`);
				}),
			]);
		});

		await check("Create session", async (signal) => {
			cwd = mkdtempSync(join(tmpdir(), "argon-smoke-"));
			const created = await client().request("sessions.create", { cwd });
			sessionId = created.state.sessionId;
			sessionPath = created.state.sessionPath;
			lastSeq = created.seq;
			assert(sessionPath, "Created session has no session path");
			client().onSessionEvent((event) => {
				if (event.sessionId === sessionId) lastSeq = event.seq;
			});
			signal.throwIfAborted();
			await client().request("sessions.setModel", { sessionId, model: MODEL });
			signal.throwIfAborted();
			await client().request("sessions.setThinkingLevel", { sessionId, level: "low" });
			signal.throwIfAborted();
			await client().request("sessions.setPermissionMode", { sessionId, mode: "ask" });
			assertSettings(await snapshot(client(), sessionId));
		});

		await check("Plain prompt", async (signal) => {
			plain = { sessionId, clientMessageId: randomUUID(), text: `Reply with exactly: ${MARKER}` };
			await runPrompt(client(), plain, signal);
			const state = await snapshot(client(), sessionId);
			const reply = state.items.findLast((item) => item.kind === "assistant");
			assert(reply, "Missing assistant reply");
			assert(!reply.errorMessage, reply.errorMessage);
			const replyText = reply.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
			assert(replyText.includes(MARKER), `Last assistant reply did not contain ${MARKER}`);
		});

		await check("Idempotency", async (signal) => {
			await client().request("sessions.prompt", plain);
			signal.throwIfAborted();
			const state = await snapshot(client(), sessionId);
			assert.equal(state.status, "idle", "Duplicate prompt started a run");
			assert.equal(state.items.filter((item) => item.kind === "user").length, 1, "Duplicate prompt added a user item");
		});

		await check("Tool approval", async (signal) => {
			assert(cwd, "Missing temporary project");
			await runPrompt(
				client(),
				{
					sessionId,
					clientMessageId: randomUUID(),
					text: `Use the bash tool to run exactly this command in the current project directory: ${COMMAND}`,
				},
				signal,
				true,
			);
			assert.equal(await readFile(join(cwd, "smoke.txt"), "utf8"), "argon\n", "Unexpected smoke.txt content");
		});

		await check("Edit keeps images", async (signal) => {
			const images = [{ mimeType: "image/png", data: redPng() }];
			await runPrompt(
				client(),
				{ sessionId, clientMessageId: randomUUID(), text: "Reply with one word: OK", images },
				signal,
			);
			const before = await snapshot(client(), sessionId);
			const sent = before.items.findLast((item) => item.kind === "user");
			assert(sent?.kind === "user" && sent.imageCount === 1, "Image was not attached to the message");
			const settled = Promise.withResolvers<void>();
			const unsubscribe = client().onSessionEvent(({ sessionId: id, event }) => {
				if (id === sessionId && event.type === "run_settled") settled.resolve();
			});
			try {
				await client().request("sessions.editMessage", {
					sessionId,
					itemId: sent.id,
					text: "What color is this image? Reply with the color name only, in lowercase English.",
					clientMessageId: randomUUID(),
				});
				await settled.promise;
			} finally {
				unsubscribe();
			}
			const after = await snapshot(client(), sessionId);
			const edited = after.items.findLast((item) => item.kind === "user");
			assert(edited?.kind === "user" && edited.imageCount === 1, "Edited message lost its image");
			assert.match(lastReplyText(after).toLowerCase(), /red/, "Model did not see the image after editing");
		});

		await check("Reconnect", async (signal) => {
			const sinceSeq = lastSeq;
			client().close();
			const reconnected = connect();
			await welcome(reconnected, signal);
			const result = await reconnected.request("sessions.attach", { sessionId, sinceSeq });
			assert("events" in result, "Attach with sinceSeq unexpectedly returned a snapshot");
			assert(
				result.events.every((event) => event.sessionId === sessionId && event.seq > sinceSeq),
				"Attach replayed an event at or before sinceSeq, or from another session",
			);
		});

		await check("Reopen", async (signal) => {
			assert(sessionPath, "Missing session path");
			await client().request("sessions.unload", { sessionId });
			signal.throwIfAborted();
			const { state } = await client().request("sessions.open", { sessionPath });
			assertSettings(state);
			assert(
				state.items.some(
					(item) =>
						item.kind === "assistant" &&
						item.blocks.some((block) => block.type === "text" && block.text.includes(MARKER)),
				),
				`Reopened transcript is missing ${MARKER}`,
			);
			const withImage = state.items.findLast((item) => item.kind === "user" && item.imageCount > 0);
			assert(withImage, "Reopened transcript lost the image attachment");
			const { images } = await client().request("sessions.getImages", {
				sessionId: state.sessionId,
				itemId: withImage.id,
			});
			assert.equal(images.length, 1, "Reopened session could not load the image");
		});

		await check("Cleanup", async () => {
			assert(sessionPath && cwd, "Missing session path or temporary project");
			await client().request("sessions.delete", { sessionPath });
			sessionPath = undefined;
			await rm(cwd, { recursive: true, force: true });
			cwd = undefined;
		});
	} catch {
		process.exitCode = 1;
	} finally {
		if (sessionPath && activeClient?.connection.status === "connected") {
			await Promise.race([
				activeClient.request("sessions.delete", { sessionPath }),
				delay(SHUTDOWN_TIMEOUT, undefined, { ref: false }).then(() => {
					throw new Error("Session deletion timed out");
				}),
			]).catch((error) => console.error(`Session cleanup failed: ${reason(error)}`));
		}
		activeClient?.close();
		if (backend && backendExit) {
			backend.kill("SIGTERM");
			await Promise.race([backendExit, delay(SHUTDOWN_TIMEOUT, undefined, { ref: false })]);
			killBackend();
			await backendExit;
		}
		if (cwd) await rm(cwd, { recursive: true, force: true });
		process.removeListener("exit", killBackend);
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
	}
}

await main();
