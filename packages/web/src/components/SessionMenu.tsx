import type { SessionSummary } from "@argon/shared";
import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
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
	const [name, setName] = useState(session.name || sessionTitle(session));
	return (
		<Input
			aria-label="Session name"
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
						aria-label={`Actions for ${sessionTitle(session)}`}
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
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void useApp.getState().duplicateSession(session)}>
						{header ? "Duplicate session" : "Duplicate"}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						disabled={!session.sessionPath}
						onSelect={() => {
							pendingAction.current = "delete";
						}}
					>
						{header ? "Delete session" : "Delete"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={deleting} onOpenChange={setDeleting}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete session?</DialogTitle>
						<DialogDescription>This removes the session file.</DialogDescription>
					</DialogHeader>
					<p className="truncate text-sm">{sessionTitle(session)}</p>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleting(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setDeleting(false);
								void useApp.getState().deleteSession(session);
							}}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
