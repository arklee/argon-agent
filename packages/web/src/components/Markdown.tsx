import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { memo } from "react";
import { Streamdown } from "streamdown";

const plugins = { code, cjk };

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
	return (
		<Streamdown plugins={plugins} isAnimating={streaming} className="argon-markdown">
			{text}
		</Streamdown>
	);
});
