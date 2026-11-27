/** Raw editor for pi's models.json, for everything the provider form does not cover. */

import { AgentClientError } from "@argon/shared";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getClient } from "@/stores/app";

const TEMPLATE = `{
	"$schema": "https://pi.dev/schemas/models.schema.json",
	"providers": {}
}
`;

interface Loaded {
	path: string;
	text: string;
	version: string;
	error?: string;
}

export function ModelsJsonEditor({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
	const { t } = useTranslation();
	const [loaded, setLoaded] = useState<Loaded>();
	const [text, setText] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [conflict, setConflict] = useState(false);

	const load = async () => {
		setError(undefined);
		setConflict(false);
		try {
			const result = await getClient().request("models.config.get", {});
			setLoaded(result);
			setText(result.text || TEMPLATE);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload each time the dialog opens
	useEffect(() => {
		if (open) void load();
		else setLoaded(undefined);
	}, [open]);

	const save = async () => {
		if (!loaded) return;
		setSaving(true);
		setError(undefined);
		try {
			await getClient().request("models.config.set", { text, version: loaded.version });
			onOpenChange(false);
		} catch (e) {
			setConflict(e instanceof AgentClientError && e.code === "conflict");
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const dirty = loaded !== undefined && text !== (loaded.text || TEMPLATE);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[min(760px,90vh)] flex-col gap-0 p-0 sm:max-w-3xl">
				<div className="border-b px-6 py-4 pr-12">
					<DialogTitle className="text-base">{t("settings.modelsJson.title")}</DialogTitle>
					<DialogDescription className="truncate font-mono text-xs" title={loaded?.path}>
						{loaded?.path ?? "models.json"}
					</DialogDescription>
				</div>
				{loaded?.error && !dirty && (
					<p className="max-h-28 overflow-y-auto border-b bg-destructive/5 px-6 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
						{loaded.error}
					</p>
				)}
				<div className="min-h-0 flex-1 p-3">
					{loaded ? (
						<Textarea
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									void save();
								} else if (e.key === "Tab" && !e.nativeEvent.isComposing) {
									e.preventDefault();
									const el = e.currentTarget;
									const { selectionStart, selectionEnd } = el;
									const next = `${text.slice(0, selectionStart)}\t${text.slice(selectionEnd)}`;
									setText(next);
									requestAnimationFrame(() => el.setSelectionRange(selectionStart + 1, selectionStart + 1));
								}
							}}
							aria-label={t("settings.modelsJson.title")}
							spellCheck={false}
							autoComplete="off"
							className="field-sizing-fixed h-full resize-none font-mono text-xs leading-relaxed [tab-size:2] md:text-xs"
						/>
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">{error ?? t("common.loading")}</p>
					)}
				</div>
				<DialogFooter className="m-0 items-center px-6 py-3 sm:justify-between">
					<p className="min-w-0 flex-1 text-xs text-muted-foreground">
						{error && loaded ? (
							<span className="block max-h-16 overflow-y-auto font-mono whitespace-pre-wrap text-destructive">
								{error}
							</span>
						) : (
							t("settings.modelsJson.hint")
						)}
					</p>
					<div className="flex shrink-0 items-center gap-2">
						{conflict && (
							<Button type="button" variant="outline" size="sm" onClick={() => void load()}>
								<RotateCcw />
								{t("settings.modelsJson.reload")}
							</Button>
						)}
						<Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
							{t("common.cancel")}
						</Button>
						<Button type="button" size="sm" disabled={!loaded || !dirty || saving} onClick={() => void save()}>
							{saving && <Loader2 className="animate-spin" />}
							{t("common.save")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
