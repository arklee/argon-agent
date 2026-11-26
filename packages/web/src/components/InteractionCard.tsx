import type { AssistantBlock, Interaction, InteractionResponse, PermissionRule } from "@argon/shared";
import { ExternalLink, ShieldQuestion } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { displayFor, rendererFor, type ToolView } from "@/tools";

/** A pending request from the agent (tool approval or an extension dialog). Owned by the backend. */
export function InteractionCard({
	interaction,
	toolCall,
	onRespond,
}: {
	interaction: Interaction;
	/** For tool approvals: the call's transcript block, which carries its display. */
	toolCall?: Extract<AssistantBlock, { type: "toolCall" }>;
	onRespond: (response: InteractionResponse) => void;
}) {
	const { t } = useTranslation();
	const [text, setText] = useState(interaction.kind === "editor" ? (interaction.prefill ?? "") : "");

	const frame = (title: string, body: ReactNode, actions: ReactNode) => (
		<div className="rounded-xl border bg-card p-3 shadow-sm">
			<div className="mb-2 flex items-center gap-2 text-sm font-medium">
				<ShieldQuestion className="size-4 text-amber-600 dark:text-amber-400" />
				<span className="min-w-0 flex-1 whitespace-pre-wrap">{title}</span>
			</div>
			{body}
			<div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div>
		</div>
	);

	const approvalActions = (toolName: string, rule: PermissionRule | undefined) => (
		<>
			<Button variant="ghost" size="sm" onClick={() => onRespond({ decision: "deny" })}>
				{t("approval.deny")}
			</Button>
			<div className="flex-1" />
			{rule && (
				<Button
					variant="ghost"
					size="sm"
					title={t("approval.ruleDescription")}
					onClick={() => onRespond({ decision: "allow_always", rule })}
				>
					<Trans
						t={t}
						i18nKey="approval.alwaysAllow"
						shouldUnescape
						tOptions={{ interpolation: { escapeValue: true } }}
						values={{ rule: rule.command ?? rule.tool }}
						components={{ rule: <code className="font-mono text-xs" /> }}
					/>
				</Button>
			)}
			<Button variant="outline" size="sm" onClick={() => onRespond({ decision: "allow_session" })}>
				{t("approval.allowSession", { tool: toolName })}
			</Button>
			<Button size="sm" onClick={() => onRespond({ decision: "allow" })} autoFocus>
				{t("approval.allow")}
			</Button>
		</>
	);

	switch (interaction.kind) {
		case "tool_approval": {
			const view: ToolView = {
				toolCallId: interaction.toolCallId,
				name: interaction.toolName,
				source: toolCall?.source,
				display: displayFor(interaction.toolName, interaction.args, toolCall?.display),
				args: interaction.args,
				children: [],
				renderChildren: () => null,
			};
			const renderer = rendererFor(view);
			const summary = renderer.summary?.(view) ?? view.display.summary ?? "";
			// The path belongs in the question for file changes; other previews show the call themselves.
			const title = interaction.unsandboxed
				? t("approval.unsandboxedQuestion", { tool: interaction.toolName })
				: view.display.kind === "file_change" && summary
					? t("approval.questionWithSummary", { tool: interaction.toolName, summary })
					: t("approval.question", { tool: interaction.toolName });
			const Preview = renderer.Preview;
			return frame(
				title,
				<>
					{interaction.unsandboxed && (
						<p className="mb-2 text-sm text-muted-foreground">{t("approval.unsandboxedDescription")}</p>
					)}
					<div className="max-h-80 overflow-auto rounded-md bg-muted p-2">
						{Preview ? (
							<Preview view={view} diff={interaction.diff} />
						) : (
							<pre className="font-mono text-xs whitespace-pre-wrap break-all">
								{summary || JSON.stringify(interaction.args, null, 2)}
							</pre>
						)}
					</div>
				</>,
				// A saved rule never covers running unsandboxed, so do not offer one.
				approvalActions(interaction.toolName, interaction.unsandboxed ? undefined : interaction.suggestedRule),
			);
		}
		case "network_access": {
			const host =
				interaction.port && interaction.port !== 443 && interaction.port !== 80
					? `${interaction.host}:${interaction.port}`
					: interaction.host;
			return frame(
				t("approval.networkQuestion", { host }),
				<p className="text-sm text-muted-foreground">{t("approval.networkDescription")}</p>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ decision: "deny" })}>
						{t("approval.deny")}
					</Button>
					<div className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						title={t("approval.hostRuleDescription")}
						onClick={() => onRespond({ decision: "allow_always" })}
					>
						<Trans
							t={t}
							i18nKey="approval.alwaysAllow"
							shouldUnescape
							tOptions={{ interpolation: { escapeValue: true } }}
							values={{ rule: interaction.host }}
							components={{ rule: <code className="font-mono text-xs" /> }}
						/>
					</Button>
					<Button variant="outline" size="sm" onClick={() => onRespond({ decision: "allow_session" })}>
						{t("approval.allowHostSession")}
					</Button>
					<Button size="sm" onClick={() => onRespond({ decision: "allow" })} autoFocus>
						{t("approval.allow")}
					</Button>
				</>,
			);
		}
		case "confirm":
			return frame(
				interaction.title,
				<p className="text-sm whitespace-pre-wrap text-muted-foreground">{interaction.message}</p>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ confirmed: false })}>
						{t("common.no")}
					</Button>
					<Button size="sm" onClick={() => onRespond({ confirmed: true })} autoFocus>
						{t("common.yes")}
					</Button>
				</>,
			);
		case "select":
			return frame(
				interaction.title,
				null,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ cancelled: true })}>
						{t("common.cancel")}
					</Button>
					{interaction.options.map((option) => (
						<Button key={option} variant="outline" size="sm" onClick={() => onRespond({ value: option })}>
							{option}
						</Button>
					))}
				</>,
			);
		case "oauth":
			return frame(
				interaction.title,
				<div className="space-y-2 text-sm text-muted-foreground">
					<p>{t("approval.redirectInstructions")}</p>
					<Textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={t("approval.redirectPlaceholder")}
						className="min-h-12 font-mono text-xs"
					/>
				</div>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ cancelled: true })}>
						{t("common.cancel")}
					</Button>
					<Button variant="outline" size="sm" disabled={!text.trim()} onClick={() => onRespond({ value: text.trim() })}>
						{t("approval.submitUrl")}
					</Button>
					<Button size="sm" asChild autoFocus>
						<a href={interaction.url} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							{t("common.openSignIn")}
						</a>
					</Button>
				</>,
			);
		case "input":
		case "editor":
			return frame(
				interaction.title,
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={interaction.kind === "input" ? interaction.placeholder : undefined}
					className="min-h-20 font-mono text-sm"
					autoFocus
				/>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ cancelled: true })}>
						{t("common.cancel")}
					</Button>
					<Button size="sm" onClick={() => onRespond({ value: text })}>
						{t("common.submit")}
					</Button>
				</>,
			);
	}
}
