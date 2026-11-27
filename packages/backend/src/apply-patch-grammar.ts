/** Codex apply_patch grammar, Apache-2.0 (see ../licenses/APACHE-2.0.txt).
 * Source verified 2026-11-28:
 * https://github.com/openai/codex/blob/main/codex-rs/core/assets/tools/apply_patch.lark
 * Upstream commit could not be retrieved in this environment.
 */
export const APPLY_PATCH_LARK = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;
