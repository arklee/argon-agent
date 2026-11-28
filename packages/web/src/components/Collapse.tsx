import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Matches `duration-200` below. */
const DURATION_MS = 200;

type Phase = "closed" | "opening" | "open" | "closing";

/**
 * Height + fade animation for content that folds open and shut. The content mounts when it opens and
 * unmounts once it has finished closing, so folded content costs nothing (tool output, thinking).
 * Content that starts open shows without animating.
 *
 * Uses the grid-template-rows 0fr → 1fr transition, so the content's natural height is never measured.
 */
export function Collapse({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
	const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
	const ref = useRef<HTMLDivElement>(null);
	// Mount in the same render that opens, so the first frame starts from 0fr.
	if (open && (phase === "closed" || phase === "closing")) setPhase("opening");
	if (!open && (phase === "open" || phase === "opening")) setPhase("closing");

	const [expanded, setExpanded] = useState(open);
	useLayoutEffect(() => {
		if (phase === "opening") {
			// Flush the collapsed style so the change to 1fr transitions.
			void ref.current?.offsetHeight;
			setExpanded(true);
		} else if (phase === "closing") setExpanded(false);
	}, [phase]);

	useEffect(() => {
		if (phase !== "opening" && phase !== "closing") return;
		const id = window.setTimeout(() => setPhase(phase === "opening" ? "open" : "closed"), DURATION_MS);
		return () => window.clearTimeout(id);
	}, [phase]);

	if (phase === "closed") return null;
	return (
		<div
			ref={ref}
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
				expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
		>
			{/* Clipped only while moving, so focus rings and overflowing content show once it is open. */}
			<div className={cn("min-h-0", phase === "open" ? "flow-root" : "overflow-hidden")}>
				<div className={className}>{children}</div>
			</div>
		</div>
	);
}
