import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Components, defaultComponents, defaultRehypePlugins, Streamdown } from "streamdown";
import { openFileInPanel } from "@/components/FileLink";
import { RenderBoundary } from "@/components/RenderBoundary";
import { fileLinkTarget, rehypeFileLinks } from "@/lib/file-links";
import { normalizeMath } from "@/lib/math-delimiters";
import { useSmoothText } from "@/lib/smooth-text";

// Single-dollar inline math is on; normalizeMath escapes dollars that do not pair (currency) before parsing.
const plugins = { code, cjk, math: createMathPlugin({ singleDollarTextMath: true }) };
// Code blocks are flat cards without line numbers; copying is enough (see .argon-markdown in index.css).
const controls = { code: { copy: true, download: false } } as const;

// File links are wrapped before Streamdown's sanitize/harden steps would drop them (see file-links.ts).
const rehypePlugins = [rehypeFileLinks, ...Object.values(defaultRehypePlugins)];

/**
 * Streamdown's link, except file links (decisions D22): those open in the file panel, resolved
 * against `cwd` (the active session's when absent), instead of the external-link dialog.
 */
function linkComponents(cwd: string | undefined): Components {
	const DefaultLink = defaultComponents.a;
	return {
		a: (props) => {
			const target = typeof props.href === "string" ? fileLinkTarget(props.href) : undefined;
			if (target === undefined) return DefaultLink ? <DefaultLink {...props} /> : <a {...props} />;
			return (
				<button
					type="button"
					data-streamdown="link"
					title={target}
					onClick={() => openFileInPanel(target, { cwd })}
					className="wrap-anywhere appearance-none text-start font-medium text-primary underline"
				>
					{props.children}
				</button>
			);
		},
	};
}

interface MarkdownProps {
	text: string;
	streaming?: boolean;
	/** Base for relative file links; the active session's cwd when absent. */
	cwd?: string;
}

/** Markdown that falls back to plain text if rendering fails (it never takes the transcript down with it). */
export const Markdown = memo(function Markdown(props: MarkdownProps) {
	return (
		<RenderBoundary fallback={() => <p className="argon-markdown whitespace-pre-wrap">{props.text}</p>}>
			<MarkdownContent {...props} />
		</RenderBoundary>
	);
});

function MarkdownContent({ text, streaming, cwd }: MarkdownProps) {
	const { t } = useTranslation();
	const smooth = useSmoothText(text, Boolean(streaming));
	const source = useMemo(() => normalizeMath(smooth.text), [smooth.text]);
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
	const components = useMemo(() => linkComponents(cwd), [cwd]);
	return (
		<Streamdown
			plugins={plugins}
			// Keep the incomplete-markdown handling on while the paced text is still catching up.
			isAnimating={Boolean(streaming) || smooth.pending}
			className="argon-markdown"
			translations={translations}
			controls={controls}
			lineNumbers={false}
			rehypePlugins={rehypePlugins}
			components={components}
		>
			{source}
		</Streamdown>
	);
}
