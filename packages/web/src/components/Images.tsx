import type { ImageData } from "@argon/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getClient } from "@/stores/app";

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function toDataUrl(image: ImageData): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

export function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
		reader.readAsDataURL(file);
	});
}

// Images never change once written, so fetched ones are cached for the page's lifetime.
const cache = new Map<string, Promise<ImageData[]>>();

function loadImages(sessionId: string, ref: { toolCallId?: string; itemId?: string }): Promise<ImageData[]> {
	const key = `${sessionId}:${ref.toolCallId ?? ""}:${ref.itemId ?? ""}`;
	let pending = cache.get(key);
	if (!pending) {
		pending = getClient()
			.request("sessions.getImages", { sessionId, ...ref })
			.then((r) => r.images);
		// Do not cache failures or empty answers (the entry may not be written yet).
		pending.then(
			(images) => images.length === 0 && cache.delete(key),
			() => cache.delete(key),
		);
		cache.set(key, pending);
	}
	return pending;
}

export function Thumbnail({ src, className }: { src: string; className?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className={cn("overflow-hidden rounded-lg border bg-muted", className)}
			>
				<img src={src} alt="" className="size-full object-cover" />
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-[90vw] p-2 sm:max-w-[90vw]">
					<DialogTitle className="sr-only">Image</DialogTitle>
					<img src={src} alt="" className="max-h-[85vh] w-full object-contain" />
				</DialogContent>
			</Dialog>
		</>
	);
}

/** Images stored in the session (tool result or user message), loaded from the backend on demand. */
export function SessionImages({
	sessionId,
	toolCallId,
	itemId,
	count,
	className,
}: {
	sessionId: string;
	toolCallId?: string;
	itemId?: string;
	count: number;
	className?: string;
}) {
	const [images, setImages] = useState<ImageData[]>();
	useEffect(() => {
		let cancelled = false;
		loadImages(sessionId, { toolCallId, itemId }).then(
			(result) => !cancelled && setImages(result),
			() => !cancelled && setImages([]),
		);
		return () => {
			cancelled = true;
		};
	}, [sessionId, toolCallId, itemId]);

	if (images === undefined) {
		return (
			<div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
				<Loader2 className="size-3 animate-spin" /> Loading {count} image{count === 1 ? "" : "s"}…
			</div>
		);
	}
	if (images.length === 0) {
		return (
			<p className={cn("text-xs text-muted-foreground", className)}>
				{count} image{count === 1 ? "" : "s"}
			</p>
		);
	}
	return (
		<div className={cn("flex flex-wrap gap-2", className)}>
			{images.map((image, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: images are positional
				<Thumbnail key={i} src={toDataUrl(image)} className="h-24 max-w-48" />
			))}
		</div>
	);
}
