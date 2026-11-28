import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Components, defaultComponents, defaultRehypePlugins, Streamdown } from "streamdown";
import { openFileInPanel } from "@/components/FileLink";
import { fileLinkTarget, rehypeFileLinks } from "@/lib/file-links";

const plugins = { code, cjk };
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

export const Markdown = memo(function Markdown({
	text,
	streaming,
	cwd,
}: {
	text: string;
	streaming?: boolean;
	/** Base for relative file links; the active session's cwd when absent. */
	cwd?: string;
}) {
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
	const components = useMemo(() => linkComponents(cwd), [cwd]);
	return (
		<Streamdown
			plugins={plugins}
			isAnimating={streaming}
			className="argon-markdown"
			translations={translations}
			controls={controls}
			lineNumbers={false}
			rehypePlugins={rehypePlugins}
			components={components}
		>
			{text}
		</Streamdown>
	);
});
