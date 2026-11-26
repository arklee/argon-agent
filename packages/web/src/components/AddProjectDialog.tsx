import type { DirEntry } from "@argon/shared";
import { ChevronUp, Folder, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { displayPath } from "@/lib/format";
import { getClient, useApp } from "@/stores/app";

/**
 * Add a project: pick a folder on the backend machine, then start a session in it. Browsing goes
 * through the backend (fs.listDir), so this works the same for a local or a remote backend.
 */
export function AddProjectDialog() {
	const { t } = useTranslation();
	const open = useApp((s) => s.addProjectOpen);
	const onOpenChange = useApp((s) => s.setAddProjectOpen);
	const environment = useApp((s) => s.environment);
	const sessions = useApp((s) => s.sessions);
	const addProject = useApp((s) => s.addProject);
	const [path, setPath] = useState("");
	const [pathInput, setPathInput] = useState("");
	const [entries, setEntries] = useState<DirEntry[]>([]);
	const [parent, setParent] = useState<string | undefined>();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);

	// Start next to the most recent project: new projects usually sit beside existing ones.
	const latestCwd = sessions[0]?.cwd;

	/** `up`: show the folder containing `target` (projects usually sit next to each other). */
	const browse = async (target?: string, up = false) => {
		setLoading(true);
		setError(undefined);
		try {
			let result = await getClient().request("fs.listDir", { path: target, dirsOnly: true });
			if (up && result.parent)
				result = await getClient().request("fs.listDir", { path: result.parent, dirsOnly: true });
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
		if (open) void browse(latestCwd, latestCwd !== undefined);
	}, [open]);

	const create = async (cwd: string) => {
		setCreating(true);
		try {
			await addProject(cwd);
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("common.addProject")}</DialogTitle>
					<DialogDescription>
						{environment
							? t("addProject.descriptionOn", { environment: environment.name })
							: t("addProject.description")}
					</DialogDescription>
				</DialogHeader>

				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						void browse(pathInput);
					}}
				>
					<Input
						value={pathInput}
						onChange={(e) => setPathInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
						}}
						className="font-mono text-xs"
					/>
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
						<p className="p-3 text-sm text-muted-foreground">{t("addProject.empty")}</p>
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
						{t("common.addProject")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
