import type { Interaction, InteractionResponse } from "@argon/shared";
import { ShieldQuestion } from "lucide-react";
import { type ReactNode, useState } from "react";
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

	switch (interaction.kind) {
		case "tool_approval": {
			const summary = summarizeToolArgs(interaction.toolName, interaction.args);
			return frame(
				`Allow ${interaction.toolName}?`,
				<pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
					{summary || JSON.stringify(interaction.args, null, 2)}
				</pre>,
				<>
					<Button variant="ghost" size="sm" onClick={() => onRespond({ decision: "deny" })}>
						Deny
					</Button>
					<Button variant="outline" size="sm" onClick={() => onRespond({ decision: "allow_session" })}>
						Always allow {interaction.toolName} in this session
					</Button>
					<Button size="sm" onClick={() => onRespond({ decision: "allow" })} autoFocus>
						Allow
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
