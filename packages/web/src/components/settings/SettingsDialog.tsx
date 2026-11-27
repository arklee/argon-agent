import type { PermissionRule, PiSettings, ProjectPiSettings, ResourceSettings } from "@argon/shared";
import {
	FolderTree,
	KeyRound,
	type LucideIcon,
	Plug,
	Puzzle,
	RotateCcw,
	ShieldCheck,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ModelCombobox } from "@/components/ModelCombobox";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { EnabledModelsEditor, enabledModelsSummary } from "@/components/settings/EnabledModelsEditor";
import { McpSection } from "@/components/settings/McpSection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { Group, Loading, Row, ScopeSwitch } from "@/components/settings/parts";
import { presetLabel } from "@/components/ToolPresetPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getLanguagePreference, type LanguagePreference, setLanguagePreference, t } from "@/i18n";
import { displayPath, formatNumber, thinkingLevelLabel } from "@/lib/format";
import { clampTextSize, getTextSize, MAX_TEXT_SIZE, MIN_TEXT_SIZE, setTextSize } from "@/lib/text-size";
import { setThemePreference, type ThemePreference, useThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { type SettingsSection, useSettings } from "@/stores/settings";

const SECTIONS: { id: SettingsSection; icon: LucideIcon }[] = [
	{ id: "general", icon: SlidersHorizontal },
	{ id: "accounts", icon: KeyRound },
	{ id: "mcp", icon: Plug },
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
						{section === "mcp" && <McpSection />}
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

function Choice<T extends string>({
	value,
	options,
	onChange,
	placeholder,
	ariaLabel,
}: {
	value: T | undefined;
	options: { value: T; label: string; disabled?: boolean }[];
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
					<SelectItem key={o.value} value={o.value} disabled={o.disabled}>
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

/** Conversation text size in px: typed directly, applied on Enter or blur, clamped to the supported range. */
function TextSizeInput() {
	const { t } = useTranslation();
	const [size, setSize] = useState(getTextSize);
	const [draft, setDraft] = useState(String(size));
	const commit = () => {
		const typed = Number(draft);
		// Empty or non-numeric input restores the current size.
		const next = draft.trim() === "" || !Number.isFinite(typed) ? size : clampTextSize(typed);
		setDraft(String(next));
		if (next === size) return;
		setSize(next);
		setTextSize(next);
	};
	return (
		<div className="flex items-center gap-1.5">
			<Input
				type="number"
				inputMode="numeric"
				min={MIN_TEXT_SIZE}
				max={MAX_TEXT_SIZE}
				step={1}
				value={draft}
				aria-label={t("settings.general.textSize")}
				onChange={(e) => {
					setDraft(e.target.value);
					// Valid sizes apply while typing or using the arrows; out-of-range input is clamped on commit.
					const value = Number(e.target.value);
					if (e.target.value !== "" && value === clampTextSize(value)) {
						setSize(value);
						setTextSize(value);
					}
				}}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
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
	const scope = useSettings((s) => s.scope);
	return (
		<>
			<ScopeSwitch />
			{scope === "project" ? (
				<ProjectScopeNote />
			) : (
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
					<Row label={t("settings.general.textSize")} description={t("settings.general.textSizeDescription")}>
						<TextSizeInput />
					</Row>
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
				<Group title={t("settings.general.tools")}>
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
					{global && (
						<Row
							label={t("settings.general.gptApplyPatch")}
							description={t("settings.general.gptApplyPatchDescription")}
						>
							<Switch
								checked={argon.gptApplyPatch}
								onCheckedChange={(gptApplyPatch) => void updateArgon({ gptApplyPatch })}
							/>
						</Row>
					)}
					{global && (
						<Row
							label={t("settings.general.imageGeneration")}
							description={t("settings.general.imageGenerationDescription")}
						>
							<Switch
								checked={argon.imageGeneration}
								onCheckedChange={(imageGeneration) => void updateArgon({ imageGeneration })}
							/>
						</Row>
					)}
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
				{global && argon && (
					<Row
						label={t("settings.general.remoteCompaction")}
						description={t("settings.general.remoteCompactionDescription")}
					>
						<Switch
							checked={argon.remoteCompaction}
							onCheckedChange={(remoteCompaction) => void updateArgon({ remoteCompaction })}
						/>
					</Row>
				)}
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
