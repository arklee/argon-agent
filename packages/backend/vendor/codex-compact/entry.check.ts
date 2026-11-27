// Compile-time check that entry.d.ts matches the upstream export (only run by ./tsconfig.json).
import type * as declared from "./entry.js";
import { createCodexCompactExtension } from "./src/codex-compact.ts";

export const check: typeof declared.createCodexCompactExtension = createCodexCompactExtension;
