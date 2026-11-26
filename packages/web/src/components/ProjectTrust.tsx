import type { ProjectTrustDecision, SessionState } from "@argon/shared";
import { ChevronDown, Loader2, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayPath } from "@/lib/format";
import { useApp } from "@/stores/app";

function useTrustAction(cwd: string) {
	const setProjectTrust = useApp((s) => s.setProjectTrust);
	const [busy, setBusy] = useState<ProjectTrustDecision>();
	const run = async (decision: ProjectTrustDecision) => {
		setBusy(decision);
		try {
			await setProjectTrust(cwd, decision);
		} finally {
			setBusy(undefined);
		}
	};
	return { busy, run };
}

/** Shown while the project's trust is undecided: its .argon resources are not loaded yet. */
export function ProjectTrustBanner({ session }: { session: SessionState }) {
	const homeDir = useApp((s) => s.environment?.homeDir);
	const { busy, run } = useTrustAction(session.cwd);
	const trust = session.projectTrust;
	if (trust?.status !== "undecided") return null;

	return (
		<div role="status" className="flex items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm">
			<ShieldQuestion className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<p className="min-w-0 flex-1">
				<span className="font-medium">Trust this project?</span>{" "}
				<span className="text-muted-foreground">
					It has its own settings or extensions in <code className="font-mono text-xs">.argon</code>. They stay off
					until you trust the folder; extensions run with full access.
				</span>
			</p>
			<div className="flex shrink-0 items-center gap-1">
				<Button size="xs" variant="ghost" disabled={busy !== undefined} onClick={() => void run("deny")}>
					{busy === "deny" && <Loader2 className="animate-spin" />}
					Don’t trust
				</Button>
				<div className="flex">
					<Button size="xs" className="rounded-r-none" disabled={busy !== undefined} onClick={() => void run("trust")}>
						{busy === "trust" && <Loader2 className="animate-spin" />}
						Trust
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="xs"
								className="rounded-l-none border-l border-primary-foreground/20 px-1"
								disabled={busy !== undefined}
								aria-label="More trust options"
							>
								<ChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-72">
							{trust.parentPath && (
								<DropdownMenuItem onSelect={() => void run("trust_parent")}>
									<div className="min-w-0">
										<div>Trust parent folder</div>
										<div className="truncate font-mono text-xs text-muted-foreground">
											{displayPath(trust.parentPath, homeDir)}
										</div>
									</div>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onSelect={() => void run("trust_session")}>
								<div>
									<div>Trust for now</div>
									<div className="text-xs text-muted-foreground">Until the backend restarts</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => void run("deny_session")}>
								<div>
									<div>Not now</div>
									<div className="text-xs text-muted-foreground">Ask again after the backend restarts</div>
								</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	);
}

/** Header indicator for projects with trust-gated resources, once a decision exists. */
export function ProjectTrustIndicator({ session }: { session: SessionState }) {
	const homeDir = useApp((s) => s.environment?.homeDir);
	const { busy, run } = useTrustAction(session.cwd);
	const trust = session.projectTrust;
	if (trust?.status !== "trusted" && trust?.status !== "untrusted") return null;
	const trusted = trust.status === "trusted";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={trusted ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}
					title={trusted ? "Project trusted" : "Project not trusted"}
				>
					{busy ? <Loader2 className="animate-spin" /> : trusted ? <ShieldCheck /> : <ShieldOff />}
					{!trusted && "Untrusted"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="font-normal">
					<div className="font-medium text-foreground">{trusted ? "Project trusted" : "Project not trusted"}</div>
					<div className="text-xs text-muted-foreground">
						{trusted
							? "Settings and extensions in .argon are loaded."
							: "Settings and extensions in .argon are not loaded."}
						{trust.savedPath && (
							<>
								{" "}
								Saved for <span className="font-mono">{displayPath(trust.savedPath, homeDir)}</span>.
							</>
						)}
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{trusted ? (
					<>
						<DropdownMenuItem onSelect={() => void run("deny")}>
							<ShieldOff />
							Stop trusting this project
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void run("deny_session")}>
							<ShieldOff />
							Turn off for now
						</DropdownMenuItem>
					</>
				) : (
					<>
						<DropdownMenuItem onSelect={() => void run("trust")}>
							<ShieldCheck />
							Trust this project
						</DropdownMenuItem>
						{trust.parentPath && (
							<DropdownMenuItem onSelect={() => void run("trust_parent")}>
								<ShieldCheck />
								<span className="min-w-0 truncate">
									Trust parent folder{" "}
									<span className="font-mono text-xs text-muted-foreground">
										{displayPath(trust.parentPath, homeDir)}
									</span>
								</span>
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onSelect={() => void run("trust_session")}>
							<ShieldCheck />
							Trust for now
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
