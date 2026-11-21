---
name: check
description: Use when the user runs /jspark-forge:check or asks whether the project's recorded decisions are still true, or when JSPARK Forge says decisions need a look.
---
Check whether decision memory is still true. Read-only until the user answers.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" check` and show its list as it is.
   It also lists pages (Artifacts) whose local copy has gone or was never kept; for those, ask whether to save the page
   as a file in the project, and do it only after the user says yes.
2. For each item ask, in one short list: still valid? / update / retire.
3. Change things only after the user answers, one by one, with /jspark-forge:decide (`--verify`, an update, or
   `--retire`). Never fix entries on your own.
4. Also look back over the conversation for any open question to the user (something you asked that blocks work and
   was never answered) that is not in the waiting list: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting` to
   see the list, and file each missing one with
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting --add "<question>" --blocks "<what it holds up>" --reversible yes|no`
   (add `--recommend "<your recommendation>"` when you have one). Tell the user which you filed.
