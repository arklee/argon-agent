import type { SessionSummary } from "@argon/shared";
import { Ellipsis } from "lucide-react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
	DropdownMenuSeparator,
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

interface SessionAction {
	key: string;
	label: string;
	onSelect: () => void;
	destructive?: boolean;
	disabled?: boolean;
	/** Draw a separator before this item. */
	separated?: boolean;
}

/**
 * The actions of a session, shared by the header's dropdown and the sidebar's context menu, plus the
 * delete confirmation. Rename and delete run after the menu has closed and restored focus, so the
 * rename input or the dialog keeps it.
 */
export function useSessionActions(session: SessionSummary, onRename: () => void, header = false) {
	const { t } = useTranslation();
	const [deleting, setDeleting] = useState(false);
	const pending = useRef<"rename" | "delete" | undefined>(undefined);
	const app = useApp.getState;
	const saved = Boolean(session.sessionPath);
	const actions: SessionAction[] = [
		{ key: "rename", label: t("sessionMenu.rename"), onSelect: () => (pending.current = "rename") },
		...(session.archived
			? []
			: [
					{
						key: "pin",
						label: session.pinnedAt === undefined ? t("sessionMenu.pin") : t("sessionMenu.unpin"),
						disabled: !saved,
						onSelect: () => void app().setPinned(session, session.pinnedAt === undefined),
					},
				]),
		{
			key: "duplicate",
			label: header ? t("sessionMenu.duplicateSession") : t("sessionMenu.duplicate"),
			onSelect: () => void app().duplicateSession(session),
		},
		{
			key: "archive",
			label: session.archived ? t("sessionMenu.unarchive") : t("sessionMenu.archive"),
			disabled: !saved,
			separated: true,
			onSelect: () => void app().setArchived(session, !session.archived),
		},
		{
			key: "delete",
			label: header ? t("sessionMenu.deleteSession") : t("sessionMenu.delete"),
			destructive: true,
			disabled: !saved,
			onSelect: () => (pending.current = "delete"),
		},
	];
	const onCloseAutoFocus = (e: Event) => {
		if (!pending.current) return;
		e.preventDefault();
		if (pending.current === "rename") onRename();
		else setDeleting(true);
		pending.current = undefined;
	};
	const deleteDialog = (
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
	);
	return { actions, onCloseAutoFocus, deleteDialog, requestDelete: () => setDeleting(true) };
}

/** The session's actions behind a "…" button (chat header). */
export function SessionMenu({
	session,
	onRename,
	className,
	header = false,
}: {
	session: SessionSummary;
	onRename: () => void;
	className?: string;
	header?: boolean;
}) {
	const { t } = useTranslation();
	const { actions, onCloseAutoFocus, deleteDialog } = useSessionActions(session, onRename, header);
	return (
		<>
			<DropdownMenu>
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
				<DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
					{actions.map((action) => (
						<Fragment key={action.key}>
							{action.separated && <DropdownMenuSeparator />}
							<DropdownMenuItem
								variant={action.destructive ? "destructive" : "default"}
								disabled={action.disabled}
								onSelect={action.onSelect}
							>
								{action.label}
							</DropdownMenuItem>
						</Fragment>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{deleteDialog}
		</>
	);
}

/** Right-click menu with the given session actions around `children` (a sidebar row). */
export function SessionContextMenu({
	actions,
	onCloseAutoFocus,
	disabled,
	children,
}: {
	actions: SessionAction[];
	onCloseAutoFocus: (e: Event) => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={disabled}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent onCloseAutoFocus={onCloseAutoFocus}>
				{actions.map((action) => (
					<Fragment key={action.key}>
						{action.separated && <ContextMenuSeparator />}
						<ContextMenuItem
							variant={action.destructive ? "destructive" : "default"}
							disabled={action.disabled}
							onSelect={action.onSelect}
						>
							{action.label}
						</ContextMenuItem>
					</Fragment>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
}
