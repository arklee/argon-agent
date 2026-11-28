/**
 * File links in chat (decisions D22). Paths are opaque backend strings: this only classifies link
 * text and picks a highlighting language; resolving and reading happen on the backend (fs.readFile).
 */

export type MarkdownLink = { kind: "external" } | { kind: "file"; target: string } | { kind: "ignore" };

/**
 * What a clicked Markdown href points at. Anything without a URL scheme (or a file:// URL) is a file
 * path the backend resolves against the session cwd; other schemes are left alone or ignored.
 * After percho's classifyMarkdownLink (MIT).
 */
export function classifyMarkdownLink(href: string): MarkdownLink {
	const target = href.trim();
	if (!target || target.startsWith("#")) return { kind: "ignore" };
	if (/^(https?|mailto):/i.test(target)) return { kind: "external" };
	if (/^file:\/\//i.test(target)) return { kind: "file", target };
	// Protocol-relative URLs and other schemes (javascript:, data:, vscode:, …) are never opened.
	// A Windows drive (C:\ or C:/) is a path, not a scheme.
	if (target.startsWith("//") || (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)))
		return isLineAnchored(target) ? { kind: "file", target } : { kind: "ignore" };
	return { kind: "file", target };
}

/** `a.ts:12` parses as scheme "a.ts"; a bare file name with a line number is still a file. */
function isLineAnchored(target: string): boolean {
	return /^[^/:\\]+\.[\w-]+:\d+(?::\d+)?$/.test(target);
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	cjs: "javascript",
	mjs: "javascript",
	cts: "typescript",
	mts: "typescript",
	h: "c",
	hh: "cpp",
	hpp: "cpp",
	cc: "cpp",
	zsh: "shellscript",
	bash: "shellscript",
	sh: "shellscript",
	jsonl: "json",
	lock: "json",
	mdx: "mdx",
	yml: "yaml",
	txt: "",
	log: "",
};

const LANGUAGE_BY_NAME: Record<string, string> = {
	dockerfile: "docker",
	makefile: "make",
	justfile: "just",
	".bashrc": "shellscript",
	".zshrc": "shellscript",
	".gitignore": "",
	".env": "dotenv",
};

/** Highlighting language for a file name, if `supports` knows it. */
export function languageFor(path: string, supports: (language: string) => boolean): string | undefined {
	const name = (path.split(/[/\\]/).pop() ?? "").toLowerCase();
	const byName = LANGUAGE_BY_NAME[name];
	if (byName !== undefined) return byName && supports(byName) ? byName : undefined;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return undefined;
	const extension = name.slice(dot + 1);
	const language = LANGUAGE_BY_EXTENSION[extension] ?? extension;
	return language && supports(language) ? language : undefined;
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|mdx|markdown)$/i.test(path);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Markdown file links survive Streamdown's sanitize/harden steps (which drop `a.ts:42`, `file://` and
 * bare relative paths) by travelling as a sentinel https URL; `fileLinkTarget` unwraps them on click.
 */
const FILE_LINK_PREFIX = "https://argon-file.invalid/?target=";

export function wrapFileHref(href: string): string | undefined {
	const link = classifyMarkdownLink(href);
	return link.kind === "file" ? FILE_LINK_PREFIX + encodeURIComponent(link.target) : undefined;
}

export function fileLinkTarget(href: string): string | undefined {
	return href.startsWith(FILE_LINK_PREFIX) ? decodeURIComponent(href.slice(FILE_LINK_PREFIX.length)) : undefined;
}

interface HastNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

/** Rehype plugin, placed before Streamdown's own: wraps file hrefs (see wrapFileHref). */
export function rehypeFileLinks() {
	const walk = (node: HastNode) => {
		if (node.type === "element" && node.tagName === "a" && typeof node.properties?.href === "string") {
			const wrapped = wrapFileHref(node.properties.href);
			if (wrapped) node.properties.href = wrapped;
		}
		for (const child of node.children ?? []) walk(child);
	};
	return (tree: HastNode) => walk(tree);
}
