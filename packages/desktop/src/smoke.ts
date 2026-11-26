import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketAgentClient } from "@argon/shared";
import { type BrowserWindow, ClipboardItem, clipboard, nativeTheme } from "electron";

/** Runs inside the packaged main process; uses the same public protocol as the renderer. */
export async function smoke(
	url: string,
	token: string,
	getWindow: () => BrowserWindow | undefined,
	focusWindow: () => void,
): Promise<void> {
	const client = new WebSocketAgentClient({ url, token, clientName: "desktop-smoke" });
	try {
		const deadline = Date.now() + 30_000;
		while (client.connection.status !== "connected") {
			assert(Date.now() < deadline, "Backend connection timed out");
			await delay(100);
		}
		const environment = await client.request("environment.info", {});
		assert(environment.piVersion, "pi SDK loaded");
		const snapshot = await client.request("sessions.create", { cwd: process.env.ARGON_DESKTOP_SMOKE! });
		assert(snapshot.state.sessionId);
		const { commands } = await client.request("sessions.commands", { sessionId: snapshot.state.sessionId });
		assert(
			commands.some((command) => command.name === "desktop-probe"),
			"User TS extension loaded",
		);
		assert(!snapshot.state.diagnostics?.some((entry) => entry.message.includes("probe.ts")), "Extension probe passed");
		while (!getWindow() || getWindow()!.webContents.isLoading()) await delay(100);
		const text = await getWindow()!.webContents.executeJavaScript("document.body.innerText");
		assert(text.length > 20, "Renderer mounted");
		const isolated = await getWindow()!.webContents.executeJavaScript(
			"typeof process === 'undefined' && typeof require === 'undefined'",
		);
		assert(isolated, "Renderer has no Node access");
		focusWindow();
		await delay(200);
		const clipboardItems = await Promise.all(
			(await clipboard.read()).map(async (item) => {
				const entries = await Promise.all(item.types.map(async (type) => [type, await item.getType(type)] as const));
				return new ClipboardItem(Object.fromEntries(entries));
			}),
		);
		try {
			await getWindow()!.webContents.executeJavaScript(
				"navigator.clipboard.writeText('Argon copy smoke: 中文\\nsecond line').catch(e => { throw new Error(e.name + ': ' + e.message); })",
				true,
			);
			await delay(100);
			assert.equal(await clipboard.readText(), "Argon copy smoke: 中文\nsecond line", "Renderer can copy text");
			const readDenied = await getWindow()!.webContents.executeJavaScript(
				"navigator.clipboard.readText().then(() => false, () => true)",
				true,
			);
			assert(readDenied, "Renderer cannot read clipboard");
		} finally {
			if (clipboardItems.length) await clipboard.write(clipboardItems);
			else clipboard.clear();
		}
		console.error("DESKTOP_CLIPBOARD_OK: text copy succeeds, clipboard read denied");
		await getWindow()!.webContents.executeJavaScript("window.argonDesktop.setTheme('dark')");
		await delay(100);
		assert.equal(nativeTheme.themeSource, "dark", "Renderer theme reaches native chrome");
		await getWindow()!.webContents.executeJavaScript("window.argonDesktop.setTheme('system')");
		if (process.platform === "darwin" || process.platform === "win32") {
			const window = getWindow()!;
			focusWindow();
			assert(window.isVisible(), "Window shown before close");
			await window.webContents.executeJavaScript("globalThis.__argonTrayProbe = true");
			window.close();
			await delay(200);
			assert(!window.isDestroyed(), "Close keeps the window alive");
			assert(!window.isVisible(), "Close hides the window");
			assert((await client.request("environment.info", {})).piVersion, "Backend survives hidden window");
			focusWindow();
			assert.equal(getWindow(), window, "Focus reuses the window");
			assert(window.isVisible(), "Focus shows the hidden window");
			assert(await window.webContents.executeJavaScript("globalThis.__argonTrayProbe"), "Renderer was not reloaded");
			console.error("DESKTOP_TRAY_OK: close hides, backend responds, focus restores without reload");
		}
		if (process.env.ARGON_DESKTOP_SCREENSHOT) {
			await delay(500);
			await writeFile(process.env.ARGON_DESKTOP_SCREENSHOT, (await getWindow()!.webContents.capturePage()).toPNG());
		}
		if (process.env.ARGON_SMOKE_MODEL)
			await modelSmoke(client, snapshot.state.sessionId, process.env.ARGON_SMOKE_MODEL);
		console.error("DESKTOP_SMOKE_OK: packaged renderer, WebSocket, pi session and extensions");
	} finally {
		client.close();
	}
}

async function modelSmoke(client: WebSocketAgentClient, sessionId: string, ref: string): Promise<void> {
	const slash = ref.indexOf("/");
	assert(slash > 0, "ARGON_SMOKE_MODEL must be provider/id");
	await client.request("sessions.setModel", {
		sessionId,
		model: { provider: ref.slice(0, slash), id: ref.slice(slash + 1) },
	});
	await client.request("sessions.setToolPreset", { sessionId, preset: "classic" });
	const finished = Promise.withResolvers<void>();
	const environment = await client.request("environment.info", {});
	await client.request("sessions.setPermissionMode", {
		sessionId,
		mode: environment.sandbox.supported ? "ask" : "auto",
	});
	let reply = "";
	const unsubscribe = client.onSessionEvent(({ sessionId: id, event }) => {
		if (id !== sessionId) return;
		if (event.type === "run_settled") event.aborted ? finished.reject(new Error("Aborted")) : finished.resolve();
		if (event.type === "interaction_requested") {
			finished.reject(new Error("Workspace bash must run without approval"));
			void client
				.request("interactions.respond", {
					sessionId,
					interactionId: event.interaction.id,
					response: { cancelled: true },
				})
				.catch(finished.reject);
		}
	});
	const timeout = setTimeout(() => finished.reject(new Error("Model smoke timed out")), 120_000);
	try {
		await Promise.all([
			finished.promise,
			client.request("sessions.prompt", {
				sessionId,
				clientMessageId: "desktop-model-smoke",
				text: "Run exactly this bash command: echo desktop-ok > desktop-smoke.txt . Then reply DESKTOP-MODEL-OK.",
			}),
		]);
		assert.equal(
			await readFile(join(process.env.ARGON_DESKTOP_SMOKE!, "desktop-smoke.txt"), "utf8"),
			"desktop-ok\n",
			"Workspace bash completed",
		);
		const result = await client.request("sessions.attach", { sessionId });
		assert("snapshot" in result);
		for (const item of result.snapshot.state.items) {
			if (item.kind === "assistant")
				reply += item.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
		}
		assert(reply.includes("DESKTOP-MODEL-OK"), "Model replied");
		console.error("DESKTOP_MODEL_OK: real model and workspace bash");
	} finally {
		clearTimeout(timeout);
		unsubscribe();
	}
}
