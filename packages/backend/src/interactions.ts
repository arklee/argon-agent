/**
 * Pending user interactions owned by the backend. They survive client disconnects: any client that
 * (re)attaches sees them in the snapshot and can answer. Answers are accepted once.
 */

import { randomUUID } from "node:crypto";
import type { Interaction, InteractionResponse } from "@argon/shared";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type InteractionDraft = DistributiveOmit<Interaction, "id" | "createdAt" | "expiresAt">;

interface PendingInteraction {
	interaction: Interaction;
	resolve: (response: InteractionResponse) => void;
}

export interface InteractionHost {
	onRequested(interaction: Interaction): void;
	onResolved(interactionId: string): void;
}

export class InteractionBroker {
	private readonly pending = new Map<string, PendingInteraction>();

	constructor(private readonly host: InteractionHost) {}

	request(
		draft: InteractionDraft,
		options: { timeoutMs?: number; signal?: AbortSignal; fallback: InteractionResponse },
	): Promise<InteractionResponse> {
		const id = randomUUID();
		const createdAt = Date.now();
		const interaction = {
			...draft,
			id,
			createdAt,
			expiresAt: options.timeoutMs ? createdAt + options.timeoutMs : undefined,
		} as Interaction;

		return new Promise<InteractionResponse>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (response: InteractionResponse) => {
				if (!this.pending.delete(id)) return;
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
				this.host.onResolved(id);
				resolve(response);
			};
			const onAbort = () => finish(options.fallback);
			if (options.signal?.aborted) {
				resolve(options.fallback);
				return;
			}
			options.signal?.addEventListener("abort", onAbort, { once: true });
			if (options.timeoutMs) timer = setTimeout(() => finish(options.fallback), options.timeoutMs);
			this.pending.set(id, { interaction, resolve: finish });
			this.host.onRequested(interaction);
		});
	}

	/** Returns false when the interaction is no longer pending (already answered, expired, cancelled). */
	respond(interactionId: string, response: InteractionResponse): boolean {
		const pending = this.pending.get(interactionId);
		if (!pending) return false;
		pending.resolve(response);
		return true;
	}

	cancelAll(): void {
		for (const pending of [...this.pending.values()]) pending.resolve({ cancelled: true });
	}

	list(): Interaction[] {
		return [...this.pending.values()].map((p) => p.interaction);
	}
}
