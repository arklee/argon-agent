import { Loader2, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Group, Loading } from "@/components/settings/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/stores/settings";

type SearchResult = { name: string; version: string; description?: string };

/**
 * Install / remove with a second click to confirm: plugins run on the backend machine with the
 * backend user's privileges, so `plugins.change` requires the user to have confirmed.
 */
function ChangeButton({ action, spec }: { action: "install" | "remove"; spec: string }) {
	const changePlugin = useSettings((s) => s.changePlugin);
	const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
	const label = action === "install" ? "Install" : "Remove";
	if (state === "confirm") {
		return (
			<div className="flex items-center gap-1.5">
				<Button variant="ghost" size="xs" onClick={() => setState("idle")}>
					Cancel
				</Button>
				<Button
					variant={action === "install" ? "default" : "destructive"}
					size="xs"
					onClick={async () => {
						setState("busy");
						await changePlugin(action, spec);
						setState("idle");
					}}
				>
					Confirm {label.toLowerCase()}
				</Button>
			</div>
		);
	}
	return (
		<Button variant="outline" size="xs" disabled={state === "busy"} onClick={() => setState("confirm")}>
			{state === "busy" && <Loader2 className="animate-spin" />}
			{label}
		</Button>
	);
}

export function PluginsSection() {
	const plugins = useSettings((s) => s.plugins);
	const searchPlugins = useSettings((s) => s.searchPlugins);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>();
	const [searching, setSearching] = useState(false);
	if (!plugins) return <Loading />;
	if (!plugins.available) {
		return <p className="py-8 text-center text-sm text-muted-foreground">The plugin host is not available.</p>;
	}
	const isInstalled = (name: string) =>
		plugins.plugins.some((p) => p.spec === name || p.spec.startsWith(`${name}@`) || p.spec.startsWith(`npm:${name}`));
	const search = async () => {
		if (!query.trim()) return;
		setSearching(true);
		setResults(await searchPlugins(query.trim()));
		setSearching(false);
	};

	return (
		<>
			<div className="mb-6 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
				<TriangleAlert className="size-4 shrink-0" />
				<p>
					Plugins are third-party code. They run on the backend machine with your user's privileges and can read your
					files and credentials. Only install plugins you trust.
				</p>
			</div>

			{plugins.errors.length > 0 && (
				<pre className="mb-4 rounded-md bg-destructive/10 p-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive">
					{plugins.errors.join("\n")}
				</pre>
			)}

			<Group title="Installed">
				{plugins.plugins.length === 0 ? (
					<p className="py-4 text-sm text-muted-foreground">No plugins installed.</p>
				) : (
					plugins.plugins.map((plugin) => (
						<div key={plugin.spec} className="flex items-center gap-3 py-2.5">
							<span className="min-w-0 flex-1 truncate font-mono text-sm" title={plugin.spec}>
								{plugin.spec}
							</span>
							{plugin.managed ? (
								<ChangeButton action="remove" spec={plugin.spec} />
							) : (
								<Badge variant="secondary" title="Configured by hand in magpie's settings">
									Manual
								</Badge>
							)}
						</div>
					))
				)}
			</Group>

			<Group title="Find plugins">
				<form
					className="flex gap-2 py-3"
					onSubmit={(e) => {
						e.preventDefault();
						void search();
					}}
				>
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
							}}
							placeholder="Search community plugins"
							className="h-8 pl-8"
						/>
					</div>
					<Button type="submit" size="sm" variant="outline" disabled={!query.trim() || searching}>
						{searching && <Loader2 className="animate-spin" />}
						Search
					</Button>
				</form>
				{results?.length === 0 && <p className="pb-3 text-sm text-muted-foreground">No plugins found.</p>}
				{results?.map((result) => (
					<div key={result.name} className="flex items-center gap-3 py-2.5">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">
								<span className="font-mono">{result.name}</span>
								<span className="ml-2 text-xs text-muted-foreground">{result.version}</span>
							</div>
							{result.description && (
								<div className="truncate text-xs text-muted-foreground" title={result.description}>
									{result.description}
								</div>
							)}
						</div>
						{isInstalled(result.name) ? (
							<Badge variant="secondary">Installed</Badge>
						) : (
							<ChangeButton action="install" spec={result.name} />
						)}
					</div>
				))}
			</Group>
		</>
	);
}
