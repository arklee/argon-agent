import type { PermissionRule, PiSettings, ResourceSettings } from "@argon/shared";
import { FolderTree, KeyRound, type LucideIcon, Puzzle, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelCombobox } from "@/components/ModelCombobox";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { Group, Loading, Row } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getLanguagePreference, type LanguagePreference, setLanguagePreference, t } from "@/i18n";
import { formatNumber, thinkingLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { type SettingsSection, useSettings } from "@/stores/settings";

const SECTIONS: { id: SettingsSection; icon: LucideIcon }[] = [
	{ id: "general", icon: SlidersHorizontal },
	{ id: "accounts", icon: KeyRound },
	{ id: "permissions", icon: ShieldCheck },
	{ id: "plugins", icon: Puzzle },
	{ id: "resources", icon: FolderTree },
];

export function SettingsDialog() {
	const { t } = useTranslation();
	const open = useSettings((s) => s.open);
	const section = useSettings((s) => s.section);
	const setSection = useSettings((s) => s.setSection);
	const close = useSettings((s) => s.close);
	const environment = useApp((s) => s.environment);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="flex h-[min(720px,88vh)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
				<nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/40 p-3">
					<DialogTitle className="px-2 pt-1 pb-3 text-base">{t("settings.title")}</DialogTitle>
					{SECTIONS.map(({ id, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => setSection(id)}
							aria-current={id === section ? "page" : undefined}
							className={cn(
								"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
								id === section && "bg-background font-medium text-foreground shadow-xs hover:bg-background",
							)}
						>
							<Icon className="size-4" />
							{t(`settings.${id}.title`)}
						</button>
					))}
					<div className="flex-1" />
					{environment && (
						<p className="truncate px-2 text-xs text-muted-foreground" title={environment.homeDir}>
							{t("settings.backend", { name: environment.name })}
						</p>
					)}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="border-b px-6 py-4 pr-12">
						<h2 className="text-base font-semibold">{t(`settings.${section}.title`)}</h2>
						<DialogDescription className="text-xs">{t(`settings.${section}.description`)}</DialogDescription>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
						{section === "general" && <GeneralSection />}
						{section === "accounts" && <AccountsSection />}
						{section === "permissions" && <PermissionsSection />}
						{section === "plugins" && <PluginsSection />}
						{section === "resources" && <ResourcesSection />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Toggle({ settingKey }: { settingKey: keyof PiSettings }) {
	const pi = useSettings((s) => s.settings?.pi);
	const updatePi = useSettings((s) => s.updatePi);
	return (
		<Switch
			checked={pi?.[settingKey] === true}
			onCheckedChange={(checked) => void updatePi({ [settingKey]: checked })}
		/>
	);
}

function Choice<T extends string>({
	value,
	options,
	onChange,
	placeholder,
	ariaLabel,
}: {
	value: T | undefined;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	placeholder?: string;
	ariaLabel?: string;
}) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as T)}>
			<SelectTrigger size="sm" className="min-w-40" aria-label={ariaLabel}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent position="popper" align="end">
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** A text setting saved on blur or Enter. */
function TextSetting({
	value,
	placeholder,
	onSave,
}: {
	value: string | undefined;
	placeholder?: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value ?? "");
	useEffect(() => setDraft(value ?? ""), [value]);
	const commit = () => {
		if (draft.trim() !== (value ?? "")) onSave(draft.trim());
	};
	return (
		<Input
			value={draft}
			placeholder={placeholder}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
			}}
			className="h-8 w-64 font-mono text-xs"
		/>
	);
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

function DefaultModel() {
	const { t } = useTranslation();
	const models = useApp((s) => s.models);
	const current = useSettings((s) => s.settings?.pi.defaultModel);
	const updatePi = useSettings((s) => s.updatePi);
	const show = useSettings((s) => s.setSection);
	if (models.length === 0) {
		return (
			<Button variant="outline" size="sm" onClick={() => show("accounts")}>
				{t("settings.general.connectProvider")}
			</Button>
		);
	}
	return (
		<ModelCombobox
			value={current}
			placeholder={t("settings.general.notSet")}
			onChange={(defaultModel) => void updatePi({ defaultModel })}
			manageProviders={false}
			className="max-w-64 border shadow-xs"
		/>
	);
}

function GeneralSection() {
	const { t } = useTranslation();
	const [preference, setPreference] = useState(getLanguagePreference);
	return (
		<>
			<Group>
				<Row label={t("settings.general.language")}>
					<Choice<LanguagePreference>
						ariaLabel={t("settings.general.language")}
						value={preference}
						options={[
							{ value: "system", label: t("settings.general.systemLanguage") },
							{ value: "en", label: t("settings.general.english") },
							{ value: "zh-CN", label: t("settings.general.simplifiedChinese") },
						]}
						onChange={(value) => {
							setPreference(value);
							void setLanguagePreference(value);
						}}
					/>
				</Row>
			</Group>
			<GeneralDefaults />
		</>
	);
}

function GeneralDefaults() {
	const { t } = useTranslation();
	const pi = useSettings((s) => s.settings?.pi);
	const updatePi = useSettings((s) => s.updatePi);
	if (!pi) return <Loading />;
	const queueModes = [
		{ value: "one-at-a-time", label: t("settings.general.oneAtATime") },
		{ value: "all", label: t("settings.general.allAtOnce") },
	] satisfies { value: NonNullable<PiSettings["steeringMode"]>; label: string }[];
	return (
		<>
			<Group title={t("settings.general.model")}>
				<Row label={t("settings.general.defaultModel")} description={t("settings.general.defaultModelDescription")}>
					<DefaultModel />
				</Row>
				<Row
					label={t("settings.general.defaultThinking")}
					description={t("settings.general.defaultThinkingDescription")}
				>
					<Choice
						value={pi.defaultThinkingLevel}
						placeholder={t("settings.general.notSet")}
						options={THINKING.map((level) => ({ value: level, label: thinkingLevelLabel(level, t) }))}
						onChange={(defaultThinkingLevel) => void updatePi({ defaultThinkingLevel })}
					/>
				</Row>
			</Group>
			<Group title={t("settings.general.conversation")}>
				<Row label={t("settings.general.steering")} description={t("settings.general.steeringDescription")}>
					<Choice
						value={pi.steeringMode}
						options={queueModes}
						onChange={(steeringMode) => void updatePi({ steeringMode })}
					/>
				</Row>
				<Row label={t("settings.general.followUp")} description={t("settings.general.followUpDescription")}>
					<Choice
						value={pi.followUpMode}
						options={queueModes}
						onChange={(followUpMode) => void updatePi({ followUpMode })}
					/>
				</Row>
				<Row label={t("settings.general.autoCompact")} description={t("settings.general.autoCompactDescription")}>
					<Toggle settingKey="compaction" />
				</Row>
				<Row label={t("settings.general.autoRetry")} description={t("settings.general.autoRetryDescription")}>
					<Toggle settingKey="retry" />
				</Row>
				<Row label={t("settings.general.skillCommands")} description={t("settings.general.skillCommandsDescription")}>
					<Toggle settingKey="enableSkillCommands" />
				</Row>
			</Group>
			<Group title={t("settings.general.images")}>
				<Row label={t("settings.general.resize")} description={t("settings.general.resizeDescription")}>
					<Toggle settingKey="imageAutoResize" />
				</Row>
				<Row label={t("settings.general.blockImages")} description={t("settings.general.blockImagesDescription")}>
					<Toggle settingKey="blockImages" />
				</Row>
			</Group>
			<Group title={t("settings.general.shell")}>
				<Row label={t("settings.general.shell")} description={t("settings.general.shellDescription")}>
					<TextSetting
						value={pi.shellPath}
						placeholder="/bin/bash"
						onSave={(shellPath) => void updatePi({ shellPath })}
					/>
				</Row>
				<Row label={t("settings.general.commandPrefix")} description={t("settings.general.commandPrefixDescription")}>
					<TextSetting
						value={pi.shellCommandPrefix}
						placeholder="source ~/.profile &&"
						onSave={(shellCommandPrefix) => void updatePi({ shellCommandPrefix })}
					/>
				</Row>
			</Group>
			<Group title={t("settings.general.projects")}>
				<Row label={t("settings.general.trustNew")} description={t("settings.general.trustNewDescription")}>
					<Choice
						value={pi.defaultProjectTrust}
						options={[
							{ value: "ask", label: t("settings.general.ask") },
							{ value: "always", label: t("settings.general.always") },
							{ value: "never", label: t("settings.general.never") },
						]}
						onChange={(defaultProjectTrust) => void updatePi({ defaultProjectTrust })}
					/>
				</Row>
			</Group>
		</>
	);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function describeRule(rule: PermissionRule): string {
	if (rule.command !== undefined) return rule.command;
	return rule.tool === "bash" ? t("settings.permissions.anyBash") : rule.tool;
}

function PermissionsSection() {
	const { t } = useTranslation();
	const argon = useSettings((s) => s.settings?.argon);
	const updateArgon = useSettings((s) => s.updateArgon);
	if (!argon) return <Loading />;
	const { permissions } = argon;
	const remove = (rule: PermissionRule) =>
		void updateArgon({
			permissions: {
				...permissions,
				rules: permissions.rules.filter((r) => r.tool !== rule.tool || r.command !== rule.command),
			},
		});
	return (
		<>
			<Group>
				<Row
					label={t("settings.permissions.defaultMode")}
					description={t("settings.permissions.defaultModeDescription")}
				>
					<Choice
						value={permissions.defaultMode}
						options={[
							{ value: "ask", label: t("settings.permissions.ask") },
							{ value: "auto", label: t("settings.permissions.auto") },
						]}
						onChange={(defaultMode) => void updateArgon({ permissions: { ...permissions, defaultMode } })}
					/>
				</Row>
			</Group>
			<Group title={t("settings.permissions.alwaysAllowed")}>
				{permissions.rules.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">{t("settings.permissions.noRules")}</p>
				) : (
					permissions.rules.map((rule) => (
						<div key={`${rule.tool}\0${rule.command ?? ""}`} className="flex items-center gap-3 py-2.5">
							<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{rule.tool}</span>
							<span className="min-w-0 flex-1 truncate font-mono text-sm" title={describeRule(rule)}>
								{rule.command !== undefined ? (
									<>
										{rule.command}
										<span className="text-muted-foreground"> …</span>
									</>
								) : (
									<span className="font-sans text-muted-foreground">{t("settings.permissions.everyCall")}</span>
								)}
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={t("settings.permissions.remove", { rule: describeRule(rule) })}
								onClick={() => remove(rule)}
							>
								<Trash2 />
							</Button>
						</div>
					))
				)}
			</Group>
			<p className="text-xs text-muted-foreground">{t("settings.permissions.commandMatching")}</p>
		</>
	);
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function ResourceList({ label, items }: { label: string; items: string[] }) {
	return (
		<div className="py-3">
			<div className="text-sm">
				{label} <span className="text-muted-foreground">{formatNumber(items.length)}</span>
			</div>
			{items.length > 0 && (
				<ul className="mt-1.5 space-y-1">
					{items.map((item) => (
						<li key={item} className="truncate font-mono text-xs text-muted-foreground" title={item}>
							{item}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ResourceScope({ scope }: { scope: ResourceSettings }) {
	const { t } = useTranslation();
	return (
		<Group title={scope.scope === "global" ? t("settings.resources.global") : t("settings.resources.project")}>
			<div className="truncate py-2.5 font-mono text-xs text-muted-foreground" title={scope.path}>
				{scope.path}
			</div>
			<ResourceList label={t("settings.resources.packages")} items={scope.packages} />
			<ResourceList label={t("settings.resources.extensions")} items={scope.extensions} />
			<ResourceList label={t("settings.resources.skills")} items={scope.skills} />
			<ResourceList label={t("settings.resources.prompts")} items={scope.prompts} />
		</Group>
	);
}

function ResourcesSection() {
	const { t } = useTranslation();
	const resources = useSettings((s) => s.settings?.resources);
	const cwd = useSettings((s) => s.cwd);
	if (!resources) return <Loading />;
	return (
		<>
			{resources.map((scope) => (
				<ResourceScope key={scope.scope} scope={scope} />
			))}
			<p className="text-xs text-muted-foreground">
				{cwd ? t("settings.resources.readOnly") : t("settings.resources.readOnlyAndOpenSession")}
			</p>
		</>
	);
}
