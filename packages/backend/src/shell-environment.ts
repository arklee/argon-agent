import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { isAbsolute } from "node:path";

/** Desktop launchers lack terminal initialization. CLI entry points must not call this. */
export async function desktopShellEnvironment(
	options: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		fromTerminal?: boolean;
		timeoutMs?: number;
		warn?: (message: string) => void;
	} = {},
): Promise<NodeJS.ProcessEnv> {
	const env = { ...(options.env ?? process.env) };
	const platform = options.platform ?? process.platform;
	const fromTerminal = options.fromTerminal ?? Boolean(process.stdin.isTTY || (env.TERM && env.TERM !== "dumb"));
	if (platform === "win32" || fromTerminal) return env;
	try {
		const shell = env.SHELL || userInfo().shell || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
		if (!isAbsolute(shell)) throw new Error("invalid shell path");
		const captured = await captureEnvironment(shell, env, options.timeoutMs ?? 10_000);
		// Startup files may supply new tool variables, but cannot change Argon's launch configuration.
		for (const key of Object.keys(captured)) {
			if (
				/^(ARGON_|PI_|ELECTRON_)/.test(key) ||
				["NODE_OPTIONS", "NODE_PATH", "PWD", "OLDPWD", "SHLVL", "_"].includes(key)
			)
				delete captured[key];
		}
		return { ...captured, ...env, PATH: captured.PATH };
	} catch {
		// Shell output and error objects can contain credentials. Never include them in diagnostics.
		(options.warn ?? console.warn)("Could not load desktop shell environment; using inherited environment.");
		return env;
	}
}

function captureEnvironment(shell: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<NodeJS.ProcessEnv> {
	return new Promise((resolve, reject) => {
		const marker = `\0argon-${randomUUID()}\0`;
		const printMarker = `/usr/bin/printf '\\0${marker.slice(1, -1)}\\0'`;
		const child = spawn(shell, ["-ilc", `${printMarker}; /usr/bin/env -0; ${printMarker}`], {
			cwd: homedir(),
			env,
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const finish = (error?: Error, result?: NodeJS.ProcessEnv) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			if (error) {
				// Also stop startup-script children that may still hold stdout open.
				try {
					if (child.pid) process.kill(-child.pid, "SIGKILL");
				} catch {}
				child.stdout.destroy();
				reject(error);
			} else resolve(result!);
		};
		const timer = setTimeout(() => finish(new Error("shell initialization timed out")), timeoutMs);
		child.on("error", () => finish(new Error("shell failed to start")));
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 1024 * 1024) finish(new Error("shell output too large"));
			else chunks.push(chunk);
		});
		child.on("close", (code) => {
			if (done) return;
			const output = Buffer.concat(chunks).toString("utf8");
			const start = output.indexOf(marker);
			const end = output.indexOf(marker, start + marker.length);
			if (code !== 0 || start < 0 || end < 0) return finish(new Error("invalid shell output"));
			const result: NodeJS.ProcessEnv = {};
			for (const entry of output.slice(start + marker.length, end).split("\0")) {
				const equals = entry.indexOf("=");
				if (equals > 0)
					Object.defineProperty(result, entry.slice(0, equals), {
						value: entry.slice(equals + 1),
						enumerable: true,
						configurable: true,
						writable: true,
					});
			}
			if (!result.PATH) return finish(new Error("shell returned no PATH"));
			finish(undefined, result);
		});
	});
}
