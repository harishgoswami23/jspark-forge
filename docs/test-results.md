# JSPARK Forge v0.1: test results

The ship gate (spec 7, design 13): the kill-and-resume test passes on Windows, macOS and Linux, after spikes A–D.

| Date | Platform | Claude Code | Test | Result |
|---|---|---|---|---|
| 2026-11-19 | Windows 11, Node 24, Git Bash | 2.1.328 | `npm test` (unit + hook-level, 313 tests) | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | hook-fire (`tests/integration/hook-fire.it.js`): all 10 hook events + save in one real session | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | headless (`tests/integration/headless.it.js`): `claude -p` with an open handoff does its task, names the parked one | pass |
| 2026-11-19 | Windows 11 | 2.1.328 | **kill and resume** (`tests/integration/kill-resume.it.js`) on fastify v4.28.1 (68,410 lines): killed after 3 writes + 1 commit (20 s); handoff HEAD = repo HEAD, Step 2 of 10 (1 ticked), Next "route docs 2", `sleep 600` listed; new session reply in **8.6 s** (default model) naming task, step, next action and the job, ending "Continue?"; git status unchanged | **pass** |
| — | macOS | — | kill and resume | not run (needs a Mac or a CI runner) |
| — | Linux | — | kill and resume | not run (needs Linux or a CI runner) |
| — | Windows | — | manual check (`tests/manual/try-it.js`): real init + status line, interactive CONFIRM prompt, close and reopen, undo | pending (owner) |

Not reproduced here: "cold machine" (design 13 step 5) needs a fresh boot or a fresh CI runner.
Run the integration tests with `npm run test:integration` (uses plan usage; `FORGE_FIXTURE_DIR` may point at a local
fastify clone; `FORGE_IT_MODEL` / `FORGE_IT_RESUME_MODEL` choose models).
