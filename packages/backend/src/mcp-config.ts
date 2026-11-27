import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpConfigFile, McpConfigServer, McpConfigTarget, MethodParams } from "@argon/shared";
import type { createMcpExtension } from "@earendil-works/pi-coding-agent";
import { configVersion } from "./models-config.ts";
import { canonicalProjectPath } from "./project-trust.ts";
import { RequestError } from "./request-error.ts";

type Options = NonNullable<Parameters<typeof createMcpExtension>[0]>;
type Loaded = ReturnType<NonNullable<Options["loadConfig"]>>;
type Config = Loaded["servers"][number]["config"];
type Entry = Record<string, unknown>;
interface Helpers {
	loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): Loaded;
	validateMcpServerConfig(name: string, value: unknown): Config | string;
	addMcpServerConfig(path: string, name: string, value: Entry): boolean;
	removeMcpServerConfig(path: string, name: string): boolean;
	updateMcpServerConfig(
		path: string,
		name: string,
		patch: Parameters<NonNullable<Options["updateConfig"]>>[1],
		options?: { override: boolean },
	): void;
	configDir: string;
}
async function loadHelpers(): Promise<Helpers> {
	const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
	const module = (path: string) => import(new URL(path, entry).href);
	const [config, core, constants] = await Promise.all([
		module("./extensions/mcp/config.js"),
		module("./core/mcp-servers.js"),
		module("./config.js"),
	]);
	for (const [object, key] of [
		[config, "loadMcpConfig"],
		[config, "addMcpServerConfig"],
		[config, "removeMcpServerConfig"],
		[config, "updateMcpServerConfig"],
		[core, "validateMcpServerConfig"],
	] as const)
		if (typeof object[key] !== "function") throw new Error(`Missing ${key}`);
	return { ...config, validateMcpServerConfig: core.validateMcpServerConfig, configDir: constants.CONFIG_DIR_NAME };
}
const helpers = await loadHelpers().catch(
	(error: unknown) => new Error(`Could not load pi MCP config helpers: ${error}`),
);
export function piMcp() {
	if (helpers instanceof Error) throw helpers;
	return helpers;
}
function record(value: unknown): value is Entry {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function bad(message: string): never {
	throw new RequestError("bad_request", message);
}
function servers(text: string): Entry {
	let doc: unknown;
	try {
		doc = JSON.parse(text.replace(/^\uFEFF/, ""));
	} catch (error) {
		bad(String(error));
	}
	if (!record(doc) || (doc.mcpServers !== undefined && !record(doc.mcpServers)))
		bad("Expected an object with an mcpServers object");
	return doc.mcpServers ?? {};
}
function read(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
function summary(name: string, value: unknown, project: boolean): McpConfigServer {
	const entry = record(value) ? value : {};
	const config = piMcp().validateMcpServerConfig(name, value);
	const server: McpConfigServer = { name, enabled: entry.enabled !== false };
	if (project && record(value) && !["command", "url", "type"].some((k) => Object.hasOwn(entry, k)))
		server.override = true;
	if (record(entry.auth) && typeof entry.auth.provider === "string") server.authProvider = entry.auth.provider;
	const exposure = typeof config === "string" ? entry.exposure : config.exposure;
	if (exposure === "codemode" || exposure === "deferred" || exposure === "direct" || exposure === "hidden")
		server.exposure = exposure;
	if (typeof config !== "string" && !("url" in entry && "command" in entry)) {
		if ("url" in config) {
			const { url, headers } = config;
			server.form = { transport: "http", url, headers };
		} else {
			const { command, args, env, cwd } = config;
			server.form = { transport: "stdio", command, args, env, cwd };
		}
	}
	return server;
}
export class McpConfigStore {
	constructor(
		private agentDir: string,
		private trusted: (cwd: string) => boolean,
		private changed: (target: McpConfigTarget, reload: boolean) => Promise<void>,
	) {}
	private path(target: McpConfigTarget) {
		piMcp();
		if (target.scope === "global") return join(this.agentDir, "mcp.json");
		if (target.scope !== "project" || !target.cwd?.trim()) bad("Project scope requires cwd");
		return join(canonicalProjectPath(target.cwd), ".argon", "mcp.json");
	}
	private file(target: McpConfigTarget): McpConfigFile {
		const path = this.path(target);
		const result: McpConfigFile = { scope: target.scope, path, exists: existsSync(path), servers: [] };
		if (target.scope === "project") result.trusted = this.trusted(target.cwd);
		try {
			const text = read(path);
			if (text !== undefined)
				result.servers = Object.entries(servers(text)).map(([name, value]) =>
					summary(name, value, target.scope === "project"),
				);
		} catch (error) {
			result.error = String(error);
		}
		return result;
	}
	get(cwd?: string) {
		return { global: this.file({ scope: "global" }), project: cwd ? this.file({ scope: "project", cwd }) : undefined };
	}
	getText(target: McpConfigTarget) {
		const path = this.path(target);
		const text = read(path) ?? "";
		return { path, text, version: configVersion(text) };
	}

	// pi edits synchronously. Stage the whole read/modify/validate/rename without yielding, so
	// concurrent commands and session exposure edits cannot interleave or see half of a rename.
	private async edit(
		target: McpConfigTarget,
		reload: boolean,
		change: (candidate: string, current: string | undefined) => void,
	) {
		const path = this.path(target);
		const current = read(path);
		const parent = dirname(path);
		mkdirSync(parent, { recursive: true });
		const dir = mkdtempSync(join(parent, ".mcp-"));
		let text: string;
		try {
			const project = target.scope === "project";
			const candidate = join(project ? join(dir, piMcp().configDir) : dir, "mcp.json");
			mkdirSync(dirname(candidate), { recursive: true });
			writeFileSync(candidate, current ?? "{}", { mode: current === undefined ? 0o600 : statSync(path).mode & 0o777 });
			change(candidate, current);
			text = readFileSync(candidate, "utf8");
			const loaded = piMcp().loadMcpConfig({
				agentDir: project ? this.agentDir : dir,
				cwd: dir,
				projectTrusted: project,
			});
			const errors = loaded.errors.filter((error) => error.startsWith(`${candidate}:`));
			if (project)
				for (const [name, value] of Object.entries(servers(text)))
					if (record(value) && Object.hasOwn(value, "auth"))
						errors.push(`${name}: auth is only allowed in global mcp.json`);
			if (errors.length) bad(errors.join("\n").replaceAll(candidate, path));
			if (read(path) !== current) throw new RequestError("conflict", "mcp.json changed since it was read");
			renameSync(candidate, path);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		await this.changed(target, reload);
		return { version: configVersion(text) };
	}
	setText(params: MethodParams<"mcp.config.setText">) {
		return this.edit(params, true, (path, current) => {
			if (configVersion(current ?? "") !== params.version)
				throw new RequestError("conflict", "mcp.json changed since it was read");
			servers(params.text);
			writeFileSync(path, params.text, { mode: 0o600 });
		});
	}
	saveServer(params: MethodParams<"mcp.config.saveServer">) {
		return this.edit(params, true, (path, current) => {
			const { name, previousName = name, form, create } = params;
			const entries = servers(current ?? "{}");
			if (typeof name !== "string") bad("Invalid server name");
			if ((create || previousName !== name) && Object.hasOwn(entries, name))
				throw new RequestError("conflict", `Server already exists: ${name}`);
			if (!create && !Object.hasOwn(entries, previousName))
				throw new RequestError("not_found", `Unknown server: ${previousName}`);
			if (!form || !(form.transport === "http" || form.transport === "stdio")) bad("Expected an HTTP or stdio form");
			if (params.scope === "project" && "auth" in form) bad("auth is only allowed in global mcp.json");
			const old = create ? undefined : entries[previousName];
			const entry = record(old) ? { ...old } : {};
			const switching = form.transport === "http" ? Object.hasOwn(entry, "command") : Object.hasOwn(entry, "url");
			if (switching) {
				delete entry.type;
				if (form.transport === "stdio") {
					delete entry.oauth;
					delete entry.auth;
				}
			}
			for (const key of ["command", "args", "env", "cwd", "headers", "url"]) delete entry[key];
			const keys = form.transport === "stdio" ? ["command", "args", "env", "cwd"] : ["url", "headers"];
			for (const key of keys) if (Object.hasOwn(form, key)) entry[key] = Reflect.get(form, key);
			const valid = piMcp().validateMcpServerConfig(name, entry);
			if (typeof valid === "string") bad(valid);
			if (!create && name !== previousName) piMcp().removeMcpServerConfig(path, previousName);
			piMcp().addMcpServerConfig(path, name, entry);
			if (!Object.hasOwn(servers(readFileSync(path, "utf8")), name))
				bad(`pi could not save "${name}" with the form editor. Use the JSON editor for this name.`);
		});
	}
	async importServers(params: MethodParams<"mcp.config.importServers">) {
		if (!record(params.servers) || Object.keys(params.servers).length === 0) bad("Expected servers to import");
		const added: string[] = [];
		const replaced: string[] = [];
		await this.edit(params, true, (path, current) => {
			const existing = servers(current ?? "{}");
			const taken = Object.keys(params.servers).filter((name) => Object.hasOwn(existing, name));
			if (taken.length > 0 && !params.replace)
				throw new RequestError("conflict", `Already in ${path}: ${taken.join(", ")}`);
			const errors: string[] = [];
			for (const [name, value] of Object.entries(params.servers)) {
				const valid = piMcp().validateMcpServerConfig(name, value);
				if (typeof valid === "string") errors.push(valid);
				else if (params.scope === "project" && record(value) && Object.hasOwn(value, "auth"))
					errors.push(`${name}: auth is only allowed in global mcp.json`);
			}
			if (errors.length > 0) bad(errors.join("\n"));
			for (const [name, value] of Object.entries(params.servers)) {
				if (piMcp().addMcpServerConfig(path, name, value as Record<string, unknown>)) replaced.push(name);
				else added.push(name);
			}
		});
		return { added, replaced };
	}
	removeServer(params: MethodParams<"mcp.config.removeServer">) {
		return this.edit(params, true, (path, current) => {
			if (!Object.hasOwn(servers(current ?? "{}"), params.name))
				throw new RequestError("not_found", `Unknown server: ${params.name}`);
			piMcp().removeMcpServerConfig(path, params.name);
		});
	}
	setEnabled({ name, enabled }: MethodParams<"mcp.config.setEnabled">) {
		return this.edit({ scope: "global" }, false, (path, current) => {
			if (typeof enabled !== "boolean") bad("Expected boolean enabled");
			if (!Object.hasOwn(servers(current ?? "{}"), name))
				throw new RequestError("not_found", `Unknown server: ${name}`);
			piMcp().updateMcpServerConfig(path, name, { enabled });
		});
	}
}
