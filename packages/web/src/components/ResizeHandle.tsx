import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A draggable panel edge (the ARIA window splitter pattern). It sits in a zero-width flex item
 * between two panes, so it takes no room. `direction` 1 means dragging right makes the panel wider
 * (a left-hand panel), -1 the reverse. `onResize` gets the raw width the pointer asks for; the
 * caller clamps it (or hides the panel). Double-click resets, arrow keys step by 16px.
 */
export function ResizeHandle({
	label,
	width,
	min,
	direction,
	disabled = false,
	onResize,
	onReset,
	onResizingChange,
	measure,
}: {
	label: string;
	width: number;
	/** The width a drag starts from, when `width` is not the rendered width (e.g. a CSS default). */
	measure?(): number;
	min: number;
	direction: 1 | -1;
	disabled?: boolean;
	onResize(width: number): void;
	onReset(): void;
	onResizingChange?(resizing: boolean): void;
}) {
	const [resizing, setResizing] = useState(false);
	const setBoth = (next: boolean) => {
		setResizing(next);
		onResizingChange?.(next);
	};
	return (
		<div className={cn("window-no-drag relative z-20 w-0 shrink-0", disabled && !resizing && "pointer-events-none")}>
			{/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA window splitter pattern. */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={label}
				aria-valuemin={min}
				aria-valuenow={disabled ? 0 : Math.round(width)}
				tabIndex={disabled ? -1 : 0}
				className={cn(
					"absolute inset-y-0 -left-1 w-2 cursor-col-resize outline-none",
					"after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-ring/50 focus-visible:after:bg-ring",
					resizing && "after:bg-ring/50",
				)}
				onDoubleClick={onReset}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					onResize((measure?.() ?? width) + (event.key === "ArrowRight" ? 16 : -16) * direction);
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					const handle = event.currentTarget;
					handle.setPointerCapture(event.pointerId);
					const startX = event.clientX;
					const startWidth = disabled ? 0 : (measure?.() ?? width);
					setBoth(true);
					const body = document.body.style;
					const restore = { cursor: body.cursor, userSelect: body.userSelect };
					body.cursor = "col-resize";
					body.userSelect = "none";
					const onMove = (move: PointerEvent) => onResize(startWidth + (move.clientX - startX) * direction);
					const onEnd = (end: PointerEvent) => {
						// The release point counts too: coalesced or synthetic drags may send few moves.
						if (end.type === "pointerup" && end.clientX !== startX) onMove(end);
						handle.removeEventListener("pointermove", onMove);
						handle.removeEventListener("pointerup", onEnd);
						handle.removeEventListener("pointercancel", onEnd);
						body.cursor = restore.cursor;
						body.userSelect = restore.userSelect;
						setBoth(false);
					};
					handle.addEventListener("pointermove", onMove);
					handle.addEventListener("pointerup", onEnd);
					handle.addEventListener("pointercancel", onEnd);
				}}
			/>
		</div>
	);
}
