import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

writeFileSync(process.env.ARGON_SMOKE_MCP_PID, String(process.pid));
createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	if (request.id === undefined) return;
	const result =
		request.method === "initialize"
			? {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "desktop-smoke", version: "1" },
				}
			: request.method === "tools/list"
				? { tools: [] }
				: {};
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
