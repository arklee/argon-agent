import { describe, expect, it } from "vitest";
import { findFd } from "../src/file-completion.ts";

describe("fd lookup", () => {
	it("handles Windows drive letters, Path casing, quoted directories and exe suffix", () => {
		const executable = String.raw`D:\My Tools\fd.exe`;
		expect(
			findFd(
				String.raw`C:\Users\用户\.argon\agent`,
				"win32",
				{
					Path: String.raw`C:\Windows;"D:\My Tools";E:\bin`,
				},
				(path) => path === executable,
			),
		).toBe(executable);
	});
	it("prefers the agent's Windows binary", () => {
		const executable = String.raw`C:\Argon\agent\bin\fd.exe`;
		expect(findFd(String.raw`C:\Argon\agent`, "win32", { PATH: String.raw`D:\bin` }, () => true)).toBe(executable);
	});
	it("keeps Unix fdfind fallback and ignores empty PATH entries", () => {
		expect(findFd("/agent", "linux", { PATH: ":/usr/bin:/opt/bin" }, (path) => path === "/usr/bin/fdfind")).toBe(
			"/usr/bin/fdfind",
		);
		expect(findFd("/agent", "linux", {}, () => false)).toBeNull();
	});
});
