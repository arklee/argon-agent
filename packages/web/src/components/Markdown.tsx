import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

const plugins = { code, cjk };
// Code blocks are flat cards without line numbers; copying is enough (see .argon-markdown in index.css).
const controls = { code: { copy: true, download: false } } as const;

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
	const { t } = useTranslation();
	const translations = useMemo(
		() => ({
			...t("markdown", { returnObjects: true }),
			close: t("common.close"),
			mermaidFormatMmd: "MMD",
			mermaidFormatPng: "PNG",
			mermaidFormatSvg: "SVG",
			tableFormatCsv: "CSV",
			tableFormatMarkdown: "Markdown",
			tableFormatTsv: "TSV",
		}),
		[t],
	);
	return (
		<Streamdown
			plugins={plugins}
			isAnimating={streaming}
			className="argon-markdown"
			translations={translations}
			controls={controls}
			lineNumbers={false}
		>
			{text}
		</Streamdown>
	);
});
