import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
	main: {
		build: {
			externalizeDeps: false,
			rollupOptions: {
				// Compile workspace TS, but preserve every third-party package's runtime layout.
				external: [/^(?!@argon\/|\.{1,2}(?:\/|$)|[A-Za-z]:[\\/])[^/\\\0]/],
				input: { index: path("./src/main.ts"), backend: path("./src/backend.ts") },
			},
		},
	},
	renderer: {
		root: path("../web"),
		plugins: [react(), tailwindcss()],
		resolve: { alias: { "@": path("../web/src") } },
		build: { rollupOptions: { input: path("../web/index.html") } },
	},
});
