import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CustomProviderConfig, Methods } from "@argon/shared";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { RequestError } from "./request-error.ts";

const builtinIds = new Set(builtinProviders().map((p) => p.id));
export const isBuiltinProvider = (id: string) => builtinIds.has(id);
const providerFields = ["name", "baseUrl", "api", "apiKey", "headers", "authHeader"] as const;
const modelFields = ["id", "name", "reasoning", "input", "contextWindow", "maxTokens"] as const;
type Entry = Record<string, unknown>;
function object(value: unknown): value is Entry {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function parse(text: string) {
	// Match pi's BOM, line comment and trailing comma handling without changing quoted strings.
	const value: unknown = JSON.parse(
		text
			.replace(/^\uFEFF/, "")
			.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ""))
			.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? m),
	);
	if (!object(value) || !object(value.providers)) throw new Error("Expected a providers object");
	return { ...value, providers: { ...value.providers } };
}
export function configVersion(text: string) {
	return createHash("sha256").update(text).digest("hex");
}
function merge(existing: Entry, config: object, keys: readonly string[]) {
	const result = { ...existing };
	for (const key of keys) {
		const value = Object.hasOwn(config, key) ? Reflect.get(config, key) : undefined;
		if (value === undefined || value === "" || (object(value) && !Object.keys(value).length)) delete result[key];
		else result[key] = value;
	}
	return result;
}
function env(value: string) {
	const match = /^\$(?:([A-Za-z_][\w]*)|\{([A-Za-z_][\w]*)\})$/.exec(value);
	if (!match) return value;
	const key = match[1] ?? match[2] ?? "";
	if (process.env[key] === undefined) throw new RequestError("bad_request", `Missing environment variable ${key}`);
	return process.env[key];
}
export class ModelsConfigStore {
	private pending: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly path: string,
		private readonly runtime: ModelRuntime,
		private readonly changed: () => void,
	) {}
	private async read() {
		try {
			return await readFile(this.path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}
	async get() {
		const text = (await this.read()) ?? "";
		return { path: this.path, text, version: configVersion(text), error: this.runtime.getError() };
	}
	async providerConfigs() {
		const configs = new Map<string, CustomProviderConfig>();
		const text = await this.read();
		if (!text) return configs;
		try {
			for (const [id, entry] of Object.entries(parse(text).providers)) {
				if (!object(entry)) continue;
				const config: Entry = Object.fromEntries(
					providerFields.filter((key) => Object.hasOwn(entry, key)).map((key) => [key, entry[key]]),
				);
				if (Array.isArray(entry.models))
					config.models = entry.models.filter(object).map((m) => merge({}, m, modelFields));
				configs.set(id, config as CustomProviderConfig);
			}
		} catch {
			/* Malformed files remain accessible in the JSON editor. */
		}
		return configs;
	}
	private write(build: (current: string | undefined) => string) {
		const operation = this.pending.then(async () => {
			const current = await this.read();
			const text = build(current);
			const parent = dirname(this.path);
			await mkdir(parent, { recursive: true });
			// Private sibling directory keeps validation isolated and rename on the same filesystem.
			const dir = await mkdtemp(join(parent, ".models-"));
			try {
				const candidate = join(dir, "models.json");
				await writeFile(candidate, text, { mode: 0o600 });
				const validation = await ModelRuntime.create({
					modelsPath: candidate,
					authPath: join(dir, "auth.json"),
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
				const error = validation.getError();
				if (error) throw new RequestError("bad_request", error.replaceAll(candidate, this.path));
				if ((await this.read()) !== current)
					throw new RequestError("conflict", "models.json changed during validation");
				await rename(candidate, this.path);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
			await this.runtime.refresh();
			this.changed();
			return { version: configVersion(text) };
		});
		this.pending = operation.catch(() => {});
		return operation;
	}
	set(text: string, version: string) {
		return this.write((current) => {
			if (configVersion(current ?? "") !== version)
				throw new RequestError("conflict", "models.json changed since it was read");
			if (typeof text !== "string") throw new RequestError("bad_request", "Expected models.json text");
			return text;
		});
	}
	private edit(change: (providers: Entry) => void) {
		return this.write((current) => {
			let doc: Entry & { providers: Entry };
			try {
				doc =
					current === undefined
						? { $schema: "https://pi.dev/schemas/models.schema.json", providers: {} }
						: parse(current);
			} catch {
				throw new RequestError("bad_request", "Fix models.json in the JSON editor first");
			}
			change(doc.providers);
			// Structured edits reserialize the document, discarding comments.
			return `${JSON.stringify(doc, null, 2)}\n`;
		});
	}
	saveProvider(id: string, config: CustomProviderConfig, create: boolean) {
		return this.edit((providers) => {
			if (typeof id !== "string" || id !== id.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
				throw new RequestError("bad_request", "Invalid provider ID");
			if (create && (Object.hasOwn(providers, id) || this.runtime.getProvider(id)))
				throw new RequestError("conflict", `Provider already exists: ${id}`);
			const old = Object.hasOwn(providers, id) ? providers[id] : undefined;
			const entry = object(old) ? old : {};
			if (!config || typeof config !== "object" || Array.isArray(config))
				throw new RequestError("bad_request", "Expected provider configuration");
			if (isBuiltinProvider(id)) {
				providers[id] = merge(entry, config, ["baseUrl", "headers"]);
				return;
			}
			if (
				typeof config.baseUrl !== "string" ||
				!config.baseUrl.trim() ||
				typeof config.api !== "string" ||
				!config.api.trim()
			)
				throw new RequestError("bad_request", "Custom providers require baseUrl and api");
			const next = merge(entry, config, providerFields);
			const previous = new Map((Array.isArray(entry.models) ? entry.models : []).filter(object).map((m) => [m.id, m]));
			if (
				config.models !== undefined &&
				(!Array.isArray(config.models) || config.models.some((model) => !object(model)))
			)
				throw new RequestError("bad_request", "Expected an array of model objects");
			if (config.models?.length)
				next.models = config.models.map((m) => merge(previous.get(m.id) ?? {}, m, modelFields));
			else delete next.models;
			providers[id] = next;
		});
	}
	removeProvider(id: string) {
		return this.edit((providers) => {
			if (!Object.hasOwn(providers, id)) throw new RequestError("not_found", `No models.json entry for ${id}`);
			delete providers[id];
		});
	}
	async discoverModels({ baseUrl, api, apiKey, headers, providerId }: Methods["providers.discoverModels"]["params"]) {
		if (api !== "openai-completions" && api !== "openai-responses")
			throw new RequestError("bad_request", "Model discovery requires an OpenAI-compatible API");
		if (apiKey?.startsWith("!") && !providerId)
			throw new RequestError("bad_request", "save the provider first to use a command key");
		const saved =
			providerId && (!apiKey || apiKey.startsWith("!")) ? (await this.runtime.getAuth(providerId))?.auth : undefined;
		const key = apiKey && !apiKey.startsWith("!") ? env(apiKey) : saved?.apiKey;
		const requestHeaders = new Headers();
		if (key) requestHeaders.set("Authorization", `Bearer ${key}`);
		for (const [k, v] of Object.entries(saved?.headers ?? {})) if (v !== null) requestHeaders.set(k, v);
		for (const [k, v] of Object.entries(headers ?? {})) requestHeaders.set(k, env(v));
		const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
			headers: requestHeaders,
			signal: AbortSignal.timeout(15000),
		}).catch((error: unknown) => {
			// Network errors name the host and cause (ECONNREFUSED, timeout), never the request headers.
			const cause = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : "";
			throw new RequestError("bad_request", `Could not reach ${baseUrl}${cause ? `: ${cause}` : ""}`);
		});
		if (!response.ok)
			throw new RequestError(
				"bad_request",
				`Model discovery returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
			);
		const body = await response.json();
		const list = Array.isArray(body) ? body : object(body) ? (body.data ?? body.models) : undefined;
		if (!Array.isArray(list)) throw new RequestError("bad_request", "Expected a list of models");
		const models = new Map<string, { id: string; name?: string }>();
		for (const item of list) {
			const id = typeof item === "string" ? item : item?.id;
			if (typeof id === "string" && id && !models.has(id))
				models.set(id, { id, name: typeof item?.name === "string" ? item.name : undefined });
		}
		return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
	}
}
