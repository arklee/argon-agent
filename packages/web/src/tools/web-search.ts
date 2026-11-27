/** Sources are derived from persisted tool output, so live and reopened cards agree. */
export function webSearchSources(output: string): { title: string; url: string }[] {
	const sources = new Map<string, string>();
	const add = (url: unknown, title?: unknown) => {
		if (typeof url !== "string") return;
		try {
			const parsed = new URL(url);
			if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return;
			if (!sources.has(parsed.href))
				sources.set(parsed.href, typeof title === "string" && title.trim() ? title : parsed.hostname);
		} catch {
			/* Not a navigable URL. */
		}
	};
	// Structured-only upstream responses are emitted as JSON.
	try {
		const data = JSON.parse(output);
		for (const item of Array.isArray(data?.search_results) ? data.search_results : []) add(item?.url, item?.title);
	} catch {
		/* Normal output is text. */
	}
	for (const match of output.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s]+?)\)/g)) add(match[2], match[1]);
	// Codex search headings use “Title (https://...)”, followed by source metadata.
	for (const match of output.matchAll(/^(.+?) \((https?:\/\/[^\s]+)\)\s*$/gm)) add(match[2], match[1]);
	return [...sources].map(([url, title]) => ({ title, url }));
}
