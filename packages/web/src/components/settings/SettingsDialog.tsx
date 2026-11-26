import type { PermissionRule, PiSettings, ResourceSettings } from "@argon/shared";
import { FolderTree, KeyRound, type LucideIcon, Puzzle, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { Group, Loading, Row } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { type SettingsSection, useSettings } from "@/stores/settings";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
	{ id: "general", label: "General", icon: SlidersHorizontal },
	{ id: "accounts", label: "Providers", icon: KeyRound },
	{ id: "permissions", label: "Permissions", icon: ShieldCheck },
	{ id: "plugins", label: "Plugins", icon: Puzzle },
	{ id: "resources", label: "Resources", icon: FolderTree },
];

export function SettingsDialog() {
	const open = useSettings((s) => s.open);
	const section = useSettings((s) => s.section);
	const setSection = useSettings((s) => s.setSection);
	const close = useSettings((s) => s.close);
	const environment = useApp((s) => s.environment);
	const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent className="flex h-[min(720px,88vh)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
				<nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/40 p-3">
					<DialogTitle className="px-2 pt-1 pb-3 text-base">Settings</DialogTitle>
					{SECTIONS.map(({ id, label, icon: Icon }) => (
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
							{label}
						</button>
					))}
					<div className="flex-1" />
					{environment && (
						<p className="truncate px-2 text-xs text-muted-foreground" title={environment.homeDir}>
							Backend: {environment.name}
						</p>
					)}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="border-b px-6 py-4 pr-12">
						<h2 className="text-base font-semibold">{current?.label}</h2>
						<DialogDescription className="text-xs">{DESCRIPTIONS[section]}</DialogDescription>
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

const DESCRIPTIONS: Record<SettingsSection, string> = {
	general: "Defaults for new sessions. Open sessions keep their settings until reopened.",
	accounts: "Sign in to model providers. Credentials are stored on the backend machine.",
	permissions: "When Argon asks before the agent runs a tool.",
	plugins: "Community provider plugins, installed on the backend machine.",
	resources: "Packages, extensions, skills and prompt templates loaded into sessions.",
};

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
}: {
	value: T | undefined;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	placeholder?: string;
}) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as T)}>
			<SelectTrigger size="sm" className="min-w-40">
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
const QUEUE_MODES = [
	{ value: "one-at-a-time", label: "One at a time" },
	{ value: "all", label: "All at once" },
] as const;

function DefaultModel() {
	const models = useApp((s) => s.models);
	const current = useSettings((s) => s.settings?.pi.defaultModel);
	const updatePi = useSettings((s) => s.updatePi);
	const show = useSettings((s) => s.setSection);
	const byProvider = useMemo(() => {
		const map = new Map<string, typeof models>();
		for (const m of models) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
		return [...map.entries()];
	}, [models]);
	if (models.length === 0) {
		return (
			<Button variant="outline" size="sm" onClick={() => show("accounts")}>
				Connect a provider
			</Button>
		);
	}
	return (
		<Select
			value={current ? `${current.provider}/${current.id}` : undefined}
			onValueChange={(v) => {
				const [provider, ...rest] = v.split("/");
				if (provider) void updatePi({ defaultModel: { provider, id: rest.join("/") } });
			}}
		>
			<SelectTrigger size="sm" className="max-w-64 min-w-40">
				<SelectValue placeholder="Not set" />
			</SelectTrigger>
			<SelectContent position="popper" align="end" className="max-h-80">
				{byProvider.map(([provider, list]) => (
					<SelectGroup key={provider}>
						<SelectLabel>{provider}</SelectLabel>
						{list.map((m) => (
							<SelectItem key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
								{m.name}
							</SelectItem>
						))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}

function GeneralSection() {
	const pi = useSettings((s) => s.settings?.pi);
	const updatePi = useSettings((s) => s.updatePi);
	if (!pi) return <Loading />;
	return (
		<>
			<Group title="Model">
				<Row label="Default model" description="Used by new sessions.">
					<DefaultModel />
				</Row>
				<Row label="Default thinking level" description="For models that support reasoning.">
					<Choice
						value={pi.defaultThinkingLevel}
						placeholder="Not set"
						options={THINKING.map((t) => ({ value: t, label: t[0]?.toUpperCase() + t.slice(1) }))}
						onChange={(defaultThinkingLevel) => void updatePi({ defaultThinkingLevel })}
					/>
				</Row>
			</Group>
			<Group title="Conversation">
				<Row label="Steering messages" description="Messages sent while the agent works, delivered between steps.">
					<Choice
						value={pi.steeringMode}
						options={[...QUEUE_MODES]}
						onChange={(steeringMode) => void updatePi({ steeringMode })}
					/>
				</Row>
				<Row label="Follow-up messages" description="Messages queued until the agent finishes.">
					<Choice
						value={pi.followUpMode}
						options={[...QUEUE_MODES]}
						onChange={(followUpMode) => void updatePi({ followUpMode })}
					/>
				</Row>
				<Row label="Automatic compaction" description="Summarize older messages when the context fills up.">
					<Toggle settingKey="compaction" />
				</Row>
				<Row label="Automatic retry" description="Retry requests that fail with transient errors.">
					<Toggle settingKey="retry" />
				</Row>
				<Row label="Skill commands" description="Offer installed skills as /skill:name commands.">
					<Toggle settingKey="enableSkillCommands" />
				</Row>
			</Group>
			<Group title="Images">
				<Row label="Resize large images" description="Downscale attached images before sending them.">
					<Toggle settingKey="imageAutoResize" />
				</Row>
				<Row label="Block images" description="Never send images to the model.">
					<Toggle settingKey="blockImages" />
				</Row>
			</Group>
			<Group title="Shell">
				<Row label="Shell" description="Path of the shell the bash tool runs. Empty: system default.">
					<TextSetting
						value={pi.shellPath}
						placeholder="/bin/bash"
						onSave={(shellPath) => void updatePi({ shellPath })}
					/>
				</Row>
				<Row label="Command prefix" description="Prepended to every command, e.g. to load an environment.">
					<TextSetting
						value={pi.shellCommandPrefix}
						placeholder="source ~/.profile &&"
						onSave={(shellCommandPrefix) => void updatePi({ shellCommandPrefix })}
					/>
				</Row>
			</Group>
			<Group title="Projects">
				<Row label="Trust new projects" description="Whether a project's own extensions and settings load.">
					<Choice
						value={pi.defaultProjectTrust}
						options={[
							{ value: "ask", label: "Ask" },
							{ value: "always", label: "Always" },
							{ value: "never", label: "Never" },
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
	return rule.tool === "bash" ? "bash (any command)" : rule.tool;
}

function PermissionsSection() {
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
					label="Default mode"
					description="Read-only tools (read, grep, find, ls) never ask. Each session can still switch modes."
				>
					<Choice
						value={permissions.defaultMode}
						options={[
							{ value: "ask", label: "Ask before running" },
							{ value: "auto", label: "Run without asking" },
						]}
						onChange={(defaultMode) => void updateArgon({ permissions: { ...permissions, defaultMode } })}
					/>
				</Row>
			</Group>
			<Group title="Always allowed">
				{permissions.rules.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">
						Nothing yet. Choose “Always allow” on an approval request to add a rule.
					</p>
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
									<span className="font-sans text-muted-foreground">Every call</span>
								)}
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Remove rule ${describeRule(rule)}`}
								onClick={() => remove(rule)}
							>
								<Trash2 />
							</Button>
						</div>
					))
				)}
			</Group>
			<p className="text-xs text-muted-foreground">
				A command rule matches the command itself and the command followed by arguments. Commands that chain, pipe,
				redirect or substitute always ask.
			</p>
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
				{label} <span className="text-muted-foreground">{items.length}</span>
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
	return (
		<Group title={scope.scope === "global" ? "Global" : "This project"}>
			<div className="truncate py-2.5 font-mono text-xs text-muted-foreground" title={scope.path}>
				{scope.path}
			</div>
			<ResourceList label="Packages" items={scope.packages} />
			<ResourceList label="Extensions" items={scope.extensions} />
			<ResourceList label="Skills" items={scope.skills} />
			<ResourceList label="Prompt templates" items={scope.prompts} />
		</Group>
	);
}

function ResourcesSection() {
	const resources = useSettings((s) => s.settings?.resources);
	const cwd = useSettings((s) => s.cwd);
	if (!resources) return <Loading />;
	return (
		<>
			{resources.map((scope) => (
				<ResourceScope key={scope.scope} scope={scope} />
			))}
			<p className="text-xs text-muted-foreground">
				Read-only for now: edit the settings files on the backend machine.
				{!cwd && " Open a session to see a project's resources."}
			</p>
		</>
	);
}
