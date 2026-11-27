/**
 * Route this process's fetch through HTTP(S)_PROXY / NO_PROXY, as the pi CLI does in main.js
 * (`configureHttpDispatcher`, not exported by the SDK). Without it Node's fetch ignores proxy
 * environment variables, so model requests and Magpie's Bun download fail behind a proxy.
 * Keep the options in step with pi's core/http-dispatcher.js when upgrading pi.
 */
import { EventEmitter } from "node:events";
import * as undici from "undici";

const HTTP_IDLE_TIMEOUT_MS = 300_000;
// Node's 250ms default can terminate valid connection attempts on high-latency routes.
const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

// Undici can emit an internal Client "error" while terminating a mid-stream fetch body; the body
// stream still rejects. The listener only keeps EventEmitter from treating it as unhandled.
function quiet<T>(dispatcher: T): T {
	if (dispatcher instanceof EventEmitter) EventEmitter.prototype.on.call(dispatcher, "error", () => {});
	return dispatcher;
}

let configured = false;

export function configureHttpDispatcher(): void {
	if (configured) return;
	configured = true;
	const client = (origin: string | URL, options: undici.Client.Options) => quiet(new undici.Client(origin, options));
	undici.setGlobalDispatcher(
		quiet(
			new undici.EnvHttpProxyAgent({
				allowH2: false,
				// Keep HTTP origins on CONNECT tunnels, as pi does.
				proxyTunnel: true,
				bodyTimeout: HTTP_IDLE_TIMEOUT_MS,
				headersTimeout: HTTP_IDLE_TIMEOUT_MS,
				connect: { autoSelectFamilyAttemptTimeout: AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS },
				clientFactory: client,
				factory: (origin, options) => {
					const opts = options as undici.Pool.Options;
					return opts.connections === 1
						? client(origin, opts)
						: quiet(new undici.Pool(origin, { ...opts, factory: client }));
				},
			}),
		),
	);
	// Keep fetch and the dispatcher on the same undici implementation (pi does the same: Node's
	// bundled fetch can otherwise skip decompressing responses read through npm undici).
	undici.install?.();
}
