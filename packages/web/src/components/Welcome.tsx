import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/app";

export function Welcome() {
	const [open, setOpen] = useState(false);
	const environment = useApp((s) => s.environment);
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">Argon</h1>
				<p className="text-muted-foreground">{environment ? `Connected to ${environment.name}` : "Connecting…"}</p>
			</div>
			<Button size="lg" onClick={() => setOpen(true)} disabled={!environment}>
				<FolderPlus /> New session
			</Button>
			<NewSessionDialog open={open} onOpenChange={setOpen} />
		</div>
	);
}
