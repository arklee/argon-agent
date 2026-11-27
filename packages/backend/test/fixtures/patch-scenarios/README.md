# Patch scenarios

`002_multiple_operations` is adapted from OpenAI Codex (Apache-2.0):
https://github.com/openai/codex/tree/main/codex-rs/apply-patch/tests/fixtures/scenarios/002_multiple_operations
The input and patch were retrieved through the web cache on 2026-11-28; expected/modify.txt
was reconstructed from the patch because that upstream file was unavailable. The upstream
commit and full fixture collection could not be downloaded in this environment.

`local_*` fixtures are Argon regression cases using the same input/patch.txt/expected layout.
Unlike Codex's partial-success scenario, planning errors must leave every file unchanged.
