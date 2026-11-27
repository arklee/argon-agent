// Argon-owned adapter: diagnostics must not inspect pi CLI credentials.
export function codexLoginDiagnostic(_rejected = false): string {
 return "Web search requires a valid OpenAI Codex login. Sign in through Argon Settings → Providers.";
}
export function codexProviderFailure(_error: unknown, _legacy = true): Error {
 return new Error(codexLoginDiagnostic());
}
