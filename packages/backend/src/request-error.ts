import type { ProtocolError } from "@argon/shared";

export class RequestError extends Error {
	constructor(
		readonly code: ProtocolError["code"],
		message: string,
	) {
		super(message);
	}
}
