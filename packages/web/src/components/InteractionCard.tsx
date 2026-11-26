import type { Interaction, InteractionResponse, PermissionRule } from "@argon/shared";
import { ExternalLink, ShieldQuestion } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DiffView } from "@/components/DiffView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { summarizeToolArgs } from "@/lib/format";

/** A pending request from the agent (tool approval or an extension dialog). Owned by the backend. */
export function InteractionCard({
	interaction,
	onRespond,
}: {
	interaction: Interaction;
	onRespond: (response: InteractionResponse) => void;
}) {
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
				Deny
			</Button>
			<div className="flex-1" />
			{rule && (
				<Button
					variant="ghost"
					size="sm"
					title="Saved to Permissions settings; applies to every session on this backend"
					onClick={() => onRespond({ decision: "allow_always", rule })}
				>
					Always allow{" "}
					{rule.command !== undefined ? <code className="font-mono text-xs">{rule.command}</code> : rule.tool}
				</Button>
			)}
			<Button variant="outline" size="sm" onClick={() => onRespond({ decision: "allow_session" })}>
				Allow {toolName} for this session
			</Button>
			<Button size="sm" onClick={() => onRespond({ decision: "allow" })} autoFocus>
				Allow
			</Button>
		</>
	);

	switch (interaction.kind) {
		case "tool_approval": {
			const summary = summarizeToolArgs(interaction.toolName, interaction.args);
			if (interaction.diff) {
				return frame(
					`Allow ${interaction.toolName} ${summary}?`,
					<DiffView diff={interaction.diff} className="max-h-80" />,
					approvalActions(interaction.toolName, interaction.suggestedRule),
				);
			}
			return frame(
				`Allow ${interaction.toolName}?`,
				<pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
					{summary || JSON.stringify(interaction.args, null, 2)}
				</pre>,
				approvalActions(interaction.toolName, interaction.suggestedRule),
			);
		}
		case "confirm":
			return frame(
				interaction.title,
				<p className="text-sm whitespace-pre-wrap text-muted-foreground">{interaction.message}</p>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ confirmed: false })}>
						No
					</Button>
					<Button size="sm" onClick={() => onRespond({ confirmed: true })} autoFocus>
						Yes
					</Button>
				</>,
			);
		case "select":
			return frame(
				interaction.title,
				null,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ cancelled: true })}>
						Cancel
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
					<p>
						Open the sign-in page and finish signing in. If the page you land on does not load (for example when the
						agent runs on another machine), paste its full URL here.
					</p>
					<Textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Redirect URL (optional)"
						className="min-h-12 font-mono text-xs"
					/>
				</div>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ cancelled: true })}>
						Cancel
					</Button>
					<Button variant="outline" size="sm" disabled={!text.trim()} onClick={() => onRespond({ value: text.trim() })}>
						Submit URL
					</Button>
					<Button size="sm" asChild autoFocus>
						<a href={interaction.url} target="_blank" rel="noopener noreferrer">
							<ExternalLink />
							Open sign-in page
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
						Cancel
					</Button>
					<Button size="sm" onClick={() => onRespond({ value: text })}>
						Submit
					</Button>
				</>,
			);
	}
}
