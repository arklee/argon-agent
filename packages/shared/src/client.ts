/**
 * Transport-independent client interface. Frontends depend only on `AgentClient`; the WebSocket
 * implementation below works in browsers and Node 22+. An Electron IPC implementation can be
 * added later without touching UI code.
 */

import {
	type ClientFrame,
	type EnvironmentInfo,
	type GlobalEvent,
	type MethodName,
	type MethodParams,
	type MethodResult,
	PROTOCOL_VERSION,
	type ProtocolError,
	type ServerFrame,
	type SessionEventEnvelope,
} from "./protocol.ts";

export type ConnectionState =
	| { status: "connecting"; attempt: number }
	| { status: "connected"; environment: EnvironmentInfo }
	| { status: "disconnected"; reason: string; retryInMs?: number }
	| { status: "failed"; error: ProtocolError };

export class AgentClientError extends Error {
	readonly code: ProtocolError["code"];
	constructor(error: ProtocolError) {
		super(error.message);
		this.name = "AgentClientError";
		this.code = error.code;
	}
}

export interface AgentClient {
	readonly connection: ConnectionState;
	request<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResult<M>>;
	onSessionEvent(listener: (envelope: SessionEventEnvelope) => void): () => void;
	onGlobalEvent(listener: (event: GlobalEvent) => void): () => void;
	/** Fires on every connection change. A transition to "connected" after a drop means: resync. */
	onConnectionChange(listener: (state: ConnectionState) => void): () => void;
	close(): void;
}

export interface WebSocketAgentClientOptions {
	url: string;
	token: string;
	clientName: string;
	requestTimeoutMs?: number;
	/** Injected for tests or non-browser runtimes. Defaults to globalThis.WebSocket. */
	WebSocketImpl?: typeof WebSocket;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];

export class WebSocketAgentClient implements AgentClient {
	private socket: WebSocket | undefined;
	private state: ConnectionState = { status: "connecting", attempt: 0 };
	private readonly pending = new Map<string, PendingRequest>();
	private readonly sessionListeners = new Set<(e: SessionEventEnvelope) => void>();
	private readonly globalListeners = new Set<(e: GlobalEvent) => void>();
	private readonly connectionListeners = new Set<(s: ConnectionState) => void>();
	private readonly queuedWhileConnecting: Array<{ send: () => void; reject: (error: Error) => void }> = [];
	private nextRequestId = 1;
	private attempt = 0;
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly options: WebSocketAgentClientOptions) {
		this.connect();
	}

	get connection(): ConnectionState {
		return this.state;
	}

	request<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
		return new Promise((resolve, reject) => {
			const send = () => {
				const id = `r${this.nextRequestId++}`;
				const timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new AgentClientError({ code: "timeout", message: `Request ${method} timed out` }));
				}, this.options.requestTimeoutMs ?? 60_000);
				this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
				this.sendFrame({ kind: "request", id, method, params });
			};
			if (this.state.status === "connected") send();
			else if (this.state.status === "failed") reject(new AgentClientError(this.state.error));
			else this.queuedWhileConnecting.push({ send, reject });
		});
	}

	onSessionEvent(listener: (envelope: SessionEventEnvelope) => void): () => void {
		this.sessionListeners.add(listener);
		return () => this.sessionListeners.delete(listener);
	}

	onGlobalEvent(listener: (event: GlobalEvent) => void): () => void {
		this.globalListeners.add(listener);
		return () => this.globalListeners.delete(listener);
	}

	onConnectionChange(listener: (state: ConnectionState) => void): () => void {
		this.connectionListeners.add(listener);
		return () => this.connectionListeners.delete(listener);
	}

	close(): void {
		this.closed = true;
		clearTimeout(this.reconnectTimer);
		this.socket?.close(1000, "client closed");
		this.failPending({ code: "disconnected", message: "Client closed" });
	}

	private setState(state: ConnectionState): void {
		this.state = state;
		for (const listener of this.connectionListeners) listener(state);
	}

	private connect(): void {
		if (this.closed) return;
		this.setState({ status: "connecting", attempt: this.attempt });
		const Impl = this.options.WebSocketImpl ?? globalThis.WebSocket;
		const socket = new Impl(this.options.url);
		this.socket = socket;

		socket.onopen = () => {
			this.sendFrame({
				kind: "hello",
				protocolVersion: PROTOCOL_VERSION,
				token: this.options.token,
				clientName: this.options.clientName,
			});
		};
		socket.onmessage = (message) => {
			let frame: ServerFrame;
			try {
				frame = JSON.parse(typeof message.data === "string" ? message.data : String(message.data));
			} catch {
				return;
			}
			this.handleFrame(frame);
		};
		socket.onclose = (event) => {
			if (this.socket !== socket) return;
			this.socket = undefined;
			this.failPending({ code: "disconnected", message: "Connection lost" });
			if (this.closed || this.state.status === "failed") return;
			const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
			this.attempt++;
			this.setState({ status: "disconnected", reason: event.reason || `code ${event.code}`, retryInMs: delay });
			this.reconnectTimer = setTimeout(() => this.connect(), delay);
		};
		socket.onerror = () => {
			// onclose follows and handles reconnection.
		};
	}

	private handleFrame(frame: ServerFrame): void {
		switch (frame.kind) {
			case "welcome": {
				this.attempt = 0;
				this.setState({ status: "connected", environment: frame.environment });
				for (const queued of this.queuedWhileConnecting.splice(0)) queued.send();
				return;
			}
			case "response": {
				const pending = this.pending.get(frame.id);
				if (!pending) return;
				this.pending.delete(frame.id);
				clearTimeout(pending.timer);
				if (frame.ok) pending.resolve(frame.result);
				else pending.reject(new AgentClientError(frame.error));
				return;
			}
			case "session_event":
				for (const listener of this.sessionListeners) listener(frame.envelope);
				return;
			case "global_event":
				for (const listener of this.globalListeners) listener(frame.event);
				return;
			case "fatal":
				this.setState({ status: "failed", error: frame.error });
				for (const queued of this.queuedWhileConnecting.splice(0)) queued.reject(new AgentClientError(frame.error));
				this.failPending(frame.error);
				this.socket?.close();
				return;
		}
	}

	private sendFrame(frame: ClientFrame): void {
		this.socket?.send(JSON.stringify(frame));
	}

	private failPending(error: ProtocolError): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new AgentClientError(error));
			this.pending.delete(id);
		}
	}
}
