import type { SessionState } from "@argon/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Composer } from "@/components/Composer";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { FilePanel } from "@/components/FilePanel";
import { InteractionCard } from "@/components/InteractionCard";
import { McpPanel } from "@/components/McpPanel";
import { ProjectTrustBanner, ProjectTrustIndicator } from "@/components/ProjectTrust";
import { SessionMenu, SessionNameInput } from "@/components/SessionMenu";
import { Transcript } from "@/components/Transcript";
import { displayPath, sessionTitle } from "@/lib/format";
import { useApp } from "@/stores/app";
import { findToolCallBlock } from "@/tools";

export function ChatView({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const environment = useApp((s) => s.environment);
	const summary = useApp((s) => s.sessions.find((x) => x.sessionId === session.sessionId));
	const respond = useApp((s) => s.respond);
	const sending = useApp((s) => s.sendingPrompt?.sessionId === session.sessionId);
	// A first message on its way (or a run without one) already shows in the transcript.
	const empty =
		session.items.length === 0 && !session.retry && !sending && session.status === "idle" && !session.compacting;

	const [renaming, setRenaming] = useState<string>();
	const firstUser = session.items.find((i) => i.kind === "user");
	const headerTitle =
		session.name ??
		(firstUser?.kind === "user" ? firstUser.text.split("\n")[0]?.slice(0, 80) : undefined) ??
		(summary ? sessionTitle(summary) : t("common.untitledSession"));

	return (
		<>
			<header className="window-chat-header flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<div className="min-w-0 flex-1">
					{summary && renaming === session.sessionId ? (
						<SessionNameInput session={summary} close={() => setRenaming(undefined)} />
					) : (
						<div className="truncate text-sm font-medium">{headerTitle || t("common.untitledSession")}</div>
					)}
				</div>
				<span
					className="hidden max-w-[35%] shrink truncate font-mono text-xs text-muted-foreground lg:inline"
					title={session.cwd}
				>
					{displayPath(session.cwd, environment?.homeDir)}
				</span>
				<DiagnosticsPanel session={session} />
				<ProjectTrustIndicator session={session} />
				<McpPanel mcp={session.mcp} />
				{summary && <SessionMenu header session={summary} onRename={() => setRenaming(session.sessionId)} />}
			</header>
			<ProjectTrustBanner session={session} />

			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col">
					{empty ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
							<p className="text-lg font-medium">{t("chat.welcome")}</p>
							<p className="font-mono text-xs text-muted-foreground">
								{displayPath(session.cwd, environment?.homeDir)}
							</p>
						</div>
					) : (
						<Transcript key={`transcript:${session.sessionId}`} session={session} />
					)}

					{session.pendingInteractions.length > 0 && (
						<div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-2">
							{session.pendingInteractions.map((interaction) => (
								<InteractionCard
									key={interaction.id}
									interaction={interaction}
									toolCall={
										interaction.kind === "tool_approval"
											? findToolCallBlock(session.items, interaction.toolCallId)
											: undefined
									}
									onRespond={(response) => void respond(interaction.id, response)}
								/>
							))}
						</div>
					)}

					<Composer key={`composer:${session.sessionId}`} session={session} />
				</div>
				<FilePanel sessionId={session.sessionId} />
			</div>
		</>
	);
}
