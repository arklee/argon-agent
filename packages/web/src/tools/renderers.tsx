/**
 * Default renderers, one per display kind (decisions D13), plus per-tool overrides registered with
 * registerToolRenderer (codex_imagegen).
 */

import type { FileDiff, ToolDisplay } from "@argon/shared";
import { Globe, ImageIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiffStat, DiffView } from "@/components/DiffView";
import { FileLink } from "@/components/FileLink";
import { SessionImages } from "@/components/Images";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { registerKindRenderer, registerToolRenderer, type ToolView } from "./registry";

import { webSearchSources } from "./web-search";

type DisplayOf<K extends ToolDisplay["kind"]> = Extract<ToolDisplay, { kind: K }>;

const codeBlock = "max-h-48 overflow-auto font-mono fs-code whitespace-pre-wrap break-all";

function ArgsJson({ args }: { args: unknown }) {
	if (args === undefined) return null;
	return <pre className={cn(codeBlock, "text-muted-foreground")}>{JSON.stringify(args, null, 2)}</pre>;
}

/** Tool output and result images. Hidden for a finished change whose diff already says it all. */
function Output({ view, hideWhenDone = false }: { view: ToolView; hideWhenDone?: boolean }) {
	const sessionId = useApp((s) => s.activeSessionId);
	const tool = view.tool;
	if (!tool) return null;
	const status = tool.status;
	return (
		<>
			{tool.output && !(hideWhenDone && status === "done") && (
				<pre
					className={cn(
						"max-h-80 overflow-auto rounded-md bg-background p-2 font-mono fs-code whitespace-pre-wrap break-all",
						(status === "error" || status === "blocked") && "text-destructive",
					)}
				>
					{tool.output}
				</pre>
			)}
			{tool.imageCount && sessionId && status !== "running" ? (
				<SessionImages sessionId={sessionId} toolCallId={tool.toolCallId} count={tool.imageCount} />
			) : null}
		</>
	);
}

type FileEntry = DisplayOf<"file_change">["files"][number];

function FileHeader({ path, file, diff }: { path: string; file: FileEntry | undefined; diff?: FileDiff }) {
	const { t } = useTranslation();
	const op = file?.op === "add" || file?.op === "delete" ? file.op : undefined;
	return (
		<span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono">
			{file?.op === "delete" || file?.movePath ? (
				<span className="truncate" title={path}>
					{path}
				</span>
			) : (
				<FileLink target={path} diffs={diff && [diff]} />
			)}
			{file?.movePath && (
				<span className="truncate text-muted-foreground" title={file.movePath}>
					→ {file.movePath}
				</span>
			)}
			{op && (
				<span className="shrink-0 rounded bg-muted px-1 font-sans text-[0.9em] text-muted-foreground">
					{t(`tools.fileOp.${op}`)}
				</span>
			)}
		</span>
	);
}

/** One diff per file; a change touching several files labels each one. */
function Diffs({ diffs, view }: { diffs: FileDiff[]; view: ToolView }) {
	const status = view.tool?.status;
	const settled = status === undefined || status === "done" || status === "running";
	const dim = !settled && "opacity-60";
	if (diffs.length === 1) return <DiffView diff={diffs[0]!.diff} className={cn("max-h-96", dim)} />;
	const files = view.display.kind === "file_change" ? view.display.files : [];
	return (
		<div className="space-y-2">
			{diffs.map((file, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a patch may name the same path twice
				<div key={i} className={cn("space-y-1", dim)}>
					<div className="flex items-center gap-2 text-xs">
						<FileHeader path={file.path} file={files.find((f) => f.path === file.path)} diff={file} />
						<DiffStat diffs={[file]} />
					</div>
					<DiffView diff={file.diff} className="max-h-72" />
				</div>
			))}
		</div>
	);
}

function ShellCommand({ command }: { command: string }) {
	return (
		<pre className={codeBlock}>
			<span className="select-none text-muted-foreground">$ </span>
			{command}
		</pre>
	);
}

/** Script source with syntax highlighting (a fenced block longer than any fence inside the code). */
function ScriptSource({ display }: { display: DisplayOf<"script"> }) {
	const longest = Math.max(2, ...[...display.source.matchAll(/`+/g)].map((m) => m[0].length));
	const fence = "`".repeat(longest + 1);
	return (
		<div className="max-h-80 overflow-auto text-xs [&_.argon-markdown]:my-0">
			<Markdown text={`${fence}${display.language}\n${display.source}\n${fence}`} />
		</div>
	);
}

/** Any kind can carry a diff (e.g. from an older backend without display); show it rather than drop it. */
function DiffOrArgs({ view }: { view: ToolView }) {
	return view.tool?.diffs?.length ? <Diffs diffs={view.tool.diffs} view={view} /> : <ArgsJson args={view.args} />;
}

registerKindRenderer("shell", {
	Body: ({ view }) => (
		<>
			<ShellCommand command={(view.display as DisplayOf<"shell">).command} />
			<Output view={view} />
		</>
	),
	Preview: ({ view }) => <ShellCommand command={(view.display as DisplayOf<"shell">).command} />,
});

registerKindRenderer("file_read", {
	Body: ({ view }) => <Output view={view} />,
});

registerKindRenderer("file_change", {
	Body: ({ view }) => (
		<>
			<DiffOrArgs view={view} />
			<Output view={view} hideWhenDone={Boolean(view.tool?.diffs?.length)} />
		</>
	),
	Preview: ({ view, diffs }) => (diffs?.length ? <Diffs diffs={diffs} view={view} /> : <ArgsJson args={view.args} />),
});

registerKindRenderer("search", {
	Body: ({ view }) => <Output view={view} />,
});

registerKindRenderer("script", {
	placesChildren: true,
	Body: ({ view }) => (
		<>
			<ScriptSource display={view.display as DisplayOf<"script">} />
			{view.renderChildren()}
			<Output view={view} />
		</>
	),
	Preview: ({ view }) => <ScriptSource display={view.display as DisplayOf<"script">} />,
});

registerKindRenderer("generic", {
	Body: ({ view }) => (
		<>
			<DiffOrArgs view={view} />
			<Output view={view} hideWhenDone={Boolean(view.tool?.diffs?.length)} />
		</>
	),
	Preview: ({ view, diffs }) => (diffs?.length ? <Diffs diffs={diffs} view={view} /> : <ArgsJson args={view.args} />),
});

function imagegenArgs(view: ToolView): { prompt?: string; path?: string } {
	const args = view.args as { prompt?: unknown; path?: unknown } | undefined;
	return {
		prompt: typeof args?.prompt === "string" ? args.prompt : undefined,
		path: typeof args?.path === "string" ? args.path : undefined,
	};
}

function ImagegenPrompt({ view }: { view: ToolView }) {
	const { t } = useTranslation();
	const { prompt, path } = imagegenArgs(view);
	if (prompt === undefined) return <ArgsJson args={view.args} />;
	return (
		<div className="space-y-1 text-xs">
			<p className="whitespace-pre-wrap break-words">{prompt}</p>
			{path && (
				<p className="text-muted-foreground">
					{t("tools.imagegen.savedTo")} <span className="font-mono break-all">{path}</span>
				</p>
			)}
		</div>
	);
}

/** The generated image stays visible below the header, like an image in a chat reply. */
function ImagegenInline({ view }: { view: ToolView }) {
	const { t } = useTranslation();
	const sessionId = useApp((s) => s.activeSessionId);
	const tool = view.tool;
	if (tool?.status === "running") {
		return (
			<div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
				<Loader2 className="size-3.5 animate-spin" />
				{t("tools.imagegen.generating")}
			</div>
		);
	}
	if (tool?.status !== "done" || !tool.imageCount || !sessionId) return null;
	return (
		<div className="border-t px-3 py-2">
			<SessionImages sessionId={sessionId} toolCallId={tool.toolCallId} count={tool.imageCount} large />
		</div>
	);
}

registerToolRenderer("codex_imagegen", {
	summary: (view) => imagegenArgs(view).prompt?.split(/\r\n?|\n/, 1)[0] ?? view.display.summary ?? "",
	Inline: ImagegenInline,
	Body: ({ view }) => (
		<>
			<ImagegenPrompt view={view} />
			{view.tool?.status !== "done" && <Output view={view} />}
		</>
	),
	Preview: ({ view }) => (
		<div className="flex gap-2">
			<ImageIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			<ImagegenPrompt view={view} />
		</div>
	),
});

function WebSearchInline({ view }: { view: ToolView }) {
	const { t } = useTranslation();
	const tool = view.tool;
	if (tool?.status === "running")
		return (
			<div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
				<Loader2 className="size-3.5 animate-spin" />
				{t("tools.webSearch.running")}
			</div>
		);
	if (tool?.status !== "done") return null;
	const sources = webSearchSources(tool.output ?? "");
	if (!sources.length) return null;
	return (
		<div className="space-y-2 border-t px-3 py-2">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<Globe className="size-3.5" />
				{t("tools.webSearch.results")} · {sources.length}
			</div>
			<div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
				{sources.map((source) => (
					<a
						key={source.url}
						href={source.url}
						target="_blank"
						rel="noopener noreferrer"
						className="min-w-0 rounded-md border p-2 text-xs hover:bg-muted"
					>
						<div className="line-clamp-2 font-medium">{source.title}</div>
						<div className="mt-1 truncate text-muted-foreground">{new URL(source.url).hostname}</div>
					</a>
				))}
			</div>
		</div>
	);
}
registerToolRenderer("web_run", {
	Inline: WebSearchInline,
	Preview: ({ view }) => <ArgsJson args={view.args} />,
	Body: ({ view }) =>
		view.tool?.status === "done" ? (
			<div className="max-h-96 overflow-auto text-xs">
				<Markdown text={view.tool.output ?? ""} />
			</div>
		) : (
			<>
				<ArgsJson args={view.args} />
				<Output view={view} />
			</>
		),
});
