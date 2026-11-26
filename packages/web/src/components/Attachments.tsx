import type { ImageData } from "@argon/shared";
import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { IMAGE_TYPES, readFileAsBase64, Thumbnail, toDataUrl } from "@/components/Images";
import { Button } from "@/components/ui/button";
import { getClient } from "@/stores/app";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ImageAttachment extends ImageData {
	id: string;
	name: string;
}

/** `@path`, quoted like pi's editor when the path has spaces or quotes. */
export function fileReference(path: string): string {
	return /[\s"']/.test(path) ? `@"${path}"` : `@${path}`;
}

/**
 * Pasted, dropped or picked files. Images ride along with the prompt (pi resizes them for the
 * model); other files are uploaded to the backend machine and referenced as `@path`, because the
 * agent reads files there and the browser cannot hand over local paths.
 */
export function useAttachments(insertText: (text: string) => void) {
	const { t } = useTranslation();
	const [images, setImages] = useState<ImageAttachment[]>([]);
	const [uploading, setUploading] = useState(0);

	const addFiles = useCallback(
		async (files: File[]) => {
			for (const file of files) {
				try {
					if (IMAGE_TYPES.has(file.type)) {
						if (file.size > MAX_IMAGE_BYTES) throw new Error(t("attachments.tooLarge", { file: file.name, limit: 20 }));
						const data = await readFileAsBase64(file);
						setImages((list) => [...list, { id: crypto.randomUUID(), name: file.name, mimeType: file.type, data }]);
					} else {
						if (file.size > MAX_FILE_BYTES) throw new Error(t("attachments.tooLarge", { file: file.name, limit: 25 }));
						setUploading((n) => n + 1);
						try {
							const data = await readFileAsBase64(file);
							const { path } = await getClient().request("files.upload", { name: file.name, data });
							insertText(`${fileReference(path)} `);
						} finally {
							setUploading((n) => n - 1);
						}
					}
				} catch (error) {
					toast.error(error instanceof Error ? error.message : String(error));
				}
			}
		},
		[insertText, t],
	);

	return {
		images,
		uploading: uploading > 0,
		addFiles,
		remove: (id: string) => setImages((list) => list.filter((image) => image.id !== id)),
		clear: () => setImages([]),
	};
}

export function AttachmentStrip({
	images,
	uploading,
	onRemove,
}: {
	images: ImageAttachment[];
	uploading: boolean;
	onRemove: (id: string) => void;
}) {
	const { t } = useTranslation();
	if (images.length === 0 && !uploading) return null;
	return (
		<div className="flex flex-wrap items-center gap-2 px-3 pt-3">
			{images.map((image) => (
				<div key={image.id} className="group relative">
					<Thumbnail src={toDataUrl(image)} className="size-16" />
					<Button
						variant="secondary"
						size="icon-xs"
						title={t("attachments.remove", { file: image.name || t("images.alt") })}
						onClick={() => onRemove(image.id)}
						className="absolute -top-1.5 -right-1.5 size-5 rounded-full opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100"
					>
						<X />
					</Button>
				</div>
			))}
			{uploading && <span className="text-xs text-muted-foreground">{t("attachments.uploading")}</span>}
		</div>
	);
}
