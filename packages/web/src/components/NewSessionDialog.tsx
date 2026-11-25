import type { DirEntry } from "@argon/shared";
import { ChevronUp, Folder, History, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { basename, displayPath } from "@/lib/format";
import { getClient, useApp } from "@/stores/app";

/**
 * Pick a project folder on the backend machine. Browsing goes through the backend (fs.listDir),
 * so this works the same for a local or a remote backend.
 */
export function NewSessionDialog({
	open,
	onOpenChange,
	initialPath,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialPath?: string;
}) {
	const environment = useApp((s) => s.environment);
	const sessions = useApp((s) => s.sessions);
	const createSession = useApp((s) => s.createSession);
	const [path, setPath] = useState("");
	const [pathInput, setPathInput] = useState("");
	const [entries, setEntries] = useState<DirEntry[]>([]);
	const [parent, setParent] = useState<string | undefined>();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);

	const recent = useMemo(() => {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const s of sessions) {
			if (s.cwd && !seen.has(s.cwd)) {
				seen.add(s.cwd);
				result.push(s.cwd);
			}
		}
		return result.slice(0, 6);
	}, [sessions]);

	const browse = async (target?: string) => {
		setLoading(true);
		setError(undefined);
		try {
			const result = await getClient().request("fs.listDir", { path: target, dirsOnly: true });
			setPath(result.path);
			setPathInput(result.path);
			setEntries(result.entries);
			setParent(result.parent);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: browse when the dialog opens
	useEffect(() => {
		if (open) void browse(initialPath ?? recent[0]);
	}, [open]);

	const create = async (cwd: string) => {
		setCreating(true);
		try {
			await createSession(cwd);
			onOpenChange(false);
		} catch {
			// toast already shown by the store
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New session</DialogTitle>
					<DialogDescription>Choose a project folder{environment ? ` on ${environment.name}` : ""}.</DialogDescription>
				</DialogHeader>

				{recent.length > 0 && (
					<div className="space-y-1.5">
						<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<History className="size-3.5" /> Recent
						</div>
						<div className="flex flex-wrap gap-1.5">
							{recent.map((cwd) => (
								<Button key={cwd} variant="outline" size="sm" onClick={() => void browse(cwd)} title={cwd}>
									{basename(cwd)}
								</Button>
							))}
						</div>
					</div>
				)}

				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						void browse(pathInput);
					}}
				>
					<Input value={pathInput} onChange={(e) => setPathInput(e.target.value)} className="font-mono text-xs" />
					<Button type="button" variant="outline" size="icon" disabled={!parent} onClick={() => void browse(parent)}>
						<ChevronUp />
					</Button>
				</form>

				<div className="h-64 overflow-y-auto rounded-lg border">
					{loading ? (
						<div className="flex h-full items-center justify-center text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
						</div>
					) : error ? (
						<p className="p-3 text-sm text-destructive">{error}</p>
					) : entries.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">No subfolders</p>
					) : (
						<ul className="p-1">
							{entries.map((entry) => (
								<li key={entry.path}>
									<button
										type="button"
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
										onClick={() => void browse(entry.path)}
									>
										<Folder className="size-4 shrink-0 text-muted-foreground" />
										<span className="truncate">{entry.name}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<DialogFooter className="items-center sm:justify-between">
					<span className="truncate font-mono text-xs text-muted-foreground" title={path}>
						{displayPath(path, environment?.homeDir)}
					</span>
					<Button onClick={() => void create(path)} disabled={!path || creating}>
						{creating && <Loader2 className="animate-spin" />}
						Start here
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
