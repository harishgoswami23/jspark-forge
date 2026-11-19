---
name: waiting
description: Use when the user runs /jspark-forge:waiting or asks what is waiting on them, which questions are still open, or wants to answer or dismiss open questions.
---
Show the questions that are waiting on the user, settle them with the user, then clear them.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting` and read what it prints. If it prints
   "Nothing is waiting on you.", say that in one line and stop.
2. Show the list in plain words: one line per question with its recommendation, oldest first. End with:
   "Answer any of them, say 'go with recommendations', or say which to drop."
3. Wait for the user's reply. Never act on a recommendation the user has not accepted.
4. When the user answers, accepts the recommendations, or drops items: run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting --clear <id> [<id> ...]` with the ids from step 1
   (or `--clear all` when every item is settled). Then carry on with the work the answers unblock.
