import type { SessionState } from "@argon/shared";
import { ShieldCheck, ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModelCombobox } from "@/components/ModelCombobox";
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
import { thinkingLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

/** Shared look of the composer toolbar's pickers. */
export const toolbarButton = "h-7 px-2 text-[0.8rem] font-normal text-muted-foreground hover:text-foreground";

export function ModelPicker({ session }: { session: SessionState }) {
	const setModel = useApp((s) => s.setModel);
	const setThinkingLevel = useApp((s) => s.setThinkingLevel);
	return (
		<ModelCombobox
			value={session.model}
			cwd={session.cwd}
			onChange={(model, thinkingLevel) =>
				void setModel(model).then(() => (thinkingLevel ? setThinkingLevel(thinkingLevel) : undefined))
			}
			className={`${toolbarButton} min-w-0 max-w-48 gap-1 [&>svg]:size-3.5`}
		/>
	);
}

export function ThinkingPicker({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const setThinkingLevel = useApp((s) => s.setThinkingLevel);
	if (session.availableThinkingLevels.length <= 1) return null;
	return (
		<Select value={session.thinkingLevel} onValueChange={(v) => void setThinkingLevel(v)}>
			<SelectTrigger
				size="sm"
				title={t("chat.thinking")}
				className={`${toolbarButton} gap-1 border-none bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted/50 [&_svg]:size-3.5`}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent position="popper" align="end">
				<SelectGroup>
					<SelectLabel>{t("chat.thinking")}</SelectLabel>
					{session.availableThinkingLevels.map((level) => (
						<SelectItem key={level} value={level}>
							{thinkingLevelLabel(level, t)}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

export function PermissionPicker({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const setPermissionMode = useApp((s) => s.setPermissionMode);
	const sandbox = useApp((s) => s.environment?.sandbox);
	const ask = session.permissionMode === "ask";
	// Older backends do not report sandbox support; assume it so "ask" stays selectable.
	const sandboxDescription = !sandbox
		? t("chat.sandboxed")
		: !sandbox.supported
			? t("chat.sandboxUnavailable")
			: sandbox.reason
				? t("chat.sandboxFailed", { reason: sandbox.reason })
				: t("chat.sandboxed");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={toolbarButton}
					title={`${t("chat.permissionMode")}: ${ask ? t("chat.askChanges") : t("chat.runEverything")}`}
				>
					{ask ? <ShieldQuestion /> : <ShieldCheck className="text-amber-600 dark:text-amber-400" />}
					<span className="@max-md/toolbar:hidden">{ask ? t("chat.ask") : t("chat.auto")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>{t("chat.permissionMode")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={session.permissionMode}
					onValueChange={(v) => void setPermissionMode(v as SessionState["permissionMode"])}
				>
					<DropdownMenuRadioItem value="ask" disabled={sandbox?.supported === false}>
						<div>
							<div>{t("chat.askChanges")}</div>
							<div
								className={cn(
									"text-xs text-muted-foreground",
									sandbox?.supported && sandbox.reason && "text-destructive",
								)}
							>
								{sandboxDescription}
							</div>
						</div>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="auto">
						<div>
							<div>{t("chat.runEverything")}</div>
							<div className="text-xs text-muted-foreground">{t("chat.noApprovals")}</div>
						</div>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
