/**
 * WebSocket transport for the Argon protocol.
 *
 * Security: this server can run shell commands. It binds to loopback by default, rejects
 * upgrades whose Host or Origin is unexpected (DNS rebinding / cross-site pages), and requires
 * the token in the first frame before handling anything else.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import {
	type ClientFrame,
	type MethodName,
	type MethodParams,
	type MethodResult,
	PROTOCOL_VERSION,
	type ProtocolError,
	type ServerFrame,
} from "@argon/shared";
import { type WebSocket, WebSocketServer } from "ws";
import type { BackendConfig } from "./config.ts";
import { listDir, saveUpload } from "./fs-api.ts";
import { log } from "./log.ts";
import { NotFoundError, type SessionRegistry } from "./registry.ts";

const AUTH_TIMEOUT_MS = 5000;
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

type Handler<M extends MethodName> = (params: MethodParams<M>, conn: Connection) => Promise<MethodResult<M>>;
type HandlerTable = { [M in MethodName]: Handler<M> };

class RequestError extends Error {
	constructor(
		readonly code: ProtocolError["code"],
		message: string,
	) {
		super(message);
	}
}

function tokensMatch(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function isLoopbackHost(host: string): boolean {
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isUpgradeAllowed(
	req: IncomingMessage,
	config: BackendConfig,
): { ok: true } | { ok: false; reason: string } {
	const origin = req.headers.origin;
	if (origin && !config.allowedOrigins.includes(origin)) return { ok: false, reason: `origin not allowed: ${origin}` };
	if (isLoopbackHost(config.host)) {
		const hostHeader = req.headers.host ?? "";
		const allowedHosts = [`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`];
		if (!allowedHosts.includes(hostHeader)) return { ok: false, reason: `host not allowed: ${hostHeader}` };
	}
	return { ok: true };
}

class Connection {
	authenticated = false;
	readonly attached = new Map<string, () => void>();
	private unsubscribeGlobal: (() => void) | undefined;

	constructor(
		readonly socket: WebSocket,
		readonly id: number,
		private readonly registry: SessionRegistry,
	) {}

	send(frame: ServerFrame): void {
		if (this.socket.readyState !== this.socket.OPEN) return;
		if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
			// The client cannot keep up; drop it. It will reconnect and resync from a snapshot.
			log.warn(`connection ${this.id} too slow, closing`);
			this.socket.close(1013, "client too slow");
			return;
		}
		this.socket.send(JSON.stringify(frame));
	}

	onAuthenticated(): void {
		this.authenticated = true;
		this.unsubscribeGlobal = this.registry.onGlobalEvent((event) => {
			if (event.type === "session_unloaded") this.detach(event.sessionId);
			this.send({ kind: "global_event", event });
		});
	}

	/** Subscribe this connection to a session's events. Must be called synchronously after taking a snapshot. */
	attach(sessionId: string): void {
		if (this.attached.has(sessionId)) return;
		const session = this.registry.require(sessionId);
		const unsubscribe = session.subscribe((envelope) => this.send({ kind: "session_event", envelope }));
		this.attached.set(sessionId, unsubscribe);
	}

	detach(sessionId: string): void {
		this.attached.get(sessionId)?.();
		this.attached.delete(sessionId);
	}

	dispose(): void {
		for (const unsubscribe of this.attached.values()) unsubscribe();
		this.attached.clear();
		this.unsubscribeGlobal?.();
	}
}

function createHandlers(registry: SessionRegistry, config: BackendConfig): HandlerTable {
	const empty = {} as Record<string, never>;
	return {
		"environment.info": async () => config.environment,
		"fs.listDir": async (params) => listDir(params.path, params.dirsOnly ?? true),
		"files.upload": async (params) => saveUpload(config.argonHome, params.name, params.data),
		"sessions.getImages": async (params) => ({
			images: registry.require(params.sessionId).getImages({ toolCallId: params.toolCallId, itemId: params.itemId }),
		}),
		"models.list": async () => ({ models: await registry.listModels() }),
		"sessions.list": async (params) => ({ sessions: await registry.list(params.cwd) }),
		"sessions.create": async (params, conn) => {
			if (!params.cwd) throw new RequestError("bad_request", "cwd is required");
			const session = await registry.create(params.cwd);
			const snapshot = session.snapshot();
			conn.attach(session.sessionId);
			return snapshot;
		},
		"sessions.open": async (params, conn) => {
			const session = await registry.open(params.sessionPath);
			const snapshot = session.snapshot();
			conn.attach(session.sessionId);
			return snapshot;
		},
		"sessions.attach": async (params, conn) => {
			const session = registry.require(params.sessionId);
			const events = params.sinceSeq !== undefined ? session.eventsSince(params.sinceSeq) : undefined;
			conn.attach(params.sessionId);
			return events ? { events } : { snapshot: session.snapshot() };
		},
		"sessions.detach": async (params, conn) => {
			conn.detach(params.sessionId);
			return empty;
		},
		"sessions.prompt": async (params) => {
			if (!params.clientMessageId) throw new RequestError("bad_request", "clientMessageId is required");
			const disposition = await registry.require(params.sessionId).prompt(params);
			return { disposition };
		},
		"sessions.abort": async (params) => {
			await registry.require(params.sessionId).abort();
			return empty;
		},
		"sessions.setModel": async (params) => {
			await registry.setModel(params.sessionId, params.model);
			return empty;
		},
		"sessions.setThinkingLevel": async (params) => {
			registry.require(params.sessionId).setThinkingLevel(params.level);
			return empty;
		},
		"sessions.setPermissionMode": async (params) => {
			registry.require(params.sessionId).setPermissionMode(params.mode);
			return empty;
		},
		"sessions.rename": async (params) => {
			registry.require(params.sessionId).rename(params.name);
			return empty;
		},
		"sessions.mcpAction": async (params) => {
			const error = await registry
				.require(params.sessionId)
				.mcpAction({ server: params.server, action: params.action, exposure: params.exposure });
			return error ? { error } : {};
		},
		"sessions.editMessage": async (params) => ({
			disposition: await registry.require(params.sessionId).editMessage(params),
		}),
		"sessions.clearQueue": async (params) => registry.require(params.sessionId).clearQueue(),
		"sessions.compact": async (params) => {
			registry.require(params.sessionId).compact(params.customInstructions);
			return empty;
		},
		"sessions.commands": async (params) => ({ commands: registry.require(params.sessionId).listCommands() }),
		"sessions.completeCommand": async (params) => ({
			items: await registry.require(params.sessionId).completeCommand(params.name, params.argumentPrefix),
		}),
		"sessions.completeFile": async (params) =>
			(await registry.require(params.sessionId).completeFile(params.textBeforeCursor)) ?? null,
		"sessions.delete": async (params) => {
			await registry.delete(params.sessionPath);
			return empty;
		},
		"sessions.switchBranch": async (params) => {
			await registry.require(params.sessionId).switchBranch(params.itemId, params.direction);
			return empty;
		},
		"sessions.fork": async (params) => registry.fork(params.sessionId, params.itemId),
		"sessions.clone": async (params) => registry.clone(params.sessionId),
		"projects.list": async () => ({ projects: await registry.listProjects() }),
		"projects.update": async (params) => {
			if (!params.cwd) throw new RequestError("bad_request", "cwd is required");
			await registry.updateProject(params);
			return empty;
		},
		"sessions.unload": async (params) => {
			await registry.unload(params.sessionId);
			return empty;
		},
		"interactions.respond": async (params) => {
			const accepted = registry.require(params.sessionId).respond(params.interactionId, params.response);
			return { accepted };
		},
	};
}

export interface RunningServer {
	server: Server;
	url: string;
	close(): Promise<void>;
}

export async function startServer(registry: SessionRegistry, config: BackendConfig): Promise<RunningServer> {
	const handlers = createHandlers(registry, config);
	const connections = new Set<Connection>();
	let nextConnectionId = 1;

	const server = createServer((req, res) => {
		if (req.url === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}
		res.writeHead(404);
		res.end();
	});

	const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

	server.on("upgrade", (req, socket, head) => {
		const check = isUpgradeAllowed(req, config);
		if (!check.ok) {
			log.warn(`rejected upgrade: ${check.reason}`);
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
	});

	wss.on("connection", (socket: WebSocket) => {
		const conn = new Connection(socket, nextConnectionId++, registry);
		connections.add(conn);
		const authTimer = setTimeout(() => {
			if (!conn.authenticated) socket.close(4401, "authentication timeout");
		}, AUTH_TIMEOUT_MS);

		socket.on("message", (data) => {
			let frame: ClientFrame;
			try {
				frame = JSON.parse(data.toString());
			} catch {
				conn.send({ kind: "fatal", error: { code: "bad_request", message: "Invalid JSON" } });
				socket.close(4400, "invalid json");
				return;
			}
			if (!conn.authenticated) {
				if (frame.kind !== "hello" || typeof frame.token !== "string" || !tokensMatch(frame.token, config.token)) {
					conn.send({ kind: "fatal", error: { code: "unauthorized", message: "Invalid token" } });
					socket.close(4401, "unauthorized");
					return;
				}
				if (frame.protocolVersion !== PROTOCOL_VERSION) {
					conn.send({
						kind: "fatal",
						error: {
							code: "protocol_mismatch",
							message: `Backend speaks protocol ${PROTOCOL_VERSION}, client ${frame.protocolVersion}`,
						},
					});
					socket.close(4426, "protocol mismatch");
					return;
				}
				clearTimeout(authTimer);
				conn.onAuthenticated();
				log.info(`client connected #${conn.id} (${frame.clientName})`);
				conn.send({ kind: "welcome", protocolVersion: PROTOCOL_VERSION, environment: config.environment });
				return;
			}
			if (frame.kind !== "request") return;
			void handleRequest(conn, frame);
		});

		socket.on("close", () => {
			clearTimeout(authTimer);
			conn.dispose();
			connections.delete(conn);
			if (conn.authenticated) log.info(`client disconnected #${conn.id}`);
		});
	});

	async function handleRequest(conn: Connection, frame: Extract<ClientFrame, { kind: "request" }>): Promise<void> {
		const handler = handlers[frame.method] as Handler<MethodName> | undefined;
		if (!handler) {
			conn.send({
				kind: "response",
				id: frame.id,
				ok: false,
				error: { code: "bad_request", message: `Unknown method: ${frame.method}` },
			});
			return;
		}
		try {
			const result = await handler((frame.params ?? {}) as never, conn);
			conn.send({ kind: "response", id: frame.id, ok: true, result });
		} catch (error) {
			const code: ProtocolError["code"] =
				error instanceof RequestError ? error.code : error instanceof NotFoundError ? "not_found" : "internal";
			const message = error instanceof Error ? error.message : String(error);
			if (code === "internal") log.error(`${frame.method} failed`, error);
			conn.send({ kind: "response", id: frame.id, ok: false, error: { code, message } });
		}
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => resolve());
	});

	const hostForUrl = config.host.includes(":") ? `[${config.host}]` : config.host;
	return {
		server,
		url: `ws://${hostForUrl}:${config.port}`,
		close: async () => {
			for (const conn of connections) conn.socket.close(1001, "server shutting down");
			wss.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
