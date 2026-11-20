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
