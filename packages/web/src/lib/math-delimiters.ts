/**
 * Prepare model output for remark-math (via @streamdown/math with single-dollar inline math on).
 *
 * Models write math three ways: `$…$` / `$$…$$`, and the LaTeX delimiters `\(…\)` / `\[…\]`. remark-math only
 * understands dollars, and in Markdown `\(` / `\[` are plain escapes that render as `(` / `[`. A bare `$` is also
 * ambiguous with currency, so a single `$` only opens math under Pandoc's rule: the opener is followed by a
 * non-space, the closer is preceded by a non-space and not followed by a digit, and both sit in one paragraph.
 * Dollars that do not pair this way are escaped, so "$5 and $10" stays text instead of becoming a formula.
 *
 * Fenced code blocks and inline code spans are left untouched. Works on partial (streaming) text: an unclosed
 * `\[` or `$$` opens a display block that remend completes; an unclosed `$` or `\(` stays text until it closes.
 */
export function normalizeMath(text: string): string {
	if (!/[$\\]/.test(text)) return text;
	let out = "";
	for (const segment of splitCode(text)) out += segment.code ? segment.text : normalizeProse(segment.text);
	return out;
}

type Segment = { code: boolean; text: string };

const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/** Split into code (fenced blocks, inline code spans) and prose segments, preserving every character. */
function splitCode(text: string): Segment[] {
	const segments: Segment[] = [];
	let prose = "";
	const lines = text.split(/(?<=\n)/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		const open = FENCE.exec(line);
		if (!open) {
			prose += line;
			continue;
		}
		const fence = open[1] as string;
		const close = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*\\r?\\n?$`);
		let block = line;
		while (i + 1 < lines.length) {
			const next = lines[++i] as string;
			block += next;
			if (close.test(next)) break;
		}
		if (prose) segments.push(...splitInlineCode(prose));
		prose = "";
		segments.push({ code: true, text: block });
	}
	if (prose) segments.push(...splitInlineCode(prose));
	return segments;
}

function splitInlineCode(text: string): Segment[] {
	const segments: Segment[] = [];
	let start = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] !== "`") {
			i++;
			continue;
		}
		let run = i;
		while (text[run] === "`") run++;
		const ticks = text.slice(i, run);
		const close = findBacktickRun(text, run, ticks.length);
		if (close === -1) {
			i = run;
			continue;
		}
		if (i > start) segments.push({ code: false, text: text.slice(start, i) });
		segments.push({ code: true, text: text.slice(i, close + ticks.length) });
		start = i = close + ticks.length;
	}
	if (start < text.length) segments.push({ code: false, text: text.slice(start) });
	return segments;
}

/** Index of the next run of exactly `length` backticks at or after `from`, or -1. */
function findBacktickRun(text: string, from: number, length: number): number {
	let i = from;
	while (i < text.length) {
		if (text[i] !== "`") {
			i++;
			continue;
		}
		let run = i;
		while (text[run] === "`") run++;
		if (run - i === length) return i;
		i = run;
	}
	return -1;
}

function normalizeProse(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		const next = text[i + 1];
		if (ch === "\\" && next === "$") {
			out += "\\$";
			i += 2;
		} else if (ch === "\\" && next === "(") {
			const close = text.indexOf("\\)", i + 2);
			const body = close === -1 ? "" : text.slice(i + 2, close).trim();
			if (close === -1 || !body || /\n[ \t]*\n/.test(body)) {
				out += "\\(";
				i += 2;
			} else {
				out += `$${body}$`;
				i = close + 2;
			}
		} else if (ch === "\\" && next === "[") {
			const close = text.indexOf("\\]", i + 2);
			const body = (close === -1 ? text.slice(i + 2) : text.slice(i + 2, close)).trim();
			const indent = lineIndent(text, i);
			out += `\n${indent}$$\n${indent}${body}${close === -1 ? "" : `\n${indent}$$\n`}`;
			i = close === -1 ? text.length : close + 2;
		} else if (ch === "\\") {
			out += ch + (next ?? "");
			i += 2;
		} else if (ch === "$" && next === "$") {
			const close = text.indexOf("$$", i + 2);
			const end = close === -1 ? text.length : close + 2;
			out += text.slice(i, end);
			i = end;
		} else if (ch === "$") {
			const close = findInlineClose(text, i);
			if (close === -1) {
				out += "\\$";
				i++;
			} else {
				out += text.slice(i, close + 1);
				i = close + 1;
			}
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

/** Pandoc-style closer for a single `$` opener at `open`, or -1 when it does not open math. */
function findInlineClose(text: string, open: number): number {
	const first = text[open + 1];
	if (first === undefined || /\s/.test(first)) return -1;
	for (let i = open + 1; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "\n" && /^\n[ \t]*\n/.test(text.slice(i))) return -1;
		if (ch !== "$") continue;
		if (text[i + 1] === "$") return -1;
		if (/\s/.test(text[i - 1] as string) || /\d/.test(text[i + 1] ?? "")) continue;
		return i;
	}
	return -1;
}

/** Leading whitespace of the line containing `index`, so display math stays inside list items. */
function lineIndent(text: string, index: number): string {
	const start = text.lastIndexOf("\n", index - 1) + 1;
	return /^[ \t]*/.exec(text.slice(start, index))?.[0] ?? "";
}
