import { randomBytes } from "node:crypto";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme, net, protocol, session, shell, utilityProcess } from "electron";

const directory = fileURLToPath(new URL(".", import.meta.url));
const origin = "argon://app";
const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const token = randomBytes(32).toString("base64url");
let child: Electron.UtilityProcess | undefined;
let window: BrowserWindow | undefined;
let quitting = false;
let stopped = false;
let backendUrl: string | undefined;
let restarts = 0;
const integratedChrome = process.platform === "darwin" || process.platform === "win32";
const overlayColors = () => ({
	color: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
	symbolColor: nativeTheme.shouldUseDarkColors ? "#eeeeee" : "#202020",
	height: 48,
});
nativeTheme.on("updated", () => {
	if (process.platform === "win32" && window && !window.isDestroyed()) window.setTitleBarOverlay(overlayColors());
});

protocol.registerSchemesAsPrivileged([
	{ scheme: "argon", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function external(url: string): void {
	if (["https:", "http:"].includes(new URL(url).protocol)) void shell.openExternal(url);
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
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
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
				.then(({ smoke }) => smoke(backendUrl!, token, () => window))
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
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
	if (!quitting) void loadWindow();
});

void app
	.whenReady()
	.then(() => {
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
