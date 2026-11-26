import type { ProjectTrustDecision, SessionState } from "@argon/shared";
import { ChevronDown, Loader2, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	const { busy, run } = useTrustAction(session.cwd);
	const trust = session.projectTrust;
	if (trust?.status !== "undecided") return null;

	return (
		<div role="status" className="flex items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm">
			<ShieldQuestion className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<p className="min-w-0 flex-1">
				<Trans
					t={t}
					i18nKey="trust.banner"
					components={{
						heading: <span className="font-medium" />,
						details: <span className="text-muted-foreground" />,
						folder: <code className="font-mono text-xs" />,
					}}
				/>
			</p>
			<div className="flex shrink-0 items-center gap-1">
				<Button size="xs" variant="ghost" disabled={busy !== undefined} onClick={() => void run("deny")}>
					{busy === "deny" && <Loader2 className="animate-spin" />}
					{t("trust.deny")}
				</Button>
				<div className="flex">
					<Button size="xs" className="rounded-r-none" disabled={busy !== undefined} onClick={() => void run("trust")}>
						{busy === "trust" && <Loader2 className="animate-spin" />}
						{t("trust.allow")}
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="xs"
								className="rounded-l-none border-l border-primary-foreground/20 px-1"
								disabled={busy !== undefined}
								aria-label={t("trust.moreOptions")}
							>
								<ChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-72">
							{trust.parentPath && (
								<DropdownMenuItem onSelect={() => void run("trust_parent")}>
									<div className="min-w-0">
										<div>{t("trust.parent")}</div>
										<div className="truncate font-mono text-xs text-muted-foreground">
											{displayPath(trust.parentPath, homeDir)}
										</div>
									</div>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onSelect={() => void run("trust_session")}>
								<div>
									<div>{t("trust.temporary")}</div>
									<div className="text-xs text-muted-foreground">{t("trust.untilRestart")}</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => void run("deny_session")}>
								<div>
									<div>{t("trust.later")}</div>
									<div className="text-xs text-muted-foreground">{t("trust.askAfterRestart")}</div>
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
	const { t } = useTranslation();
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
					title={trusted ? t("trust.trusted") : t("trust.untrusted")}
				>
					{busy ? <Loader2 className="animate-spin" /> : trusted ? <ShieldCheck /> : <ShieldOff />}
					{!trusted && t("trust.untrustedBadge")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="font-normal">
					<div className="font-medium text-foreground">{trusted ? t("trust.trusted") : t("trust.untrusted")}</div>
					<div className="text-xs text-muted-foreground">
						<Trans t={t} i18nKey={trusted ? "trust.loaded" : "trust.notLoaded"} components={{ folder: <code /> }} />
						{trust.savedPath && (
							<div>
								<Trans
									t={t}
									i18nKey="trust.savedFor"
									shouldUnescape
									tOptions={{ interpolation: { escapeValue: true } }}
									values={{ path: displayPath(trust.savedPath, homeDir) }}
									components={{ path: <code className="font-mono" /> }}
								/>
							</div>
						)}
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{trusted ? (
					<>
						<DropdownMenuItem onSelect={() => void run("deny")}>
							<ShieldOff />
							{t("trust.revoke")}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void run("deny_session")}>
							<ShieldOff />
							{t("trust.temporarilyRevoke")}
						</DropdownMenuItem>
					</>
				) : (
					<>
						<DropdownMenuItem onSelect={() => void run("trust")}>
							<ShieldCheck />
							{t("trust.trustProject")}
						</DropdownMenuItem>
						{trust.parentPath && (
							<DropdownMenuItem onSelect={() => void run("trust_parent")}>
								<ShieldCheck />
								<span className="min-w-0 truncate">
									<Trans
										t={t}
										i18nKey="trust.parentWithPath"
										shouldUnescape
										tOptions={{ interpolation: { escapeValue: true } }}
										values={{ path: displayPath(trust.parentPath, homeDir) }}
										components={{ path: <code className="font-mono text-xs text-muted-foreground" /> }}
									/>
								</span>
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onSelect={() => void run("trust_session")}>
							<ShieldCheck />
							{t("trust.temporary")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
