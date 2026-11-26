/**
 * Session titles. pi does not name sessions by itself, so after the first turn Argon asks a model
 * for a short title and stores it with pi's own session name (session_info entry). Uses the
 * session's model unless ARGON_TITLE_MODEL=provider/id picks a cheaper one.
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const MAX_INPUT_CHARS = 2000;

type TitleModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export function titleModel(runtime: ModelRuntime, sessionModel: TitleModel | undefined): TitleModel | undefined {
	const override = process.env.ARGON_TITLE_MODEL;
	if (override) {
		const [provider, ...rest] = override.split("/");
		const model = provider ? runtime.getModel(provider, rest.join("/")) : undefined;
		if (model) return model;
	}
	return sessionModel;
}

/** A short title for a conversation, or undefined when the model gives nothing usable. */
export async function generateTitle(
	runtime: ModelRuntime,
	model: TitleModel,
	firstUser: string,
	firstReply: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	const excerpt = [
		`User: ${firstUser.slice(0, MAX_INPUT_CHARS)}`,
		firstReply ? `Assistant: ${firstReply.slice(0, MAX_INPUT_CHARS)}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	const reply = await runtime.completeSimple(
		model,
		{
			systemPrompt:
				"You name chat conversations. Reply with a title of at most 6 words (or 12 CJK characters) in the language the user wrote in. No quotes, no trailing punctuation, nothing else.",
			messages: [{ role: "user", content: [{ type: "text", text: excerpt }], timestamp: Date.now() }],
		},
		{ reasoning: model.reasoning ? "minimal" : undefined, signal, maxTokens: 64 },
	);
	const text = reply.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join(" ")
		.split("\n")[0]
		?.replace(/^["'“”「」#*\s]+|["'“”「」.。!！\s]+$/g, "")
		.trim();
	return text ? text.slice(0, 80) : undefined;
}
