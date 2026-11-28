import { describe, expect, it } from "vitest";
import { advance, revealRate } from "./smooth-text";

describe("revealRate", () => {
	it("never drops below the base typing pace", () => {
		expect(revealRate(1)).toBe(80);
	});

	it("drains a moderate backlog within the target latency", () => {
		expect(revealRate(450)).toBeCloseTo(500);
	});

	it("speeds up for a large backlog, capped", () => {
		expect(revealRate(420)).toBeCloseTo(466.67);
		expect(revealRate(700)).toBe(1500);
		expect(revealRate(100_000)).toBe(1500);
	});
});

describe("advance", () => {
	it("reveals characters proportional to elapsed time and keeps the fraction", () => {
		const text = "x".repeat(10);
		const next = advance(text, 0, 0, 50);
		expect(next.shown).toBe(4);
		expect(next.carry).toBeCloseTo(0);
		expect(advance(text, 0, 0, 20)).toEqual({ shown: 1, carry: expect.closeTo(0.6) });
	});

	it("does not overshoot the text", () => {
		expect(advance("abc", 2, 0, 10_000)).toEqual({ shown: 3, carry: 0 });
		expect(advance("abc", 3, 0.5, 33)).toEqual({ shown: 3, carry: 0 });
	});

	it("does not split a surrogate pair", () => {
		const text = "a😀bcdefghij";
		const next = advance(text, 0, 0, 25);
		expect(next.shown).toBe(3);
		expect(text.slice(0, next.shown)).toBe("a😀");
	});
});
