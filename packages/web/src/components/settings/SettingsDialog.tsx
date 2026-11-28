import type { PermissionRule, PiSettings, ProjectPiSettings, ResourceSettings } from "@argon/shared";
import {
	Archive,
	FolderTree,
	KeyRound,
	type LucideIcon,
	Plug,
	Puzzle,
	RotateCcw,
	ShieldCheck,
	SlidersHorizontal,
	Store,
	Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ModelCombobox } from "@/components/ModelCombobox";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { ArchivedSection } from "@/components/settings/ArchivedSection";
import { EnabledModelsEditor, enabledModelsSummary } from "@/components/settings/EnabledModelsEditor";
import { ExtensionsSection } from "@/components/settings/ExtensionsSection";
import { FontPicker } from "@/components/settings/FontPicker";
import { McpSection } from "@/components/settings/McpSection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { Choice, Group, Loading, Row, ScopeSwitch } from "@/components/settings/parts";
import { SearchToolsSection } from "@/components/settings/SearchToolsSection";
import { presetLabel } from "@/components/ToolPresetPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getLanguagePreference, type LanguagePreference, setLanguagePreference, t } from "@/i18n";
import {
	clampFontSize,
	DEFAULT_SIZE,
	type FontRole,
	getFonts,
	MAX_FONT_SIZE,
	MIN_FONT_SIZE,
	setFont,
} from "@/lib/fonts";
import { displayPath, formatNumber, thinkingLevelLabel } from "@/lib/format";
import { type ProcessFold, setProcessFold, useProcessFold } from "@/lib/process-fold";
import { setThemePreference, type ThemePreference, useThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { type SettingsSection, useSettings } from "@/stores/settings";

const SECTIONS: { id: SettingsSection; icon: LucideIcon }[] = [
	{ id: "general", icon: SlidersHorizontal },
	{ id: "accounts", icon: KeyRound },
	{ id: "mcp", icon: Plug },
	{ id: "permissions", icon: ShieldCheck },
	{ id: "plugins", icon: Store },
	{ id: "extensions", icon: Puzzle },
	{ id: "resources", icon: FolderTree },
	{ id: "archived", icon: Archive },
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
						{section === "mcp" && <McpSection />}
						{section === "permissions" && <PermissionsSection />}
						{section === "plugins" && <PluginsSection />}
						{section === "extensions" && <ExtensionsSection />}
						{section === "resources" && <ResourcesSection />}
						{section === "archived" && <ArchivedSection />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** The pi settings of the scope the dialog edits: global, or the project's file over the global values. */
function useScopedPi() {
	const scope = useSettings((s) => s.scope);
	const settings = useSettings((s) => s.settings);
	const updatePi = useSettings((s) => s.updatePi);
	const updateProject = useSettings((s) => s.updateProject);
	const project = scope === "project" ? settings?.project : undefined;
	const values: PiSettings | undefined = settings && (project ? { ...settings.pi, ...project.values } : settings.pi);
	return {
		project,
		values,
		overridden: (key: keyof ProjectPiSettings) => project !== undefined && key in project.values,
		update: (patch: Partial<ProjectPiSettings>) => (project ? updateProject(patch) : updatePi(patch)),
		reset: (key: keyof ProjectPiSettings) => updateProject({}, [key]),
	};
}

/** A pi settings row that, in project scope, marks project overrides and can reset them to the global value. */
function ScopedRow({
	settingKey,
	label,
	description,
	children,
}: {
	settingKey: keyof ProjectPiSettings;
	label: string;
	description?: string;
	children: ReactNode;
}) {
	const { overridden, reset } = useScopedPi();
	return (
		<OverrideRow
			label={label}
			description={description}
			isSet={overridden(settingKey)}
			onReset={() => void reset(settingKey)}
		>
			{children}
		</OverrideRow>
	);
}

/** A row whose value may be set for the project (marked, with a button back to the global value). */
export function OverrideRow({
	label,
	description,
	isSet,
	onReset,
	children,
}: {
	label: string;
	description?: string;
	isSet: boolean;
	onReset(): void;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<Row
			label={label}
			description={
				isSet ? (
					<>
						{description}
						<span className="mt-0.5 flex items-center gap-1 text-primary">
							<span className="size-1.5 rounded-full bg-primary" />
							{t("settings.general.setForProject")}
						</span>
					</>
				) : (
					description
				)
			}
		>
			{children}
			{isSet && (
				<Button
					variant="ghost"
					size="icon-xs"
					className="ml-1 text-muted-foreground"
					aria-label={t("settings.general.useGlobal")}
					title={t("settings.general.useGlobal")}
					onClick={onReset}
				>
					<RotateCcw />
				</Button>
			)}
		</Row>
	);
}

type BooleanSetting = "compaction" | "retry" | "enableSkillCommands" | "imageAutoResize" | "blockImages";

function Toggle({ settingKey }: { settingKey: BooleanSetting }) {
	const { values, update } = useScopedPi();
	return (
		<Switch
			checked={values?.[settingKey] === true}
			onCheckedChange={(checked) => void update({ [settingKey]: checked })}
		/>
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
	const { values, update } = useScopedPi();
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
			value={values?.defaultModel}
			placeholder={t("settings.general.notSet")}
			onChange={(defaultModel) => void update({ defaultModel })}
			manageProviders={false}
			className="max-w-64 border shadow-xs"
		/>
	);
}

function EnabledModels() {
	const { t } = useTranslation();
	const { values, update } = useScopedPi();
	const [editing, setEditing] = useState(false);
	const patterns = values?.enabledModels ?? [];
	return (
		<>
			<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
				{enabledModelsSummary(patterns, t)}
			</Button>
			<EnabledModelsEditor
				open={editing}
				onOpenChange={setEditing}
				patterns={patterns}
				onChange={(enabledModels) => void update({ enabledModels })}
			/>
		</>
	);
}

/** One font role: a family (any installed font, with suggestions) and a size in px, applied as you type. */
function FontInput({ role }: { role: FontRole }) {
	const { t } = useTranslation();
	const [pref, setPref] = useState(() => getFonts()[role]);
	const [sizeDraft, setSizeDraft] = useState(String(pref.size));
	const apply = (next: typeof pref) => {
		setPref(next);
		setFont(role, next);
	};
	const commitSize = () => {
		const typed = Number(sizeDraft);
		const size = sizeDraft.trim() === "" ? DEFAULT_SIZE[role] : clampFontSize(typed, pref.size);
		setSizeDraft(String(size));
		if (size !== pref.size) apply({ ...pref, size });
	};
	return (
		<div className="flex items-center gap-1.5">
			<FontPicker
				role={role}
				value={pref.family}
				ariaLabel={t(`settings.general.font.${role}`)}
				onChange={(family) => apply({ ...pref, family })}
			/>
			<Input
				type="number"
				inputMode="decimal"
				min={MIN_FONT_SIZE}
				max={MAX_FONT_SIZE}
				step={0.5}
				value={sizeDraft}
				aria-label={t("settings.general.fontSize", { role: t(`settings.general.font.${role}`) })}
				onChange={(e) => {
					setSizeDraft(e.target.value);
					// Valid sizes apply while typing or using the arrows; anything else is clamped on commit.
					const value = Number(e.target.value);
					if (e.target.value !== "" && value === clampFontSize(value, pref.size)) apply({ ...pref, size: value });
				}}
				onBlur={commitSize}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.nativeEvent.isComposing) commitSize();
				}}
				className="h-8 w-20 text-right tabular-nums"
			/>
			<span className="text-sm text-muted-foreground">px</span>
		</div>
	);
}

/** Where project settings are saved, and why they might not apply. */
function ProjectScopeNote() {
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	const { project } = useScopedPi();
	if (!project) return null;
	return (
		<div className="mb-5 space-y-2 text-xs text-muted-foreground">
			<p>
				<Trans
					t={t}
					i18nKey="settings.general.projectFile"
					shouldUnescape
					tOptions={{ interpolation: { escapeValue: true } }}
					values={{ path: displayPath(project.path, homeDir) }}
					components={{ path: <code className="font-mono break-all" /> }}
				/>
			</p>
			<p>{t("settings.general.projectPrivate")}</p>
			{!project.trusted && (
				<p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
					{t("settings.general.projectUntrusted")}
				</p>
			)}
			{project.error && (
				<p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
					{t("settings.general.projectInvalid", { error: project.error })}
				</p>
			)}
		</div>
	);
}

function GeneralSection() {
	const { t } = useTranslation();
	const [preference, setPreference] = useState(getLanguagePreference);
	const theme = useThemePreference();
	const processFold = useProcessFold();
	const scope = useSettings((s) => s.scope);
	return (
		<>
			<ScopeSwitch />
			{scope === "project" ? (
				<ProjectScopeNote />
			) : (
				<Group title={t("settings.general.appearance")}>
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
					<Row label={t("settings.general.theme")}>
						<Choice<ThemePreference>
							ariaLabel={t("settings.general.theme")}
							value={theme}
							options={[
								{ value: "system", label: t("settings.general.themeSystem") },
								{ value: "light", label: t("settings.general.themeLight") },
								{ value: "dark", label: t("settings.general.themeDark") },
							]}
							onChange={setThemePreference}
						/>
					</Row>
					<Row
						label={t("settings.general.processFold")}
						description={t(`settings.general.processFoldDescription.${processFold}`)}
					>
						<Choice<ProcessFold>
							ariaLabel={t("settings.general.processFold")}
							value={processFold}
							options={[
								{ value: "auto", label: t("settings.general.processFoldAuto") },
								{ value: "expanded", label: t("settings.general.processFoldExpanded") },
								{ value: "collapsed", label: t("settings.general.processFoldCollapsed") },
							]}
							onChange={setProcessFold}
						/>
					</Row>
					{(["ui", "content", "code"] as const).map((role) => (
						<Row
							key={role}
							label={t(`settings.general.font.${role}`)}
							description={t(`settings.general.fontDescription.${role}`)}
						>
							<FontInput role={role} />
						</Row>
					))}
				</Group>
			)}
			<GeneralDefaults />
		</>
	);
}

function GeneralDefaults() {
	const { t } = useTranslation();
	const { project, values: pi, update } = useScopedPi();
	const argon = useSettings((s) => s.settings?.argon);
	const updatePi = useSettings((s) => s.updatePi);
	const updateArgon = useSettings((s) => s.updateArgon);
	const argonProject = useSettings((s) => s.settings?.argonProject);
	const updateArgonProject = useSettings((s) => s.updateArgonProject);
	const presets = useApp((s) => s.toolPresets);
	const sandbox = useApp((s) => s.environment?.sandbox);
	const sandboxSupported = sandbox?.supported !== false;
	if (!pi) return <Loading />;
	// In project scope, tool preset and permission mode are the project's private Argon settings (D16).
	const global = project === undefined;
	const queueModes = [
		{ value: "one-at-a-time", label: t("settings.general.oneAtATime") },
		{ value: "all", label: t("settings.general.allAtOnce") },
	] satisfies { value: NonNullable<PiSettings["steeringMode"]>; label: string }[];
	return (
		<>
			<Group title={t("settings.general.model")}>
				<ScopedRow
					settingKey="defaultModel"
					label={t("settings.general.defaultModel")}
					description={t("settings.general.defaultModelDescription")}
				>
					<DefaultModel />
				</ScopedRow>
				<ScopedRow
					settingKey="defaultThinkingLevel"
					label={t("settings.general.defaultThinking")}
					description={t("settings.general.defaultThinkingDescription")}
				>
					<Choice
						value={pi.defaultThinkingLevel}
						placeholder={t("settings.general.notSet")}
						options={THINKING.map((level) => ({ value: level, label: thinkingLevelLabel(level, t) }))}
						onChange={(defaultThinkingLevel) => void update({ defaultThinkingLevel })}
					/>
				</ScopedRow>
				<ScopedRow
					settingKey="enabledModels"
					label={t("settings.general.enabledModels")}
					description={t("settings.general.enabledModelsDescription")}
				>
					<EnabledModels />
				</ScopedRow>
			</Group>
			{argon && (
				<Group title={t("settings.general.toolsAndPermissions")}>
					<OverrideRow
						label={t("settings.general.toolPreset")}
						description={t("settings.general.toolPresetDescription")}
						isSet={!global && argonProject?.toolPreset !== undefined}
						onReset={() => void updateArgonProject({}, ["toolPreset"])}
					>
						<Choice
							value={(global ? undefined : argonProject?.toolPreset) ?? argon.defaultToolPreset}
							options={presets.map((preset) => ({ value: preset.id, label: presetLabel(preset.id, presets, t) }))}
							onChange={(toolPreset) =>
								void (global ? updateArgon({ defaultToolPreset: toolPreset }) : updateArgonProject({ toolPreset }))
							}
						/>
					</OverrideRow>
					<OverrideRow
						label={t("settings.permissions.defaultMode")}
						description={
							sandboxSupported ? t("settings.permissions.defaultModeDescription") : t("chat.sandboxUnavailable")
						}
						isSet={!global && argonProject?.permissionMode !== undefined}
						onReset={() => void updateArgonProject({}, ["permissionMode"])}
					>
						<Choice
							ariaLabel={t("settings.permissions.defaultMode")}
							value={(global ? undefined : argonProject?.permissionMode) ?? argon.permissions.defaultMode}
							options={[
								{ value: "ask", label: t("chat.askChanges"), disabled: !sandboxSupported },
								{ value: "auto", label: t("chat.runEverything") },
							]}
							onChange={(defaultMode) =>
								void (global
									? updateArgon({ permissions: { ...argon.permissions, defaultMode } })
									: updateArgonProject({ permissionMode: defaultMode }))
							}
						/>
					</OverrideRow>
				</Group>
			)}
			<Group title={t("settings.general.conversation")}>
				<ScopedRow
					settingKey="steeringMode"
					label={t("settings.general.steering")}
					description={t("settings.general.steeringDescription")}
				>
					<Choice
						value={pi.steeringMode}
						options={queueModes}
						onChange={(steeringMode) => void update({ steeringMode })}
					/>
				</ScopedRow>
				<ScopedRow
					settingKey="followUpMode"
					label={t("settings.general.followUp")}
					description={t("settings.general.followUpDescription")}
				>
					<Choice
						value={pi.followUpMode}
						options={queueModes}
						onChange={(followUpMode) => void update({ followUpMode })}
					/>
				</ScopedRow>
				<ScopedRow
					settingKey="compaction"
					label={t("settings.general.autoCompact")}
					description={t("settings.general.autoCompactDescription")}
				>
					<Toggle settingKey="compaction" />
				</ScopedRow>
				<ScopedRow
					settingKey="retry"
					label={t("settings.general.autoRetry")}
					description={t("settings.general.autoRetryDescription")}
				>
					<Toggle settingKey="retry" />
				</ScopedRow>
				<ScopedRow
					settingKey="enableSkillCommands"
					label={t("settings.general.skillCommands")}
					description={t("settings.general.skillCommandsDescription")}
				>
					<Toggle settingKey="enableSkillCommands" />
				</ScopedRow>
			</Group>
			<Group title={t("settings.general.images")}>
				<ScopedRow
					settingKey="imageAutoResize"
					label={t("settings.general.resize")}
					description={t("settings.general.resizeDescription")}
				>
					<Toggle settingKey="imageAutoResize" />
				</ScopedRow>
				<ScopedRow
					settingKey="blockImages"
					label={t("settings.general.blockImages")}
					description={t("settings.general.blockImagesDescription")}
				>
					<Toggle settingKey="blockImages" />
				</ScopedRow>
			</Group>
			<Group title={t("settings.general.shell")}>
				<ScopedRow
					settingKey="shellPath"
					label={t("settings.general.shell")}
					description={t("settings.general.shellDescription")}
				>
					<TextSetting
						value={pi.shellPath}
						placeholder="/bin/bash"
						onSave={(shellPath) => void update({ shellPath })}
					/>
				</ScopedRow>
				<ScopedRow
					settingKey="shellCommandPrefix"
					label={t("settings.general.commandPrefix")}
					description={t("settings.general.commandPrefixDescription")}
				>
					<TextSetting
						value={pi.shellCommandPrefix}
						placeholder="source ~/.profile &&"
						onSave={(shellCommandPrefix) => void update({ shellCommandPrefix })}
					/>
				</ScopedRow>
			</Group>
			{global && (
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
			)}
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
	const sandbox = useApp((s) => s.environment?.sandbox);
	if (!argon) return <Loading />;
	const { permissions } = argon;
	// Older backends do not report sandbox support (or the policy); assume support as before.
	const sandboxSupported = sandbox?.supported !== false;
	const allowedDomains = argon.sandbox?.allowedDomains ?? [];
	const removeHost = (host: string) =>
		void updateArgon({ sandbox: { ...argon.sandbox, allowedDomains: allowedDomains.filter((h) => h !== host) } });
	const remove = (rule: PermissionRule) =>
		void updateArgon({
			permissions: {
				...permissions,
				rules: permissions.rules.filter((r) => r.tool !== rule.tool || r.command !== rule.command),
			},
		});
	return (
		<>
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
			{sandboxSupported && (
				<Group title={t("settings.permissions.allowedHosts")}>
					<p className="pt-2 text-xs text-muted-foreground">{t("settings.permissions.allowedHostsDescription")}</p>
					{allowedDomains.length === 0 ? (
						<p className="py-4 text-sm text-muted-foreground">{t("settings.permissions.noHosts")}</p>
					) : (
						allowedDomains.map((host) => (
							<div key={host} className="flex items-center gap-3 py-2.5">
								<span className="min-w-0 flex-1 truncate font-mono text-sm" title={host}>
									{host}
								</span>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={t("settings.permissions.removeHost", { host })}
									onClick={() => removeHost(host)}
								>
									<Trash2 />
								</Button>
							</div>
						))
					)}
				</Group>
			)}
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
	// Search tools that need fixing come first (the failure toast opens this page); ready ones are one line at the end.
	const toolsPending = useSettings((s) => s.tools?.tools.some((tool) => tool.state !== "ready") ?? false);
	return (
		<>
			{toolsPending && <SearchToolsSection />}
			{resources ? (
				<>
					{resources.map((scope) => (
						<ResourceScope key={scope.scope} scope={scope} />
					))}
					<p className="mb-6 text-xs text-muted-foreground">
						{cwd ? t("settings.resources.readOnly") : t("settings.resources.readOnlyAndOpenSession")}
					</p>
				</>
			) : (
				<Loading />
			)}
			{!toolsPending && <SearchToolsSection />}
		</>
	);
}
