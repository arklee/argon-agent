import { describe, expect, it } from "vitest";
import { normalizeMath } from "./math-delimiters";

describe("normalizeMath", () => {
	it("leaves text without math untouched", () => {
		const text = "Plain **markdown** with a [link](https://x.y).";
		expect(normalizeMath(text)).toBe(text);
	});

	it("keeps paired dollar math", () => {
		expect(normalizeMath("Euler: $e^{i\\pi}+1=0$.")).toBe("Euler: $e^{i\\pi}+1=0$.");
		expect(normalizeMath("$$\n\\int_0^1 x\\,dx\n$$")).toBe("$$\n\\int_0^1 x\\,dx\n$$");
	});

	it("escapes currency dollars", () => {
		expect(normalizeMath("It costs $5 and $10.")).toBe("It costs \\$5 and \\$10.");
		expect(normalizeMath("Pay $ 20 now")).toBe("Pay \\$ 20 now");
		expect(normalizeMath("between $3$4")).toBe("between \\$3\\$4");
	});

	it("does not pair dollars across paragraphs", () => {
		expect(normalizeMath("$a\n\nb$")).toBe("\\$a\n\nb\\$");
	});

	it("converts LaTeX inline delimiters", () => {
		expect(normalizeMath("where \\( x^2 \\) grows")).toBe("where $x^2$ grows");
	});

	it("converts LaTeX display delimiters into a math block", () => {
		expect(normalizeMath("Sum:\n\\[ \\sum_i i \\]\ndone")).toBe("Sum:\n\n$$\n\\sum_i i\n$$\n\ndone");
	});

	it("keeps list indentation for display math", () => {
		expect(normalizeMath("- item\n  \\[x\\]")).toBe("- item\n  \n  $$\n  x\n  $$\n");
	});

	it("opens a display block for an unclosed \\[ while streaming", () => {
		expect(normalizeMath("see \\[ a + ")).toBe("see \n$$\na +");
	});

	it("leaves an unclosed inline opener as text", () => {
		expect(normalizeMath("see \\( a + ")).toBe("see \\( a + ");
		expect(normalizeMath("see $a + ")).toBe("see \\$a + ");
	});

	it("preserves escaped dollars", () => {
		expect(normalizeMath("\\$5 and $x$")).toBe("\\$5 and $x$");
	});

	it("skips fenced code and inline code", () => {
		const fenced = "```sh\necho $HOME \\(x\\)\n```\nand $5";
		expect(normalizeMath(fenced)).toBe("```sh\necho $HOME \\(x\\)\n```\nand \\$5");
		expect(normalizeMath("run `echo $PATH` for $x$")).toBe("run `echo $PATH` for $x$");
	});

	it("skips an unclosed fence while streaming", () => {
		expect(normalizeMath("text\n```js\nconst a = `$5`")).toBe("text\n```js\nconst a = `$5`");
	});
});
