/**
 * Default renderers, one per display kind (decisions D13). Per-tool overrides can be registered with
 * registerToolRenderer; none exist yet.
 */

import type { ToolDisplay } from "@argon/shared";
import { DiffView } from "@/components/DiffView";
import { SessionImages } from "@/components/Images";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { registerKindRenderer, type ToolView } from "./registry";

type DisplayOf<K extends ToolDisplay["kind"]> = Extract<ToolDisplay, { kind: K }>;

const codeBlock = "max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-all";

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
						"max-h-80 overflow-auto rounded-md bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all",
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

function Diff({ diff, view }: { diff: string; view?: ToolView }) {
	const status = view?.tool?.status;
	const settled = status === undefined || status === "done" || status === "running";
	return <DiffView diff={diff} className={cn("max-h-96", !settled && "opacity-60")} />;
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
	return view.tool?.diff ? <Diff diff={view.tool.diff} view={view} /> : <ArgsJson args={view.args} />;
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
			<Output view={view} hideWhenDone={Boolean(view.tool?.diff)} />
		</>
	),
	Preview: ({ view, diff }) => (diff ? <Diff diff={diff} /> : <ArgsJson args={view.args} />),
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
			<Output view={view} hideWhenDone={Boolean(view.tool?.diff)} />
		</>
	),
	Preview: ({ view, diff }) => (diff ? <Diff diff={diff} /> : <ArgsJson args={view.args} />),
});
