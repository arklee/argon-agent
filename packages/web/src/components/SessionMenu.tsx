import type { SessionSummary } from "@argon/shared";
import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { sessionTitle } from "@/lib/format";
import { useApp } from "@/stores/app";

export function SessionNameInput({ session, close }: { session: SessionSummary; close: () => void }) {
	const { t } = useTranslation();
	const [name, setName] = useState(session.name || sessionTitle(session));
	return (
		<Input
			aria-label={t("sessionMenu.name")}
			className="h-7"
			value={name}
			autoFocus
			onFocus={(e) => e.target.select()}
			onBlur={close}
			onChange={(e) => setName(e.target.value)}
			onKeyDown={(e) => {
				if (e.nativeEvent.isComposing) return;
				if (e.key === "Escape") close();
				if (e.key === "Enter" && name.trim()) {
					void useApp.getState().renameSession(name.trim(), session);
					close();
				}
			}}
		/>
	);
}

export function SessionMenu({
	session,
	onRename,
	open,
	onOpenChange,
	className,
	header = false,
}: {
	session: SessionSummary;
	onRename: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	header?: boolean;
}) {
	const { t } = useTranslation();
	const [deleting, setDeleting] = useState(false);
	const pendingAction = useRef<"rename" | "delete" | undefined>(undefined);
	return (
		<>
			<DropdownMenu open={open} onOpenChange={onOpenChange}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						className={className}
						aria-label={t("common.actionsFor", { name: sessionTitle(session) })}
					>
						<Ellipsis />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					onCloseAutoFocus={(e) => {
						if (pendingAction.current) {
							e.preventDefault();
							if (pendingAction.current === "rename") onRename();
							else setDeleting(true);
							pendingAction.current = undefined;
						}
					}}
				>
					<DropdownMenuItem
						onSelect={() => {
							pendingAction.current = "rename";
						}}
					>
						{t("sessionMenu.rename")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void useApp.getState().duplicateSession(session)}>
						{header ? t("sessionMenu.duplicateSession") : t("sessionMenu.duplicate")}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						disabled={!session.sessionPath}
						onSelect={() => {
							pendingAction.current = "delete";
						}}
					>
						{header ? t("sessionMenu.deleteSession") : t("sessionMenu.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={deleting} onOpenChange={setDeleting}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("sessionMenu.confirmDelete")}</DialogTitle>
						<DialogDescription>{t("sessionMenu.deleteDescription")}</DialogDescription>
					</DialogHeader>
					<p className="truncate text-sm">{sessionTitle(session)}</p>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleting(false)}>
							{t("common.cancel")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setDeleting(false);
								void useApp.getState().deleteSession(session);
							}}
						>
							{t("sessionMenu.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
