import { describe, expect, it } from "vitest";
import { isNewerPluginVersion, pluginSearchState } from "./plugin-update";

describe("plugin updates", () => {
	it.each([
		["0.2.45", "0.2.43", true],
		["0.2.10", "0.2.9", true],
		["1.0.0", "1.0.0", false],
		["1.0.0", "2.0.0", false],
		["1.0.0", "1.0.0-rc.1", true],
		["1.0.0-rc.1", "1.0.0", false],
		["1.0.0-beta.10", "1.0.0-beta.9", true],
		["1.0.0-beta", "1.0.0-alpha", true],
		["1.0.0+new", "1.0.0+old", false],
		["1.0.0", "latest", false],
		["1.0.0", "^0.2.0", false],
		["invalid", "1.0.0", false],
	])("compares %s against %s", (candidate, installed, expected) => {
		expect(isNewerPluginVersion(candidate, installed)).toBe(expected);
	});

	it("offers updates only for managed exact versions of the same package", () => {
		const name = "@magpie-community/example";
		const installed = [{ spec: `${name}@0.2.43`, managed: true }];
		expect(pluginSearchState(installed, name, "0.2.45")).toBe("update");
		expect(pluginSearchState(installed, name, "0.2.43")).toBe("installed");
		expect(pluginSearchState(installed, name, "0.2.42")).toBe("installed");
		expect(pluginSearchState([{ ...installed[0]!, managed: false }], name, "0.2.45")).toBe("installed");
		expect(pluginSearchState([{ spec: name, managed: true }], name, "0.2.45")).toBe("installed");
		expect(pluginSearchState([{ spec: `npm:${name}-other@0.2.43`, managed: true }], name, "0.2.45")).toBe("install");
		expect(pluginSearchState([{ spec: `npm:${name}@0.2.43`, managed: true }], name, "0.2.45")).toBe("update");
		expect(pluginSearchState([], name, "0.2.45")).toBe("install");
	});
});
