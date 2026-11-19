# JSPARK Forge v0.1: test results

The ship gate (spec 7, design 13): the kill-and-resume test passes on Windows, macOS and Linux, after spikes A–D.

| Date | Platform | Claude Code | Test | Result |
|---|---|---|---|---|
| 2026-11-19 | Windows 11, Node 24, Git Bash | 2.1.328 | `npm test` (unit + hook-level, 313 tests) | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | hook-fire (`tests/integration/hook-fire.it.js`): all 10 hook events + save in one real session | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | headless (`tests/integration/headless.it.js`): `claude -p` with an open handoff does its task, names the parked one | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | **kill and resume** (`tests/integration/kill-resume.it.js`) on fastify v4.28.1 (68,410 lines): killed after 3 writes + 1 commit (20 s); handoff HEAD = repo HEAD, Step 2 of 10 (1 ticked), Next "route docs 2", `sleep 600` listed; new session reply in **8.6 s** (default model) naming task, step, next action and the job, ending "Continue?"; git status unchanged | **pass** |
| — | macOS | — | kill and resume | not run yet: `.github/workflows/ci.yml`, job `integration` (needs the repo on GitHub + `ANTHROPIC_API_KEY` secret) |
| — | Linux | — | kill and resume | not run yet: same CI job |
| 2026-11-19 | Windows 11, Team plan, auto permission mode | 2.1.328 | **manual check by the owner** (`tests/manual/try-it.js`): init created the folder and asked before wrapping; status line wrapped (usage file live: context 5 %, 5-hour 10 %, weekly 4 %); plan step 1 committed, handoff "Hello script · Step 2 of 3 · Next: Add a test"; `git reset --hard` blocked; after `CONFIRM git-reset-hard` Claude Code showed its own yes/no prompt (B5 interactive: pass, also in auto mode); window closed with X, reopened: "last time you were on \"Hello script\", step 2 of 3. Next: Add a test."; `handoff done` archived; `--undo-statusline` restored settings.json byte for byte | **pass**, one bug found and fixed (below) |
| 2026-11-19 | Windows 11 | 2.1.328 | re-run after the fix: unit 319/319; hook-fire, headless, kill-resume (resume reply 7.8 s) | pass |

**Bug found in the manual check (fixed 2026-11-19):** after `/jspark-forge:handoff done`, the next reply wrote a new
open handoff whose task was the leftover last request ("hi"). Fix: a handoff is written only when there is work to
resume (files written, a commit, a plan or todo list, Claude's notes, or something running); a manual save always
writes; after done, an older superpowers ledger cannot revive the closed plan; the 80 %/95 % messages appear only when
a save happened. Regression tests in `tests/resume.test.js` and `tests/usage.test.js`.

Not reproduced here: "cold machine" (design 13 step 5) needs a fresh boot or a fresh CI runner.
Run the integration tests with `npm run test:integration` (uses plan usage; `FORGE_FIXTURE_DIR` may point at a local
fastify clone; `FORGE_IT_MODEL` / `FORGE_IT_RESUME_MODEL` choose models).
