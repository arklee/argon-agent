import type { SessionState } from "@argon/shared";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Composer } from "@/components/Composer";
import { ContextMeter } from "@/components/ContextMeter";
import { InteractionCard } from "@/components/InteractionCard";
import { McpPanel } from "@/components/McpPanel";
import { ModelCombobox } from "@/components/ModelCombobox";
import { SessionMenu, SessionNameInput } from "@/components/SessionMenu";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { displayPath, sessionTitle } from "@/lib/format";
import { useApp } from "@/stores/app";

function ModelPicker({ session }: { session: SessionState }) {
	const setModel = useApp((s) => s.setModel);
	return <ModelCombobox value={session.model} onChange={(model) => void setModel(model)} className="max-w-56" />;
}

function ThinkingPicker({ session }: { session: SessionState }) {
	const setThinkingLevel = useApp((s) => s.setThinkingLevel);
	if (session.availableThinkingLevels.length <= 1) return null;
	return (
		<Select value={session.thinkingLevel} onValueChange={(v) => void setThinkingLevel(v)}>
			<SelectTrigger size="sm" className="border-none bg-transparent shadow-none hover:bg-muted">
				<SelectValue />
			</SelectTrigger>
			<SelectContent position="popper" align="end">
				<SelectGroup>
					<SelectLabel>Thinking</SelectLabel>
					{session.availableThinkingLevels.map((level) => (
						<SelectItem key={level} value={level}>
							{level}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function PermissionPicker({ session }: { session: SessionState }) {
	const setPermissionMode = useApp((s) => s.setPermissionMode);
	const ask = session.permissionMode === "ask";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="text-muted-foreground">
					{ask ? <ShieldQuestion /> : <ShieldCheck className="text-amber-600 dark:text-amber-400" />}
					{ask ? "Ask" : "Auto"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>Tool permissions</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={session.permissionMode}
					onValueChange={(v) => void setPermissionMode(v as SessionState["permissionMode"])}
				>
					<DropdownMenuRadioItem value="ask">
						<div>
							<div>Ask before changes</div>
							<div className="text-xs text-muted-foreground">Read-only tools run freely</div>
						</div>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="auto">
						<div>
							<div>Run everything</div>
							<div className="text-xs text-muted-foreground">pi's default: no approvals</div>
						</div>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ChatView({ session }: { session: SessionState }) {
	const environment = useApp((s) => s.environment);
	const summary = useApp((s) => s.sessions.find((x) => x.sessionId === session.sessionId));
	const respond = useApp((s) => s.respond);

	const [renaming, setRenaming] = useState<string>();
	const firstUser = session.items.find((i) => i.kind === "user");
	const headerTitle =
		session.name ??
		(firstUser?.kind === "user" ? firstUser.text.split("\n")[0]?.slice(0, 80) : undefined) ??
		(summary ? sessionTitle(summary) : "New session");

	return (
		<>
			<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<div className="min-w-0 flex-1">
					{summary && renaming === session.sessionId ? (
						<SessionNameInput session={summary} close={() => setRenaming(undefined)} />
					) : (
						<div className="truncate text-sm font-medium">{headerTitle || "New session"}</div>
					)}
				</div>
				<span
					className="hidden max-w-[35%] shrink truncate font-mono text-xs text-muted-foreground lg:inline"
					title={session.cwd}
				>
					{displayPath(session.cwd, environment?.homeDir)}
				</span>
				<ContextMeter session={session} />
				<McpPanel mcp={session.mcp} />
				<PermissionPicker session={session} />
				<ThinkingPicker session={session} />
				<ModelPicker session={session} />
				{summary && <SessionMenu header session={summary} onRename={() => setRenaming(session.sessionId)} />}
			</header>

			{session.items.length === 0 && !session.retry ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
					<p className="text-lg font-medium">What should we work on?</p>
					<p className="font-mono text-xs text-muted-foreground">{displayPath(session.cwd, environment?.homeDir)}</p>
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
							onRespond={(response) => void respond(interaction.id, response)}
						/>
					))}
				</div>
			)}

			<Composer key={`composer:${session.sessionId}`} session={session} />
		</>
	);
}
