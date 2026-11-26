import { randomBytes } from "node:crypto";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	net,
	protocol,
	session,
	shell,
	Tray,
	utilityProcess,
} from "electron";

import { en } from "../../web/src/i18n/locales/en.ts";
import { zhCN } from "../../web/src/i18n/locales/zh-CN.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const origin = "argon://app";
const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const token = randomBytes(32).toString("base64url");
let child: Electron.UtilityProcess | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitRequested = false;
let quitting = false;
let stopped = false;
let backendUrl: string | undefined;
let restarts = 0;
// Electron keys the lock on userData; the smoke run uses its own so it can run beside a real instance.
if (process.env.ARGON_DESKTOP_SMOKE) app.setPath("userData", resolve(process.env.ARGON_DESKTOP_SMOKE, "electron"));
// A second instance would start a second backend on the same ARGON_HOME (concurrent package installs, auth writes).
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", () => focusWindow());
const integratedChrome = process.platform === "darwin" || process.platform === "win32";
const overlayColors = () => ({
	color: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
	symbolColor: nativeTheme.shouldUseDarkColors ? "#eeeeee" : "#202020",
	height: 48,
});
nativeTheme.on("updated", () => {
	if (process.platform === "win32" && window && !window.isDestroyed()) window.setTitleBarOverlay(overlayColors());
});
// The web theme setting drives native chrome (Windows title bar overlay, macOS menus); only our own page may set it.
ipcMain.on("argon:set-theme", (event, theme: unknown) => {
	if (!window || window.isDestroyed() || event.senderFrame !== window.webContents.mainFrame) return;
	if (theme === "system" || theme === "light" || theme === "dark") nativeTheme.themeSource = theme;
});

protocol.registerSchemesAsPrivileged([
	{ scheme: "argon", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function external(url: string): void {
	if (["https:", "http:"].includes(new URL(url).protocol)) void shell.openExternal(url);
}

/** Brings back the existing window; only creates and loads one when there is none (reloading would drop page state). */
function focusWindow(): void {
	if (!window || window.isDestroyed()) {
		if (!quitRequested) void loadWindow().catch((error) => console.error(error));
		return;
	}
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}

async function loadWindow(): Promise<void> {
	if (!backendUrl) return;
	if (!window || window.isDestroyed()) {
		window = new BrowserWindow({
			...(integratedChrome ? { titleBarStyle: "hidden" as const } : {}),
			...(process.platform === "darwin" ? { trafficLightPosition: { x: 12, y: 17 } } : {}),
			...(process.platform === "win32" ? { titleBarOverlay: overlayColors(), autoHideMenuBar: true } : {}),
			width: 1200,
			height: 820,
			minWidth: 760,
			minHeight: 540,
			show: !process.env.ARGON_DESKTOP_SMOKE,
			webPreferences: {
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				preload: resolve(directory, "../preload/index.cjs"),
			},
		});
		window.on("close", (event) => {
			if (integratedChrome && !quitRequested) {
				event.preventDefault();
				window?.hide();
			}
		});
		// Windows logoff/shutdown skips before-quit; without this the close handler above would block it.
		window.on("session-end", () => {
			quitRequested = true;
			app.quit();
		});
		window.webContents.setWindowOpenHandler(({ url }) => {
			external(url);
			return { action: "deny" };
		});
		window.webContents.on("will-navigate", (event, url) => {
			const target = new URL(url);
			const local = new URL(rendererUrl ?? origin);
			if (target.protocol !== local.protocol || target.host !== local.host) {
				event.preventDefault();
				external(url);
			}
		});
	}
	const url = new URL(rendererUrl ?? `${origin}/index.html`);
	if (integratedChrome) url.searchParams.set("windowChrome", process.platform);
	url.hash = new URLSearchParams({ token, backend: backendUrl }).toString();
	await window.loadURL(url.toString());
}

function startBackend(): void {
	const worker = utilityProcess.fork(
		app.isPackaged ? resolve(`${app.getAppPath()}.unpacked`, "out/main/backend.js") : resolve(directory, "backend.js"),
		[],
		{
			cwd: app.getPath("home"),
			env: {
				...process.env,
				ARGON_HOST: "127.0.0.1",
				ARGON_PORT: backendUrl ? new URL(backendUrl).port : "0",
				ARGON_TOKEN: token,
				ARGON_ALLOWED_ORIGINS: rendererUrl ? new URL(rendererUrl).origin : origin,
			},
			stdio: "pipe",
		},
	);
	child = worker;
	worker.stdout?.on("data", (data) => process.stderr.write(data));
	worker.stderr?.on("data", (data) => process.stderr.write(data));
	const startup = setTimeout(() => worker.kill(), 60_000);
	worker.on("message", (message) => {
		if (message?.type !== "ready") return;
		clearTimeout(startup);
		backendUrl = message.url;
		console.error(`Desktop backend ready (Node ${message.node})`);
		if (!window)
			void loadWindow().catch((error) => {
				console.error(error);
				app.quit();
			});
		// Existing clients reconnect to the same address and recover via SessionMirror.
		if (process.env.ARGON_DESKTOP_SMOKE) {
			void import("./smoke.ts")
				.then(({ smoke }) => smoke(backendUrl!, token, () => window, focusWindow))
				.then(
					() => app.quit(),
					(error) => {
						console.error(error);
						process.exitCode = 1;
						app.quit();
					},
				);
		}
	});
	worker.on("exit", (code) => {
		clearTimeout(startup);
		if (child === worker) child = undefined;
		if (quitting) {
			stopped = true;
			app.quit();
			return;
		}
		console.error(`Desktop backend exited (${code})`);
		if (++restarts <= 3) setTimeout(startBackend, 1000);
		else {
			process.exitCode = 1;
			app.quit();
		}
	});
}

app.on("before-quit", (event) => {
	quitRequested = true;
	if (stopped || !child) return;
	event.preventDefault();
	if (quitting) return;
	quitting = true;
	child.postMessage("shutdown");
	setTimeout(() => {
		child?.kill();
		stopped = true;
		app.quit();
	}, 10_000).unref();
});
app.on("quit", () => child?.kill());
app.on("window-all-closed", () => {
	if (!integratedChrome) app.quit();
});
app.on("activate", () => focusWindow());

void app
	.whenReady()
	.then(() => {
		if (!primary) return;
		if (integratedChrome) {
			const resources = resolve(app.isPackaged ? app.getAppPath() : resolve(directory, "../.."), "resources");
			const icon = nativeImage.createFromPath(
				resolve(resources, process.platform === "darwin" ? "trayTemplate.png" : "tray.png"),
			);
			if (process.platform === "darwin") icon.setTemplateImage(true);
			tray = new Tray(icon);
			tray.setToolTip("Argon");
			const labels = (app.getLocale().startsWith("zh") ? zhCN : en).desktop.tray;
			tray.setContextMenu(
				Menu.buildFromTemplate([
					{ label: labels.show, click: focusWindow },
					{ type: "separator" },
					{ label: labels.quit, click: () => app.quit() },
				]),
			);
			if (process.platform === "win32") {
				tray.on("click", () => {
					if (window && !window.isDestroyed() && window.isVisible() && window.isFocused()) window.hide();
					else focusWindow();
				});
			}
		}
		session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		const rendererRoot = resolve(directory, "../renderer");
		protocol.handle("argon", (request) => {
			const url = new URL(request.url);
			const path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
			if (url.hostname !== "app" || !path.startsWith(`${rendererRoot}${sep}`))
				return new Response(null, { status: 403 });
			return net.fetch(pathToFileURL(path).toString());
		});
		startBackend();
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
