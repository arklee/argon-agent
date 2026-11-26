import type { SessionState, ToolPresetId, ToolPresetInfo } from "@argon/shared";
import { Blocks, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import type { t as translate } from "@/i18n";
import { useApp } from "@/stores/app";

/** Built-in presets have translated labels; others (from a newer backend) use the backend's English label. */
export function presetLabel(id: ToolPresetId, presets: readonly ToolPresetInfo[], t: typeof translate): string {
	switch (id) {
		case "classic":
			return t("presets.labels.classic");
		case "codemode":
			return t("presets.labels.codemode");
		case "codemode_only":
			return t("presets.labels.codemode_only");
		default:
			return presets.find((p) => p.id === id)?.label ?? id;
	}
}

export function presetDescription(preset: ToolPresetInfo, t: typeof translate): string {
	switch (preset.id) {
		case "classic":
			return t("presets.descriptions.classic");
		case "codemode":
			return t("presets.descriptions.codemode");
		case "codemode_only":
			return t("presets.descriptions.codemode_only");
		default:
			return preset.description;
	}
}

/** Header picker for the session's tool preset (decisions D13). Hidden when the backend has none. */
export function ToolPresetPicker({ session }: { session: SessionState }) {
	const { t } = useTranslation();
	const presets = useApp((s) => s.toolPresets);
	const setToolPreset = useApp((s) => s.setToolPreset);
	if (presets.length === 0 || !session.toolPreset) return null;
	const pending = Boolean(session.toolPresetPending);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground"
					title={pending ? t("presets.pending") : t("presets.title")}
				>
					{pending ? <Clock className="text-amber-600 dark:text-amber-400" /> : <Blocks />}
					{presetLabel(session.toolPreset, presets, t)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel>{t("presets.title")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup value={session.toolPreset} onValueChange={(v) => void setToolPreset(v)}>
					{presets.map((preset) => (
						<DropdownMenuRadioItem key={preset.id} value={preset.id}>
							<div>
								<div>{presetLabel(preset.id, presets, t)}</div>
								<div className="text-xs text-muted-foreground">{presetDescription(preset, t)}</div>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<p className="px-2 py-1.5 text-xs text-muted-foreground">
					{pending ? `${t("presets.pending")}. ` : ""}
					{t("presets.applyNote")}
				</p>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
