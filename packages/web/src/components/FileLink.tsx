import type { FileDiff } from "@argon/shared";
import { FileSearch } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { useFilePanel } from "@/stores/file-panel";

/** Open `target` (a path as a tool or model wrote it) in the active session's file panel. */
export function openFileInPanel(target: string, options?: { cwd?: string; diffs?: FileDiff[] }): void {
	const { activeSessionId, sessionStates } = useApp.getState();
	if (!activeSessionId) return;
	const cwd = options?.cwd ?? sessionStates[activeSessionId]?.cwd;
	useFilePanel.getState().openFile({ sessionId: activeSessionId, target, cwd, diffs: options?.diffs });
}

/** A path that opens in the file panel. */
export function FileLink({
	target,
	diffs,
	className,
	children,
}: {
	target: string;
	diffs?: FileDiff[];
	className?: string;
	children?: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			title={`${t("files.open")}: ${target}`}
			onClick={(e) => {
				e.stopPropagation();
				openFileInPanel(target, { diffs });
			}}
			className={cn("min-w-0 truncate text-left hover:underline", className)}
		>
			{children ?? target}
		</button>
	);
}

/** Icon button next to a tool call or changed file that opens it in the file panel. */
export function OpenFileButton({
	target,
	diffs,
	className,
	onOpen,
}: {
	target: string;
	diffs?: FileDiff[];
	className?: string;
	onOpen?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={`${t("files.open")}: ${target}`}
			title={t("files.open")}
			onClick={(e) => {
				e.stopPropagation();
				onOpen?.();
				openFileInPanel(target, { diffs });
			}}
			className={cn("shrink-0 text-muted-foreground", className)}
		>
			<FileSearch />
		</Button>
	);
}
