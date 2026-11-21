---
name: decide
description: Use when the user runs /jspark-forge:decide, or says yes to "Record the decision?", or asks to record, update, verify or retire a decision, rule or lesson for this project.
---
Record a decision the user made. Only ever after the user's own words: never record on your own.

1. Get from the user (ask only for what is missing, one short question):
   - the one-line title ("Prices are stored in cents");
   - the files it touches, as project-relative paths or globs (`src/billing/**`);
   - the kind if not a plain decision: `rule`, `lesson`, or `reference` (then also `see`: the file to read);
   - optionally why, and the source (a commit sha or plan file).
   When the project has a read-only source in rules.md, a migration mapping fits well:
   "sessions: legacy/session.php -> src/auth.ts, cookie format kept", touching both paths.
2. Write `.jspark-forge/state/decide.json` with the Write tool:
   `{ "title": "...", "touches": ["..."], "kind": "decision", "why": "...", "source": "...", "drafted": true }`
   (`drafted` true when you wrote the line and the user accepted it). To update: `{ "update": "D-012", "title": "..." }`.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" decide --from .jspark-forge/state/decide.json` and show its
   one-line answer. Still valid: `decide --verify D-012`. Retire: `decide --retire D-012` (add `--by D-019` when a
   newer one replaces it).
4. If the user declined ("skip"), record nothing. Write `{ "skip": ["<commit sha>"] }` and run the same command, so the
   offer is not repeated.
5. When the user wants a recorded decision or rule to be a hard block, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" decide --promote D-012` and show the one line it prints. It does not
   edit rules.md: a rule is the user's to add, so tell them to paste the line under `## Never` themselves (or ask you
   to, in so many words), and to change the text in backticks to what a command would contain.
