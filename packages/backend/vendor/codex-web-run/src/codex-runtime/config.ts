// Argon-owned adapter: never read pi CLI routing configuration.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export interface CodexToolRouteConfig { providers: Record<string, Record<string, string>> }
export function readCodexToolRouteConfig(): CodexToolRouteConfig { return { providers: {} }; }
export function isCodexToolRoute(_config: CodexToolRouteConfig, _model: ExtensionContext["model"]): boolean { return false; }
export function resolveCodexToolModel(_config: CodexToolRouteConfig, _model: ExtensionContext["model"], canonical: string): string { return canonical; }
