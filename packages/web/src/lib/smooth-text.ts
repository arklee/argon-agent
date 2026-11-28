import { useEffect, useRef, useState } from "react";

/**
 * Pacing for streamed text. Tokens arrive in bursts (a whole sentence, sometimes hundreds of characters at once);
 * revealing them at an adaptive rate turns those bursts into a steady flow instead of blocks popping in.
 *
 * - Small backlog: drain it within TARGET_LATENCY_MS, never slower than MIN_CPS (a crisp typing pace).
 * - Large backlog (a long burst, or the tab was hidden): drain it within CATCH_UP_LATENCY_MS, capped at MAX_CPS,
 *   so the display never falls further and further behind.
 * - Stream ended: drain what is left within DRAIN_LATENCY_MS, so the reply is complete when its turn says done.
 * - Commits are throttled to ~30 fps; every commit re-renders the Markdown tree.
 */
const MIN_CPS = 80;
const MAX_CPS = 1500;
const TARGET_LATENCY_MS = 500;
const CATCH_UP_THRESHOLD = 600;
const CATCH_UP_LATENCY_MS = 350;
const DRAIN_LATENCY_MS = 200;
const COMMIT_INTERVAL_MS = 33;

/** Characters per second for the current backlog; `draining` once the stream has ended. */
export function revealRate(backlog: number, draining = false): number {
	if (draining) return Math.max(MIN_CPS, (backlog * 1000) / DRAIN_LATENCY_MS);
	if (backlog > CATCH_UP_THRESHOLD) return Math.min(MAX_CPS, (backlog * 1000) / CATCH_UP_LATENCY_MS);
	return Math.max(MIN_CPS, (backlog * 1000) / TARGET_LATENCY_MS);
}

/** Next revealed length after `elapsedMs`, never splitting a surrogate pair. Fractional progress is returned too. */
export function advance(
	text: string,
	shown: number,
	carry: number,
	elapsedMs: number,
	draining = false,
): { shown: number; carry: number } {
	const backlog = text.length - shown;
	if (backlog <= 0) return { shown: text.length, carry: 0 };
	const budget = carry + (revealRate(backlog, draining) * elapsedMs) / 1000;
	const step = Math.min(backlog, Math.floor(budget));
	let next = shown + step;
	if (next < text.length && isHighSurrogate(text.charCodeAt(next - 1))) next++;
	return { shown: next, carry: next >= text.length ? 0 : budget - step };
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

const reducedMotion = () =>
	typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Reveal `text` gradually while it grows. Pacing is decided once, at mount: only a message that mounts while
 * streaming is paced, and the text it already has is shown at once (switching sessions or remounting never
 * replays a message). After streaming ends the remaining backlog drains quickly instead of jumping.
 * Returns the visible text and whether it is still catching up.
 */
export function useSmoothText(text: string, streaming: boolean): { text: string; pending: boolean } {
	const [enabled] = useState(() => streaming && !reducedMotion());
	const [shown, setShown] = useState(text.length);
	const state = useRef({ text, shown: text.length, carry: 0, last: 0, frame: 0, streaming });
	state.current.streaming = streaming;

	useEffect(() => {
		if (!enabled) return;
		const s = state.current;
		// Not an append (edited, regenerated, or shorter): show the new text as is.
		if (!text.startsWith(s.text.slice(0, s.shown))) {
			s.shown = text.length;
			s.carry = 0;
			setShown(text.length);
		}
		s.text = text;
		if (s.shown >= text.length || s.frame) return;
		s.last = performance.now();
		const tick = (now: number) => {
			const elapsed = now - s.last;
			if (elapsed >= COMMIT_INTERVAL_MS) {
				const next = advance(s.text, s.shown, s.carry, elapsed, !s.streaming);
				s.shown = next.shown;
				s.carry = next.carry;
				s.last = now;
				setShown(next.shown);
			}
			s.frame = s.shown < s.text.length ? requestAnimationFrame(tick) : 0;
		};
		s.frame = requestAnimationFrame(tick);
	}, [enabled, text]);

	useEffect(
		() => () => {
			cancelAnimationFrame(state.current.frame);
			state.current.frame = 0;
		},
		[],
	);

	if (!enabled) return { text, pending: false };
	const visible = Math.min(shown, text.length);
	return { text: visible >= text.length ? text : text.slice(0, visible), pending: visible < text.length };
}
