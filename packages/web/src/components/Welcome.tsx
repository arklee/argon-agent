import { FolderPlus, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/app";

export function Welcome() {
	const { t } = useTranslation();
	const environment = useApp((s) => s.environment);
	const hasProjects = useApp((s) => s.sessions.length > 0 || s.projects.some((p) => p.addedAt && !p.hidden));
	const newSession = useApp((s) => s.newSession);
	const setAddProjectOpen = useApp((s) => s.setAddProjectOpen);
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">Argon</h1>
				<p className="text-muted-foreground">
					{environment ? t("welcome.connected", { environment: environment.name }) : t("welcome.connecting")}
				</p>
			</div>
			<div className="flex gap-2">
				{hasProjects && (
					<Button size="lg" onClick={() => void newSession()} disabled={!environment}>
						<SquarePen /> {t("common.newSession")}
					</Button>
				)}
				<Button
					size="lg"
					variant={hasProjects ? "outline" : "default"}
					onClick={() => setAddProjectOpen(true)}
					disabled={!environment}
				>
					<FolderPlus /> {t("common.addProject")}
				</Button>
			</div>
		</div>
	);
}
