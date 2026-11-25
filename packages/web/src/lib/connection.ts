/**
 * Where the backend is and how to authenticate. The dev script opens
 * `http://localhost:5173/#token=...` (optionally `&backend=ws://host:port`). We move the values
 * into sessionStorage and strip them from the address bar.
 */

const TOKEN_KEY = "argon.token";
const URL_KEY = "argon.backendUrl";

export const DEFAULT_BACKEND_URL =
	(import.meta.env.VITE_ARGON_BACKEND_URL as string | undefined) ?? "ws://127.0.0.1:7878";

export interface ConnectionConfig {
	url: string;
	token: string;
}

export function readConnectionConfig(): ConnectionConfig | undefined {
	const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
	const hashToken = hash.get("token");
	if (hashToken) {
		saveConnectionConfig({ token: hashToken, url: hash.get("backend") ?? DEFAULT_BACKEND_URL });
		history.replaceState(null, "", window.location.pathname + window.location.search);
	}
	const token = sessionStorage.getItem(TOKEN_KEY);
	if (!token) return undefined;
	return { token, url: sessionStorage.getItem(URL_KEY) ?? DEFAULT_BACKEND_URL };
}

export function saveConnectionConfig(config: ConnectionConfig): void {
	sessionStorage.setItem(TOKEN_KEY, config.token);
	sessionStorage.setItem(URL_KEY, config.url);
}

export function clearConnectionConfig(): void {
	sessionStorage.removeItem(TOKEN_KEY);
	sessionStorage.removeItem(URL_KEY);
}
