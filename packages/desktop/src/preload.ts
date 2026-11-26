import { contextBridge, ipcRenderer } from "electron";

// The renderer's only bridge to the shell: presentation hints, no native capabilities (see docs/desktop.md).
contextBridge.exposeInMainWorld("argonDesktop", {
	setTheme: (theme: unknown) => ipcRenderer.send("argon:set-theme", theme),
});
