import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("bootstrap isolates SDK defaults and project settings from pi CLI", () => {
	const home = mkdtempSync(join(tmpdir(), "argon-isolation-"));
	try {
		const bootstrap = new URL("../src/bootstrap.ts", import.meta.url).href;
		const script = `
			import { mkdirSync, writeFileSync } from "node:fs";
			import { join } from "node:path";
			await import(${JSON.stringify(bootstrap)});
			const { getAgentDir, SessionManager, SettingsManager } =
				await import("@earendil-works/pi-coding-agent");
			const home = process.env.ARGON_HOME;
			const cwd = join(home, "project");
			for (const [dir, model] of [[".pi", "cli"], [".argon", "argon"]]) {
				mkdirSync(join(cwd, dir), { recursive: true });
				writeFileSync(join(cwd, dir, "settings.json"), JSON.stringify({ defaultModel: model }));
			}
			const manager = SessionManager.create(cwd);
			console.log(JSON.stringify({
				agentDir: getAgentDir(),
				sessionDir: manager.getSessionDir(),
				model: SettingsManager.create(cwd).getDefaultModel(),
				sessions: (await SessionManager.listAll()).length,
			}));
		`;
		const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			env: {
				...process.env,
				ARGON_HOME: home,
				PI_CODING_AGENT_DIR: join(home, "forbidden-pi"),
				PI_CODING_AGENT_SESSION_DIR: join(home, "forbidden-sessions"),
			},
			encoding: "utf8",
		});
		const result = JSON.parse(output);
		expect(result.agentDir).toBe(join(home, "agent"));
		expect(result.sessionDir.startsWith(join(home, "agent", "sessions"))).toBe(true);
		expect(result.model).toBe("argon");
		expect(result.sessions).toBe(0);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
