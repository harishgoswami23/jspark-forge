---
name: waiting
description: Use when the user runs /jspark-forge:waiting or asks what is waiting on them, which questions are still open, or wants to answer or dismiss open questions.
---
Show the questions that are waiting on the user, settle them with the user, then clear them.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting` and read what it prints. If it prints
   "Nothing is waiting on you.", say that in one line and stop.
2. Show the list in plain words: one line per question with its recommendation, oldest first. When a question shows
   no "blocks:", say in one line what it holds up and whether the answer can be undone, and record it with
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting --set <id> --blocks "<what it holds up>" --reversible yes|no`.
   A line that ends "blocks launch item: <title>" is held against the launch list: say so. End with:
   "Answer any of them, say 'go with recommendations', or say which to drop."
3. Wait for the user's reply. Never act on a recommendation the user has not accepted.
4. When the user answers, accepts the recommendations, or drops items: run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" waiting --clear <id> [<id> ...]` with the ids from step 1
   (or `--clear all` when every item is settled).
5. For each answer that settles a real choice (not a yes to a small step), offer to record the answer as a decision, in
   one line: Record the decision? "<draft, 15 words at most>" (touches: <paths>). Only after the user says yes (or
   gives an edit), record it the way /jspark-forge:decide does (its steps and `decide --from`); if they skip or move on,
   record nothing. Then carry on with the work the answers unblock.
