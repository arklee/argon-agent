import { expect, it } from "vitest";
import { webSearchSources } from "./web-search";

it("extracts Codex headings and Markdown links while deduplicating navigation targets", () => {
	expect(
		webSearchSources(
			"Example (https://example.com/)\ntext\n[Example](https://example.com/)\n[Docs](https://example.com/docs)",
		),
	).toEqual([
		{ title: "Example", url: "https://example.com/" },
		{ title: "Docs", url: "https://example.com/docs" },
	]);
});
it("supports structured fallback and rejects executable URLs and embedded credentials", () => {
	expect(
		webSearchSources(
			JSON.stringify({
				search_results: [
					{ title: "Docs", url: "https://example.com" },
					{ title: "Bad", url: "javascript:alert(1)" },
					{ url: "https://user:password@example.org" },
					null,
				],
			}),
		),
	).toEqual([{ title: "Docs", url: "https://example.com/" }]);
	expect(webSearchSources("No results")).toEqual([]);
});
