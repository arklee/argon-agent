import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthFlows } from "../src/auth-flows.ts";
import { ModelsConfigStore } from "../src/models-config.ts";

let dir: string, path: string, runtime: ModelRuntime, store: ModelsConfigStore;
const changed = vi.fn();
const config = { baseUrl: "https://example.test/v1", api: "openai-completions", models: [{ id: "model" }] };
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "argon-models-"));
	path = join(dir, "agent", "models.json");
	runtime = await ModelRuntime.create({ modelsPath: path, authPath: join(dir, "auth.json"), refreshOnCreate: false });
	changed.mockClear();
	store = new ModelsConfigStore(path, runtime, changed);
});
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await rm(dir, { recursive: true, force: true });
});
it("hashes missing content and rejects invalid edits without changing the file", async () => {
	const empty = await store.get();
	expect(empty).toEqual({ path, text: "", version: createHash("sha256").update("").digest("hex"), error: undefined });
	const text = '{// existing comment\n"providers": {},}';
	const { version } = await store.set(text, empty.version);
	for (const bad of ["{", JSON.stringify({ providers: { x: { models: "nope" } } })]) {
		await expect(store.set(bad, version)).rejects.toMatchObject({ code: "bad_request" });
		expect((await store.get()).text).toBe(text);
	}
	expect(changed).toHaveBeenCalledTimes(1);
	await writeFile(path, "{");
	await expect(store.saveProvider("test", config, true)).rejects.toThrow("JSON editor");
});
it("serializes competing writes with the same version", async () => {
	const { version } = await store.get();
	const first = store.set('{"providers":{}}', version);
	const second = store.set('{"providers": {}}', version);
	await first;
	await expect(second).rejects.toMatchObject({ code: "conflict" });
});
it("creates, lists and removes a custom provider", async () => {
	await store.saveProvider("local", config, true);
	expect((await stat(path)).mode & 0o777).toBe(0o600);
	expect(JSON.parse((await store.get()).text)).toEqual({
		$schema: "https://pi.dev/schemas/models.schema.json",
		providers: { local: config },
	});
	expect(runtime.getModel("local", "model")).toBeDefined();
	const flows = new AuthFlows(runtime, vi.fn(), changed, () => false, store);
	expect(await flows.listProviders()).toContainEqual(
		expect.objectContaining({ id: "local", origin: "custom", config }),
	);
	for (const id of ["local", "openai"])
		await expect(store.saveProvider(id, config, true)).rejects.toMatchObject({ code: "conflict" });
	await store.removeProvider("local");
	expect(runtime.getProvider("local")).toBeUndefined();
	await expect(store.removeProvider("local")).rejects.toMatchObject({ code: "not_found" });
});
it("preserves unmanaged fields and limits built-in changes to endpoint and headers", async () => {
	const cost = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
	const compat = { supportsStore: false };
	const local = { ...config, compat, name: "Old", models: [{ id: "model", reasoning: true, cost }] };
	const openai = { name: "Original", headers: { old: "value" } };
	await store.set(JSON.stringify({ providers: { local, openai } }), (await store.get()).version);
	await store.saveProvider("local", config, false);
	await store.saveProvider("openai", config, false);
	expect(JSON.parse((await store.get()).text).providers).toEqual({
		local: { ...config, compat, models: [{ id: "model", cost }] },
		openai: { name: "Original", baseUrl: config.baseUrl },
	});
	const flows = new AuthFlows(runtime, vi.fn(), changed, () => false, store);
	const providers = await flows.listProviders();
	expect(providers.find((p) => p.id === "local")?.config).toEqual(config);
	expect(providers.find((p) => p.id === "openai")).toMatchObject({
		origin: "builtin",
		config: { name: "Original", baseUrl: config.baseUrl },
	});
});
it("discovers unique sorted models with env headers and saved credentials", async () => {
	vi.stubEnv("DISCOVERY_KEY", "secret");
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ data: [{ id: "b" }, { id: "a", name: "Alpha" }, { id: "a" }] }))
		.mockResolvedValueOnce(Response.json(["saved"]));
	vi.stubGlobal("fetch", fetcher);
	await expect(
		store.discoverModels({
			...config,
			baseUrl: `${config.baseUrl}/`,
			apiKey: "$DISCOVERY_KEY",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves this variable on the backend.
			headers: { X: "${DISCOVERY_KEY}" },
		}),
	).resolves.toEqual({ models: [{ id: "a", name: "Alpha" }, { id: "b" }] });
	expect(fetcher.mock.calls[0]?.[0]).toBe(`${config.baseUrl}/models`);
	const headers = fetcher.mock.calls[0]?.[1].headers;
	expect(headers.get("authorization")).toBe("Bearer secret");
	expect(headers.get("x")).toBe("secret");
	vi.spyOn(runtime, "getAuth").mockResolvedValue({ auth: { apiKey: "stored", headers: { X: "saved" } } });
	await store.discoverModels({ ...config, providerId: "local" });
	expect(fetcher.mock.calls[1]?.[1].headers.get("authorization")).toBe("Bearer stored");
	await expect(store.discoverModels({ ...config, apiKey: "!cmd" })).rejects.toThrow("save the provider first");
	await expect(store.discoverModels({ ...config, api: "unknown" })).rejects.toMatchObject({ code: "bad_request" });
	fetcher.mockResolvedValueOnce(new Response("x".repeat(500), { status: 403 }));
	await expect(store.discoverModels(config)).rejects.toThrow(/HTTP 403: x{300}$/);
});
