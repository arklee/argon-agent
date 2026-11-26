import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
	main: {
		build: {
			rollupOptions: {
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
