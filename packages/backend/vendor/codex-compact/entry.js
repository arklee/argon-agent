// Argon-owned entry point (decisions D18). Backend code imports this file instead of src/ so that the
// upstream sources, written without noUncheckedIndexedAccess, stay out of the backend's type program;
// they are checked by ./tsconfig.json instead. entry.d.ts holds the types; entry.check.ts keeps the
// two in sync.
export { createCodexCompactExtension } from "./src/codex-compact.ts";
export { DEFAULT_CODEX_COMPACT_SETTINGS } from "./src/settings.ts";
