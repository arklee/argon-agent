import { describe, expect, it, vi } from "vitest";
import { friendlyHostName } from "../src/config.ts";

describe("friendlyHostName", () => {
	it.each([
		["darwin", "scutil", ["--get", "ComputerName"]],
		["linux", "hostnamectl", ["--pretty"]],
	])("uses the friendly name command on %s", (platform, command, args) => {
		const exec = vi.fn(() => "My Computer");
		expect(friendlyHostName(platform, "network.local", exec)).toBe("My Computer");
		expect(exec).toHaveBeenCalledExactlyOnceWith(command, args);
	});

	it.each(["darwin", "linux"])("falls back to the host on %s when exec returns undefined", (platform) => {
		const exec = vi.fn(() => undefined);
		for (const [host, expected] of [
			["workstation.local", "workstation"],
			["workstation.LOCAL", "workstation"],
			["workstation", "workstation"],
			["192.168.1.2", "192.168.1.2"],
			["::1", "::1"],
		])
			expect(friendlyHostName(platform, host, exec)).toBe(expected);
	});
});
