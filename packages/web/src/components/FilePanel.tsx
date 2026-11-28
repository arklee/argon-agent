import { AgentClientError, type FileContent } from "@argon/shared";
import { code, type HighlightResult } from "@streamdown/code";
import { Copy, FileText, RotateCw, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { VList, type VListHandle } from "virtua";
import { DiffStat, DiffView } from "@/components/DiffView";
import { Markdown } from "@/components/Markdown";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { formatBytes, isMarkdownPath, languageFor } from "@/lib/file-links";
import { basename, displayPath } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getClient, useApp } from "@/stores/app";
import { FILE_PANEL_CHAT_MIN_WIDTH, FILE_PANEL_MIN_WIDTH, type OpenFile, useFilePanel } from "@/stores/file-panel";

/** Above this many characters the file is shown without highlighting (Shiki runs on the main thread). */
const MAX_HIGHLIGHT_CHARS = 300_000;

type Token = HighlightResult["tokens"][number][number];
type Load = { status: "loading" } | { status: "ready"; content: FileContent } | { status: "error"; message: string };

/** The active session's file panel (decisions D22): a file read through the backend, beside the chat. */
export function FilePanel({ sessionId }: { sessionId: string }) {
	const file = useFilePanel((s) => s.file);
	if (!file || file.sessionId !== sessionId) return null;
	return <FilePanelContent key={`${file.target}\0${file.cwd ?? ""}`} file={file} />;
}

function FilePanelContent({ file }: { file: OpenFile }) {
	const { t } = useTranslation();
	const homeDir = useApp((s) => s.environment?.homeDir);
	const close = useFilePanel((s) => s.close);
	const width = useFilePanel((s) => s.width);
	const setWidth = useFilePanel((s) => s.setWidth);
	const panel = useRef<HTMLElement>(null);
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [tab, setTab] = useState<"file" | "changes">("file");
	const [preview, setPreview] = useState(true);

	const fetchFile = useCallback(async () => {
		setLoad((current) => (current.status === "ready" ? current : { status: "loading" }));
		try {
			const content = await getClient().request("fs.readFile", { target: file.target, cwd: file.cwd });
			setLoad({ status: "ready", content });
		} catch (error) {
			const message =
				error instanceof AgentClientError && error.code === "not_found"
					? t("files.notFound")
					: t("files.error", { error: error instanceof Error ? error.message : String(error) });
			setLoad({ status: "error", message });
		}
	}, [file.target, file.cwd, t]);

	useEffect(() => {
		void fetchFile();
	}, [fetchFile]);

	const content = load.status === "ready" ? load.content : undefined;
	const path = content?.path ?? file.target;
	const diffs = file.diffs?.length ? file.diffs : undefined;
	const markdown = content?.kind === "text" && isMarkdownPath(content.path);

	const copyPath = () =>
		navigator.clipboard.writeText(path).then(
			() => toast(t("files.pathCopied")),
			() => toast.error(t("chat.copyFailed")),
		);

	return (
		<>
			<ResizeHandle
				label={t("files.resize")}
				width={width ?? 0}
				min={FILE_PANEL_MIN_WIDTH}
				direction={-1}
				measure={() => panel.current?.getBoundingClientRect().width ?? 0}
				onReset={() => setWidth(undefined)}
				onResize={(next) => {
					const room =
						(panel.current?.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY) - FILE_PANEL_CHAT_MIN_WIDTH;
					setWidth(Math.round(Math.max(FILE_PANEL_MIN_WIDTH, Math.min(room, next))));
				}}
			/>
			<aside
				ref={panel}
				aria-label={t("files.panel")}
				style={width === undefined ? undefined : { width }}
				className={cn(
					"flex max-w-[calc(100%-22.5rem)] min-w-80 shrink-0 flex-col border-l bg-background",
					width === undefined && "w-[min(44rem,50%)]",
				)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && !e.nativeEvent.isComposing) close();
				}}
			>
				<div className="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
					<FileText className="size-4 shrink-0 text-muted-foreground" />
					<div className="flex min-w-0 flex-1 items-baseline gap-2" title={path}>
						<span className="shrink-0 truncate text-sm font-medium">{basename(path)}</span>
						<span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
							{displayPath(path, homeDir)}
						</span>
					</div>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("files.refresh")}
						title={t("files.refresh")}
						onClick={() => void fetchFile()}
					>
						<RotateCw />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("files.copyPath")}
						title={t("files.copyPath")}
						onClick={copyPath}
					>
						<Copy />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("common.close")}
						title={t("common.close")}
						onClick={close}
					>
						<X />
					</Button>
				</div>
				{(diffs || markdown || content?.truncated) && (
					<div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs">
						{diffs && (
							<>
								<TabButton active={tab === "file"} onClick={() => setTab("file")}>
									{t("files.file")}
								</TabButton>
								<TabButton active={tab === "changes"} onClick={() => setTab("changes")}>
									{t("files.changes")}
									<DiffStat diffs={diffs} />
								</TabButton>
							</>
						)}
						<div className="flex-1" />
						{content?.truncated && tab === "file" && (
							<span className="truncate px-1 text-muted-foreground">
								{t("files.truncated", { size: formatBytes(content.size) })}
							</span>
						)}
						{markdown && tab === "file" && (
							<>
								<TabButton active={preview} onClick={() => setPreview(true)}>
									{t("files.preview")}
								</TabButton>
								<TabButton active={!preview} onClick={() => setPreview(false)}>
									{t("files.source")}
								</TabButton>
							</>
						)}
					</div>
				)}
				<div className="flex min-h-0 flex-1 flex-col">
					{tab === "changes" && diffs ? (
						<div className="space-y-3 overflow-auto p-3">
							{diffs.map((diff, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a patch may name the same path twice
								<div key={i} className="space-y-1">
									{diffs.length > 1 && (
										<div className="truncate font-mono text-xs text-muted-foreground">{diff.path}</div>
									)}
									<DiffView diff={diff.diff} />
								</div>
							))}
						</div>
					) : load.status === "loading" ? (
						<Message>{t("common.loading")}</Message>
					) : load.status === "error" ? (
						<Message tone="error">{load.message}</Message>
					) : content?.kind === "image" ? (
						content.image ? (
							<div className="flex flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
								<img
									alt={basename(content.path)}
									src={`data:${content.image.mimeType};base64,${content.image.data}`}
									className="max-w-full object-contain"
								/>
							</div>
						) : (
							<Message>{t("files.imageTooLarge", { size: formatBytes(content.size) })}</Message>
						)
					) : content?.kind === "text" && content.text !== undefined ? (
						markdown && preview ? (
							<div className="overflow-auto px-5 py-4">
								<Markdown text={content.text} cwd={parentOf(content.path)} />
							</div>
						) : (
							<CodeLines content={content} text={content.text} nonce={file.nonce} />
						)
					) : content ? (
						<Message>{t("files.binary", { size: formatBytes(content.size) })}</Message>
					) : null}
				</div>
			</aside>
		</>
	);
}

/** The directory of a backend path, for resolving links in a Markdown preview (string only, no IO). */
function parentOf(path: string): string {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return index > 0 ? path.slice(0, index) : path;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"flex items-center gap-1.5 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
				active && "bg-muted font-medium text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function Message({ tone, children }: { tone?: "error"; children: React.ReactNode }) {
	return (
		<p className={cn("px-6 py-10 text-center text-sm text-muted-foreground", tone === "error" && "text-destructive")}>
			{children}
		</p>
	);
}

/** Shiki tokens per line for the file, once loaded; undefined while loading or when not highlighted. */
function useHighlighted(path: string, text: string): Token[][] | undefined {
	const [tokens, setTokens] = useState<Token[][]>();
	useEffect(() => {
		setTokens(undefined);
		if (text.length > MAX_HIGHLIGHT_CHARS) return;
		const language = languageFor(path, (name) => code.supportsLanguage(name as never));
		if (!language) return;
		let live = true;
		const result = code.highlight(
			{ code: text, language: language as never, themes: code.getThemes() },
			(late) => live && setTokens(late.tokens),
		);
		if (result) setTokens(result.tokens);
		return () => {
			live = false;
		};
	}, [path, text]);
	return tokens;
}

const CodeLines = memo(function CodeLines({
	content,
	text,
	nonce,
}: {
	content: FileContent;
	text: string;
	nonce: number;
}) {
	const lines = useMemo(() => {
		const split = text.split(/\r?\n/);
		if (split.length > 1 && split[split.length - 1] === "") split.pop();
		return split;
	}, [text]);
	const tokens = useHighlighted(content.path, text);
	const list = useRef<VListHandle>(null);
	const first = content.line;
	const last = content.endLine ?? content.line;
	const gutter = `${String(lines.length).length + 1}ch`;

	useEffect(() => {
		if (!first || nonce < 0) return;
		const frame = requestAnimationFrame(() =>
			list.current?.scrollToIndex(Math.min(first, lines.length) - 1, { align: "center" }),
		);
		return () => cancelAnimationFrame(frame);
	}, [first, lines.length, nonce]);

	return (
		<VList ref={list} className="flex-1 py-2 font-mono fs-code leading-5">
			{lines.map((line, i) => {
				const number = i + 1;
				const marked = first !== undefined && last !== undefined && number >= first && number <= last;
				return (
					<div key={number} className={cn("flex", marked && "bg-amber-500/15")}>
						<span
							className="shrink-0 pr-3 text-right text-muted-foreground/60 select-none"
							style={{ width: gutter, minWidth: gutter, boxSizing: "content-box", paddingLeft: "0.75rem" }}
						>
							{number}
						</span>
						<span className="min-w-0 flex-1 pr-4 whitespace-pre-wrap break-all">
							{tokens?.[i] ? <TokenLine tokens={tokens[i]} /> : line || "​"}
						</span>
					</div>
				);
			})}
		</VList>
	);
});

function TokenLine({ tokens }: { tokens: Token[] }) {
	if (tokens.length === 0) return "​";
	return tokens.map((token, i) => {
		const style: Record<string, string> = {};
		if (token.color) style["--sdm-c"] = token.color;
		for (const [key, value] of Object.entries(token.htmlStyle ?? {})) {
			if (key === "color") style["--sdm-c"] = value;
			else if (key.startsWith("--")) style[key] = value;
			else if (key !== "background-color") style[key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
		}
		return (
			<span
				// biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
				key={i}
				className="text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]"
				style={style}
			>
				{token.content}
			</span>
		);
	});
}
