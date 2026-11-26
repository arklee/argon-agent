import { describe, expect, it } from "vitest";
import { type AgentClient, AgentClientError, type ConnectionState } from "../src/client.ts";
import type {
	GlobalEvent,
	MethodName,
	MethodParams,
	MethodResult,
	SessionEventEnvelope,
	SessionSnapshot,
} from "../src/protocol.ts";
import { createEmptySessionState } from "../src/reducer.ts";
import { SessionMirror } from "../src/session-store.ts";

const sessionId = "s1";
const sessionPath = "/project/s1.jsonl";
const connected: ConnectionState = {
	status: "connected",
	environment: {
		id: "test",
		name: "Test backend",
		hostname: "localhost",
		platform: "linux",
		homeDir: "/home/test",
		argonVersion: "test",
		piVersion: "test",
		sandbox: { supported: false },
	},
};

class FakeAgentClient implements AgentClient {
	connection: ConnectionState = connected;
	readonly calls: Array<{ method: MethodName; params: unknown }> = [];
	private readonly responses: Array<() => unknown> = [];
	private readonly sessionListeners = new Set<(event: SessionEventEnvelope) => void>();
	private readonly globalListeners = new Set<(event: GlobalEvent) => void>();
	private readonly connectionListeners = new Set<(state: ConnectionState) => void>();

	respond<M extends MethodName>(method: M, response: MethodResult<M> | Error): void {
		this.responses.push(() => {
			expect(this.calls.at(-1)?.method).toBe(method);
			if (response instanceof Error) throw response;
			return response;
		});
	}

	async request<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
		this.calls.push({ method, params });
		const respond = this.responses.shift();
		if (!respond) throw new Error(`Unexpected request: ${method}`);
		return respond() as MethodResult<M>;
	}

	onSessionEvent(listener: (event: SessionEventEnvelope) => void): () => void {
		this.sessionListeners.add(listener);
		return () => this.sessionListeners.delete(listener);
	}

	onConnectionChange(listener: (state: ConnectionState) => void): () => void {
		this.connectionListeners.add(listener);
		return () => this.connectionListeners.delete(listener);
	}

	onGlobalEvent(listener: (event: GlobalEvent) => void): () => void {
		this.globalListeners.add(listener);
		return () => this.globalListeners.delete(listener);
	}

	emitGlobal(event: GlobalEvent): void {
		for (const listener of this.globalListeners) listener(event);
	}

	close(): void {
		this.setConnection({ status: "disconnected", reason: "Test disconnect" });
	}

	reconnect(): void {
		this.setConnection(connected);
	}

	emit(event: SessionEventEnvelope): void {
		for (const listener of this.sessionListeners) listener(event);
	}

	private setConnection(state: ConnectionState): void {
		this.connection = state;
		for (const listener of this.connectionListeners) listener(state);
	}
}

function snapshot(seq: number, name = "Initial session"): SessionSnapshot {
	return { seq, state: { ...createEmptySessionState({ sessionId, sessionPath, cwd: "/project" }), name } };
}

function rename(seq: number, name: string): SessionEventEnvelope {
	return { sessionId, seq, event: { type: "name_changed", name } };
}

async function attach(initialSeq = 3) {
	const client = new FakeAgentClient();
	const mirror = new SessionMirror(client);
	client.respond("sessions.attach", { snapshot: snapshot(initialSeq) });
	await mirror.attach(sessionId);
	return { client, mirror };
}

describe("SessionMirror", () => {
	it("applies consecutive events in sequence order", async () => {
		const { client, mirror } = await attach();
		const names: Array<string | undefined> = [];
		mirror.subscribe((_, state) => names.push(state?.name));

		client.emit(rename(4, "First"));
		client.emit(rename(5, "Second"));

		expect(names).toEqual(["First", "Second"]);
		expect(mirror.get(sessionId)?.name).toBe("Second");
		expect(client.calls).toEqual([{ method: "sessions.attach", params: { sessionId } }]);
	});

	it("ignores duplicate and older sequence numbers", async () => {
		const { client, mirror } = await attach();
		client.emit(rename(4, "Current"));
		const current = mirror.get(sessionId);
		let updates = 0;
		mirror.subscribe(() => updates++);

		client.emit(rename(4, "Duplicate"));
		client.emit(rename(2, "Old"));

		expect(mirror.get(sessionId)).toBe(current);
		expect(updates).toBe(0);
		expect(client.calls).toHaveLength(1);
	});

	it("fills a sequence gap from replay and applies buffered live events in order", async () => {
		const { client, mirror } = await attach();
		const notifications: string[] = [];
		mirror.onNotification((_, event) => notifications.push(event.message));
		const notify = (seq: number): SessionEventEnvelope => ({
			sessionId,
			seq,
			event: { type: "notification", level: "info", message: String(seq) },
		});
		client.respond("sessions.attach", { events: [notify(4), notify(5)] });

		client.emit(notify(7));
		client.emit(notify(6));
		client.emit(notify(5));
		expect(notifications).toEqual([]);
		expect(client.calls).toEqual([
			{ method: "sessions.attach", params: { sessionId } },
			{ method: "sessions.attach", params: { sessionId, sinceSeq: 3 } },
		]);

		await Promise.resolve();
		expect(notifications).toEqual(["4", "5", "6", "7"]);
		client.emit(notify(8));
		expect(notifications).toEqual(["4", "5", "6", "7", "8"]);
	});

	it("reattaches after reconnect with the last applied sequence", async () => {
		const { client, mirror } = await attach();
		client.emit(rename(4, "Before disconnect"));
		client.respond("sessions.attach", { events: [rename(5, "While disconnected")] });

		client.close();
		expect(client.calls).toHaveLength(1);
		client.reconnect();

		expect(client.calls.at(-1)).toEqual({ method: "sessions.attach", params: { sessionId, sinceSeq: 4 } });
		await Promise.resolve();
		expect(mirror.get(sessionId)?.name).toBe("While disconnected");
	});

	it("adopts a snapshot when replay is unavailable and then applies newer live events", async () => {
		const { client, mirror } = await attach();
		const fallback = snapshot(10, "From snapshot");
		client.respond("sessions.attach", { snapshot: fallback });

		client.emit(rename(10, "Already in snapshot"));
		expect(client.calls.at(-1)).toEqual({ method: "sessions.attach", params: { sessionId, sinceSeq: 3 } });

		await Promise.resolve();
		expect(mirror.get(sessionId)).toEqual(fallback.state);
		client.emit(rename(11, "After snapshot"));
		expect(mirror.get(sessionId)?.name).toBe("After snapshot");
	});

	it("reopens by path after a backend restart and adopts the lower sequence snapshot", async () => {
		const { client, mirror } = await attach(20);
		const restarted = snapshot(0, "Reopened session");
		client.respond("sessions.attach", new AgentClientError({ code: "not_found", message: "Session not loaded" }));
		client.respond("sessions.open", restarted);

		client.close();
		client.reconnect();
		await Promise.resolve();
		await Promise.resolve();

		expect(client.calls).toEqual([
			{ method: "sessions.attach", params: { sessionId } },
			{ method: "sessions.attach", params: { sessionId, sinceSeq: 20 } },
			{ method: "sessions.open", params: { sessionPath } },
		]);
		expect(mirror.get(sessionId)).toEqual(restarted.state);
		client.emit(rename(1, "After restart"));
		expect(mirror.get(sessionId)?.name).toBe("After restart");
	});

	it("requests another replay when buffered events still contain a gap", async () => {
		const { client, mirror } = await attach();
		client.respond("sessions.attach", { events: [rename(4, "First replay")] });
		client.respond("sessions.attach", { events: [rename(5, "Second replay"), rename(6, "Latest")] });
		client.close();
		client.reconnect();

		client.emit(rename(6, "Latest"));
		await Promise.resolve();
		await Promise.resolve();

		expect(client.calls.at(-1)).toEqual({ method: "sessions.attach", params: { sessionId, sinceSeq: 4 } });
		expect(mirror.get(sessionId)?.name).toBe("Latest");
	});
});

describe("unloaded sessions", () => {
	it("keeps saved state, emits it, ignores events and skips reconnect resync", async () => {
		const { client, mirror } = await attach();
		const state = mirror.get(sessionId);
		const updates: unknown[] = [];
		mirror.subscribe((_, next) => updates.push(next));
		client.emitGlobal({ type: "session_unloaded", sessionId });
		expect(mirror.get(sessionId)).toBe(state);
		expect(mirror.isUnloaded(sessionId)).toBe(true);
		expect(updates).toEqual([state]);
		client.emit(rename(4, "Ignored"));
		client.close();
		client.reconnect();
		expect(mirror.get(sessionId)).toBe(state);
		expect(client.calls).toHaveLength(1);
	});

	it("shares reopening requests and adopts a lower sequence through attach", async () => {
		const { client, mirror } = await attach(20);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		client.respond("sessions.open", snapshot(0, "Fresh"));
		const first = mirror.reopen(sessionId);
		expect(mirror.reopen(sessionId)).toBe(first);
		const attached = mirror.attach(sessionId);
		await first;
		expect(await attached).toBe(mirror.get(sessionId));
		expect(mirror.isUnloaded(sessionId)).toBe(false);
		client.emit(rename(1, "Next"));
		expect(mirror.get(sessionId)?.name).toBe("Next");
		expect(client.calls).toHaveLength(2);
	});

	it("applies sorted, deduplicated live events received while reopening", async () => {
		const { client, mirror } = await attach(20);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		const fresh = snapshot(0);
		fresh.state.status = "running";
		client.respond("sessions.open", fresh);
		const pending = mirror.reopen(sessionId);
		client.emit({ sessionId, seq: 2, event: { type: "run_settled", aborted: false } });
		client.emit(rename(1, "Recovered"));
		client.emit(rename(1, "Duplicate"));
		await pending;
		expect(mirror.get(sessionId)?.status).toBe("idle");
		expect(mirror.get(sessionId)?.name).toBe("Recovered");
	});

	it("resyncs a gap in events buffered while reopening", async () => {
		const { client, mirror } = await attach(20);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		client.respond("sessions.open", snapshot(0));
		const pending = mirror.reopen(sessionId);
		client.emit(rename(2, "Recovered"));
		client.respond("sessions.attach", { events: [rename(1, "Missing")] });
		await pending;
		expect(mirror.get(sessionId)?.name).toBe("Recovered");
		expect(client.calls.at(-1)?.params).toEqual({ sessionId, sinceSeq: 0 });
	});

	it("preserves an unload received while reopening", async () => {
		const { client, mirror } = await attach(20);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		client.respond("sessions.open", snapshot(0, "Reopened"));
		const pending = mirror.reopen(sessionId);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		await pending;
		expect(mirror.isUnloaded(sessionId)).toBe(true);
		expect(mirror.get(sessionId)?.name).toBe("Reopened");
		client.emit(rename(1, "Ignored"));
		expect(mirror.get(sessionId)?.name).toBe("Reopened");
	});

	it("forgets a missing file but keeps state on other reopen failures", async () => {
		const { client, mirror } = await attach();
		client.emitGlobal({ type: "session_unloaded", sessionId });
		client.respond("sessions.open", new Error("Offline"));
		await expect(mirror.reopen(sessionId)).rejects.toThrow("Offline");
		expect(mirror.isUnloaded(sessionId)).toBe(true);
		client.respond("sessions.open", new AgentClientError({ code: "not_found", message: "Deleted" }));
		await expect(mirror.reopen(sessionId)).rejects.toThrow("Deleted");
		expect(mirror.get(sessionId)).toBeUndefined();
		expect(mirror.isUnloaded(sessionId)).toBe(false);
	});

	it("forgets unsaved sessions on unload", async () => {
		const client = new FakeAgentClient();
		const mirror = new SessionMirror(client);
		const initial = snapshot(0);
		delete initial.state.sessionPath;
		client.respond("sessions.attach", { snapshot: initial });
		await mirror.attach(sessionId);
		client.emitGlobal({ type: "session_unloaded", sessionId });
		expect(mirror.get(sessionId)).toBeUndefined();
	});

	it("delivers snapshot notifications once, without replaying them on attach or duplicate events", async () => {
		const client = new FakeAgentClient();
		const mirror = new SessionMirror(client);
		const initial = snapshot(3);
		const event = { type: "notification", level: "info", message: "Hello" } as const;
		initial.notifications = [event];
		const messages: string[] = [];
		mirror.onNotification((_, notification) => messages.push(notification.message));
		client.respond("sessions.open", initial);
		await mirror.open(sessionPath);
		await mirror.attach(sessionId);
		client.respond("sessions.open", initial);
		await mirror.open(sessionPath);
		client.emit({ sessionId, seq: 3, event });
		expect(messages).toEqual(["Hello"]);
	});
});
