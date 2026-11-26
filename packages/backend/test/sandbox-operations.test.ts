import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import * as pi from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { InteractionBroker } from "../src/interactions.ts";
import { ArgonSandbox } from "../src/sandbox.ts";
import { canonicalPath } from "../src/sandbox-policy.ts";
import { ArgonSettingsStore } from "../src/settings.ts";

vi.mock(import("@earendil-works/pi-coding-agent"), async (original) => ({
	...(await original()),
	createLocalBashOperations: vi.fn(),
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});
const owner = {
	id: "owner",
	allowedDomains: new Set<string>(),
	broker: new InteractionBroker({ onRequested() {}, onResolved() {} }),
};
const settings = () => new ArgonSettingsStore("/argon", undefined, { supported: true, mechanism: "seatbelt" });

it("fails closed on initialization failure, publishing the reason without spawning", async () => {
	const store = settings();
	const sandbox = new ArgonSandbox(store);
	vi.spyOn(SandboxManager, "initialize").mockRejectedValue(new Error("missing rg"));
	const local = vi.mocked(pi.createLocalBashOperations);
	await expect(
		sandbox.operations({ session: owner, toolCallId: "failed" }).exec("echo hello", process.cwd(), { onData() {} }),
	).rejects.toThrow("Sandbox initialization failed: missing rg");
	expect(store.support).toMatchObject({ supported: true, reason: expect.stringContaining("missing rg") });
	expect(local).not.toHaveBeenCalled();
});

it("wraps each cwd independently, annotates failures and releases network attribution", async () => {
	const sandbox = new ArgonSandbox(settings());
	vi.spyOn(SandboxManager, "initialize").mockResolvedValue();
	const wrap = vi.spyOn(SandboxManager, "wrapWithSandbox").mockResolvedValue("wrapped");
	const annotate = vi
		.spyOn(SandboxManager, "annotateStderrWithSandboxFailures")
		.mockReturnValue("<sandbox_violations>denied</sandbox_violations>");
	const exec = vi.fn(async () => ({ exitCode: 1 }));
	vi.mocked(pi.createLocalBashOperations).mockReturnValue({ exec });
	const onData = vi.fn();
	for (const cwd of [process.cwd(), "/tmp"])
		await sandbox
			.operations({ session: owner, toolCallId: cwd })
			.exec("touch blocked", cwd, { onData, env: { PATH: process.env.PATH, BASH_ENV: "/untrusted" } });
	for (const [index, cwd] of [process.cwd(), "/tmp"].entries()) {
		expect(wrap.mock.calls[index]?.[2]?.filesystem?.allowWrite).toContainEqual({
			path: canonicalPath(cwd),
			literal: true,
		});
		expect(annotate.mock.calls[index]?.[0]).toBe(wrap.mock.calls[index]?.[4]?.commandId);
	}
	expect(wrap.mock.calls[0]?.[4]?.commandId).not.toBe(wrap.mock.calls[1]?.[4]?.commandId);
	expect(onData.mock.calls[0]?.[0].toString()).toContain("sandbox_violations");
	expect(exec).toHaveBeenCalledWith(
		"wrapped",
		expect.any(String),
		expect.objectContaining({ env: { PATH: process.env.PATH } }),
	);
	expect(sandbox.attribution.select().ambiguous).toBe(true);
});
