import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTextSize } from "./lib/text-size";
import { initTheme } from "./lib/theme";
import "./index.css";

// Presentation-only hint from the desktop shell; grants no native capabilities.
const windowChrome = new URLSearchParams(window.location.search).get("windowChrome");
if (windowChrome === "darwin" || windowChrome === "win32") document.documentElement.dataset.windowChrome = windowChrome;

applyTextSize();
initTheme();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
