/**
 * Framework-agnostic client-side session mirror. Keeps one SessionState per attached session,
 * applies events in seq order, detects gaps and resyncs after reconnects.
 */

import { type AgentClient, AgentClientError } from "./client.ts";
import type { SessionEvent, SessionEventEnvelope, SessionSnapshot, SessionState } from "./protocol.ts";
import { applySessionEvent } from "./reducer.ts";

interface Tracked {
	state: SessionState;
	seq: number;
	resyncing: boolean;
	/** Events received while resyncing; applied after the snapshot when contiguous. */
	buffered: SessionEventEnvelope[];
}

export type SessionMirrorListener = (sessionId: string, state: SessionState | undefined) => void;
export type SessionNotificationListener = (
	sessionId: string,
	event: Extract<SessionEvent, { type: "notification" }>,
) => void;

export class SessionMirror {
	private readonly tracked = new Map<string, Tracked>();
	private readonly listeners = new Set<SessionMirrorListener>();
	private readonly notificationListeners = new Set<SessionNotificationListener>();
	private wasConnected = false;
	private readonly disposers: Array<() => void> = [];

	constructor(private readonly client: AgentClient) {
		this.disposers.push(client.onSessionEvent((envelope) => this.handleEnvelope(envelope)));
		this.disposers.push(
			client.onGlobalEvent((event) => {
				if (event.type === "session_unloaded") this.forget(event.sessionId);
			}),
		);
		this.disposers.push(
			client.onConnectionChange((state) => {
				if (state.status !== "connected") return;
				if (this.wasConnected) {
					for (const sessionId of this.tracked.keys()) void this.resync(sessionId);
				}
				this.wasConnected = true;
			}),
		);
		if (client.connection.status === "connected") this.wasConnected = true;
	}

	get(sessionId: string): SessionState | undefined {
		return this.tracked.get(sessionId)?.state;
	}

	subscribe(listener: SessionMirrorListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onNotification(listener: SessionNotificationListener): () => void {
		this.notificationListeners.add(listener);
		return () => this.notificationListeners.delete(listener);
	}

	async create(cwd: string): Promise<SessionState> {
		return this.adopt(await this.client.request("sessions.create", { cwd }));
	}

	async open(sessionPath: string): Promise<SessionState> {
		return this.adopt(await this.client.request("sessions.open", { sessionPath }));
	}

	async attach(sessionId: string): Promise<SessionState> {
		const existing = this.tracked.get(sessionId);
		if (existing) return existing.state;
		const result = await this.client.request("sessions.attach", { sessionId });
		if (!("snapshot" in result)) throw new Error("Expected snapshot from attach without sinceSeq");
		return this.adopt(result.snapshot);
	}

	async detach(sessionId: string): Promise<void> {
		this.forget(sessionId);
		await this.client.request("sessions.detach", { sessionId }).catch(() => undefined);
	}

	dispose(): void {
		for (const dispose of this.disposers) dispose();
		this.tracked.clear();
		this.listeners.clear();
	}

	/** `force` replaces even a newer local state (the backend restarted and its seq began again). */
	private adopt(snapshot: SessionSnapshot, force = false): SessionState {
		const sessionId = snapshot.state.sessionId;
		const existing = this.tracked.get(sessionId);
		// A snapshot older than what we already applied would move state backwards.
		if (!force && existing && existing.seq > snapshot.seq) return existing.state;
		this.tracked.set(sessionId, { state: snapshot.state, seq: snapshot.seq, resyncing: false, buffered: [] });
		this.emit(sessionId);
		return snapshot.state;
	}

	private forget(sessionId: string): void {
		if (this.tracked.delete(sessionId)) this.emit(sessionId);
	}

	private handleEnvelope(envelope: SessionEventEnvelope): void {
		const tracked = this.tracked.get(envelope.sessionId);
		if (!tracked) return;
		if (tracked.resyncing) {
			tracked.buffered.push(envelope);
			return;
		}
		if (envelope.seq <= tracked.seq) return; // duplicate
		if (envelope.seq !== tracked.seq + 1) {
			tracked.buffered.push(envelope);
			void this.resync(envelope.sessionId);
			return;
		}
		this.apply(tracked, envelope);
		this.emit(envelope.sessionId);
	}

	private apply(tracked: Tracked, envelope: SessionEventEnvelope): void {
		tracked.state = applySessionEvent(tracked.state, envelope.event);
		tracked.seq = envelope.seq;
		if (envelope.event.type === "notification") {
			for (const listener of this.notificationListeners) listener(envelope.sessionId, envelope.event);
		}
	}

	private async resync(sessionId: string): Promise<void> {
		const tracked = this.tracked.get(sessionId);
		if (!tracked || tracked.resyncing) return;
		tracked.resyncing = true;
		const startSeq = tracked.seq;
		try {
			const result = await this.client.request("sessions.attach", { sessionId, sinceSeq: tracked.seq });
			const current = this.tracked.get(sessionId);
			if (current !== tracked) return;
			if ("snapshot" in result) {
				tracked.state = result.snapshot.state;
				tracked.seq = result.snapshot.seq;
			} else {
				for (const envelope of result.events) {
					if (envelope.seq === tracked.seq + 1) this.apply(tracked, envelope);
				}
			}
			const buffered = tracked.buffered.splice(0).sort((a, b) => a.seq - b.seq);
			for (const envelope of buffered) {
				if (envelope.seq === tracked.seq + 1) this.apply(tracked, envelope);
			}
			tracked.resyncing = false;
			this.emit(sessionId);
			// Still a gap before some buffered events: keep them and replay again, as long as this
			// round made progress (otherwise the next live event retries).
			const ahead = buffered.filter((envelope) => envelope.seq > tracked.seq + 1);
			if (ahead.length > 0 && tracked.seq > startSeq) {
				tracked.buffered.push(...ahead);
				void this.resync(sessionId);
			}
		} catch (error) {
			tracked.resyncing = false;
			if (this.client.connection.status !== "connected") return;
			// The backend no longer has the session loaded (e.g. it restarted): reopen it from its file.
			const sessionPath = tracked.state.sessionPath;
			if (error instanceof AgentClientError && error.code === "not_found" && sessionPath) {
				try {
					this.adopt(await this.client.request("sessions.open", { sessionPath }), true);
					return;
				} catch {
					// fall through
				}
			}
			this.forget(sessionId);
		}
	}

	private emit(sessionId: string): void {
		const state = this.tracked.get(sessionId)?.state;
		for (const listener of this.listeners) listener(sessionId, state);
	}
}
