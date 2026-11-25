import { useEffect } from "react";

/** Follow the OS light/dark setting by toggling `.dark` on <html>. */
export function useSystemTheme(): void {
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => document.documentElement.classList.toggle("dark", media.matches);
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, []);
}
