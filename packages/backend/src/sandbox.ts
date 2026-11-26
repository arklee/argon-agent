/** The only adapter to srt's process-global manager. Filesystem policy is per invocation. */
import { randomUUID } from "node:crypto";
import { getDefaultWritePaths, SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import {
	isValidAllowedDomainEntry,
	matchesDomainPatternWithPort,
} from "@anthropic-ai/sandbox-runtime/dist/sandbox/domain-pattern.js";
import type { PermissionMode } from "@argon/shared";
import {
	type BashOperations,
	createBashToolDefinition,
	createLocalBashOperations,
	getShellConfig,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { InteractionBroker } from "./interactions.ts";
import { log } from "./log.ts";
import { canonicalPath, PROTECTED_NAMES, SandboxPolicy, within } from "./sandbox-policy.ts";
import type { ArgonSettingsStore } from "./settings.ts";

export interface SandboxSession {
	id: string;
	broker: InteractionBroker;
	allowedDomains: Set<string>;
}
interface Invocation {
	session: SandboxSession;
	toolCallId: string;
	signal?: AbortSignal;
}

/** Requests have no trustworthy session id. Keep the explicitly documented fallback deterministic. */
export class NetworkAttribution {
	private readonly active = new Map<string, Invocation>();
	private latest: Invocation | undefined;
	start(call: Invocation): () => void {
		const key = randomUUID();
		this.active.set(key, call);
		this.latest = call;
		return () => {
			this.active.delete(key);
		};
	}
	select(): { call: Invocation | undefined; ambiguous: boolean } {
		const calls = [...this.active.values()];
		const sessions = new Set(calls.map((call) => call.session.id));
		return { call: calls.at(-1) ?? this.latest, ambiguous: sessions.size !== 1 };
	}
	forget(sessionId: string): void {
		for (const [key, call] of this.active) if (call.session.id === sessionId) this.active.delete(key);
		if (this.latest?.session.id === sessionId) this.latest = [...this.active.values()].at(-1);
	}
}

export function runtimeConfig(policy: SandboxPolicy): SandboxRuntimeConfig {
	const literals = (paths: string[]) => paths.map((path) => ({ path, literal: true as const }));
	// srt also grants ~/.npm/_logs and ~/.claude/debug by default. Remove those
	// convenience grants unless the session's actual roots already include them.
	const extraDenies = getDefaultWritePaths().filter(
		(path) => !path.startsWith("/dev/") && !policy.writableRoots.some((root) => within(canonicalPath(path), root)),
	);
	return {
		network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: [], allowLocalBinding: false },
		filesystem: {
			allowWrite: literals(policy.writableRoots),
			denyRead: literals(policy.readDeny),
			denyWrite: [
				...literals([...policy.writeDeny, ...extraDenies]),
				...PROTECTED_NAMES.flatMap((name) => [
					`/**/${name}`,
					`/**/${name.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`)}`,
				]),
			],
		},
	};
}

export class ArgonSandbox {
	readonly attribution = new NetworkAttribution();
	private initialization: Promise<void> | undefined;
	constructor(private readonly settings: ArgonSettingsStore) {}

	async initialize(): Promise<void> {
		if (!this.settings.support.supported) throw new Error(this.settings.support.reason);
		this.initialization ??= this.initializeOnce().catch((error) => {
			this.settings.support.reason = `Sandbox initialization failed: ${error instanceof Error ? error.message : error}`;
			log.error(this.settings.support.reason);
			throw new Error(this.settings.support.reason);
		});
		return this.initialization;
	}

	private async initializeOnce(): Promise<void> {
		const config = runtimeConfig(new SandboxPolicy(process.cwd(), this.settings.argonHome));
		// pi may have downloaded rg into its private bin directory. No download here.
		const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
		const { getToolPath } = (await import(new URL("./utils/tools-manager.js", entry).href)) as {
			getToolPath(tool: "rg"): string | null;
		};
		const rg = getToolPath("rg");
		if (rg) config.ripgrep = { command: rg };
		await SandboxManager.initialize(config, (request) => this.askNetwork(request.host, request.port));
	}

	async askNetwork(host: string, port?: number): Promise<boolean> {
		const { call, ambiguous } = this.attribution.select();
		if (ambiguous)
			log.warn(
				`Sandbox network request for ${host}: ambiguous session attribution; using most recently started command`,
			);
		if (!call) return false;
		// Keep global and session grants out of the global srt allowlist: settings changes apply live,
		// and a session-only grant cannot accidentally become a global grant.
		if (
			this.settings.get().sandbox.allowedDomains.some((pattern) => domainMatches(host, pattern, port)) ||
			call.session.allowedDomains.has(host)
		)
			return true;
		const response = await call.session.broker.request(
			{ kind: "network_access", host, port, toolCallId: call.toolCallId },
			{ signal: call.signal, timeoutMs: 600_000, fallback: { decision: "deny" } },
		);
		const decision = "decision" in response ? response.decision : "deny";
		if (decision === "allow_session") call.session.allowedDomains.add(host);
		if (decision === "allow_always") {
			try {
				await this.settings.addAllowedDomain(host);
			} catch (error) {
				log.warn(`Could not save sandbox domain: ${error}`);
				return false;
			}
		}
		return decision === "allow" || decision === "allow_session" || decision === "allow_always";
	}

	operations(call: Invocation, shellPath?: string): BashOperations {
		return {
			exec: async (command, cwd, options) => {
				await this.initialize();
				if (options.signal?.aborted) throw new Error("aborted");
				const commandId = randomUUID();
				const config = runtimeConfig(new SandboxPolicy(cwd, this.settings.argonHome));
				const wrapped = await SandboxManager.wrapWithSandbox(
					command,
					getShellConfig(shellPath).shell,
					config,
					options.signal,
					{ commandId },
				);
				const finish = this.attribution.start({ ...call, signal: options.signal });
				try {
					// The outer shell must not source attacker-controlled startup files before Seatbelt.
					const env = { ...(options.env ?? process.env) };
					delete env.BASH_ENV;
					delete env.ENV;
					const result = await createLocalBashOperations({ shellPath }).exec(wrapped, cwd, { ...options, env });
					if (result.exitCode !== 0) {
						const annotation = SandboxManager.annotateStderrWithSandboxFailures(commandId, "");
						options.onData(
							Buffer.from(
								annotation ||
									"\n[Sandboxed command failed. If this was caused by sandbox restrictions and access outside the sandbox is necessary, retry with dangerouslyDisableSandbox: true to request approval.]\n",
							),
						);
					}
					return result;
				} finally {
					finish();
				}
			},
		};
	}

	async dispose(): Promise<void> {
		if (this.initialization) await SandboxManager.reset();
	}
}

/** Keep settings matching identical to the pinned runtime, including port-scoped domains. */
export function domainMatches(host: string, pattern: string, port = 443): boolean {
	return isValidAllowedDomainEntry(pattern) && matchesDomainPatternWithPort(host, port, pattern);
}

export function validateAllowedDomains(domains: unknown): domains is string[] {
	return (
		Array.isArray(domains) && domains.every((domain) => typeof domain === "string" && isValidAllowedDomainEntry(domain))
	);
}

const sandboxes = new WeakMap<ArgonSettingsStore, ArgonSandbox>();
export function sandboxFor(settings: ArgonSettingsStore): ArgonSandbox {
	let sandbox = sandboxes.get(settings);
	if (!sandbox) {
		sandbox = new ArgonSandbox(settings);
		sandboxes.set(settings, sandbox);
	}
	return sandbox;
}

export function createSandboxExtension(host: {
	mode(): PermissionMode;
	session(): SandboxSession;
	settings: ArgonSettingsStore;
	cwd: string;
	shellPath?: string;
	commandPrefix?: string;
}): InlineExtension {
	return {
		name: "argon-sandbox",
		hidden: true,
		factory(pi) {
			const base = createBashToolDefinition(host.cwd, { shellPath: host.shellPath, commandPrefix: host.commandPrefix });
			const parameters = Type.Object({
				...base.parameters.properties,
				dangerouslyDisableSandbox: Type.Optional(
					Type.Boolean({
						description:
							"Use only after a command failed because of the sandbox and it genuinely needs access outside it; the user will be asked.",
					}),
				),
			});
			pi.registerTool({
				...base,
				parameters,
				async execute(id, input, signal, onUpdate, ctx) {
					if (host.mode() === "auto" || input.dangerouslyDisableSandbox === true)
						return base.execute(id, input, signal, onUpdate, ctx);
					const tool = createBashToolDefinition(host.cwd, {
						shellPath: host.shellPath,
						commandPrefix: host.commandPrefix,
						operations: sandboxFor(host.settings).operations(
							{ session: host.session(), toolCallId: id, signal },
							host.shellPath,
						),
					});
					return tool.execute(id, input, signal, onUpdate, ctx);
				},
			});
		},
	};
}
