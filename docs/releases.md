# JSPARK Forge: releases

Status: 2026-11-20 (brought in line with spec Rev 6–11). One section per release, consistent with [`spec.md`](spec.md) (sections 5 and 7); the spec wins
if the two ever differ. v0.1 build detail is in [`design-v0.1.md`](design-v0.1.md); spikes in
[`spikes.md`](spikes.md); revision history in [`changelog.md`](changelog.md).

Tags: **[owner]** decided by the owner; **[owner, 2026-11-03 review]** / **[owner, 2026-11-03]** owner decisions of
that date; **[spike]** depends on a spike. Spike results override review decisions (spec principle 13).

| Release | One line | Estimate |
|---|---|---|
| v0.1 | Resume + hooks: back to work after any cutoff; dangerous actions blocked | ~1 week (real build) |
| v0.1.1 | "Waiting on you" list (spec 5.2a); PowerShell command forms; ~~hook-enforced show-and-wait~~ (dropped 2026-11-19, design-v0.1.1 section 1); guest mode + quarantine, readonly sources (spec 5.2b) | ~4–5½ days |
| Real users (gate) | Planned: 20–50 users and ~2 weeks of feedback before v0.2. Changed [owner 2026-11-19]: the owner is the first user and asked for the complete product through v0.4; checks run at the end | — |
| v0.2 | Decision memory, the "why" (the centrepiece); `/jspark-forge:check`; migration mappings, licence check | ~4½–5 days |
| v0.2 | Skill and brief templates with lint; plugin + plain instruction file from one source (spec 5.11) | ~1 week |
| v0.2 | UI/UX companions: frontend-design listed as a recommended companion; Playwright MCP and shadcn/ui recommended; one-time tip in front-end projects (spec 5.14) | ~½ day |
| v0.2 | Model map: four helper agents (planner, reviewer: strongest; builder: standard; checker: light), each with its reason (spec 5.15) | ~1 day |
| v0.2.1 | Database guard: production read-only unless `CONFIRM db-write` (spec 5.2c) | ~1–1½ days |
| v0.3 | Codebase map as a thin layer on an existing engine (integrate, don't build): freshness, schema from source files, links to decisions; launch-scope guard; map of readonly sources | ~1 week, **soft** |
| v0.4 | Build graph: a build as a fixed graph of nodes, saved after every node, resumed on the running node (spec 5.10) | ~1½–2 weeks, **soft** |
| v0.4.1 | Map of readonly sources ("where is X in the old code?"), promised for v0.3 and missed; open questions brought up to date | ~½ day |
| v0.4.2 | Updates without a command: install steps turn on auto-update, a once-per-machine tip when it is off; version set in `plugin.json` only | ~1 hour |
| v0.5.0 | Installs once, runs on its own (issue #7): auto-update, code map, Playwright and UI companions set up from the one install command; resume that survives a crash | not estimated |
| v0.5.1 | The gaps a line-by-line check of the spec found, closed: short answers by default, hook errors shown, helpers get the rules, page copies and temp-file warning, sign-in note | not estimated |
| v0.5.2 | A build graph check that takes longer than 10 minutes (`graph gate`) | ~2 hours |
| v0.6.0 | Token care: `/jspark-forge:usage`, a note when the conversation gets long, helper habits | ~3 hours |
| v0.6.1 | Tidy-up, no new features: the last missing test, the spec coverage list brought up to date | ~½ hour |
| v0.6.2 | Six small fixes from real use in another project: no second "Continue?", a shorter handoff, honest gate status, notes with a date | ~1 hour |
| v0.7.0 | Better gates for build graphs: checks before a long run starts, results without reading logs, retry only what failed, flaky named, progress and cost as it goes | ~3 hours |
| v0.8.0 | Build graphs that keep going while you are away: approve a human step ahead of time, a trust message that is never lost in silence, a second graph while the first waits for you; six smaller fixes | ~3 hours |
| Later, only if asked | Security review prompts (incl. council mode), `/capacity`, dashboard (incl. git view), `/jspark-forge:review`, migration mode, customer edition, secrets by name, limit handover (spec 5.6–5.8a, 5.12, 5.13) | not estimated |
| **Total to v0.3** | | ~4–4½ weeks of build after v0.1.1, plus ~2 weeks of feedback, **soft** (v0.4 ~1½–2 weeks more, only if asked) |

---

## v0.1: Resume + hooks

**What it does.** Keeps a one-page handoff of where the work is, rewritten on mechanical triggers, and shows it back
when Claude Code opens after a crash, logout or limit. Blocks a published list of dangerous actions with a typed
override. Carries across sessions **only the handoff** (task, step, files touched, branch, Claude's own notes):
enough to resume the work, not a map of the system [owner, 2026-11-03].

**User-visible behaviour**
- Open Claude Code after a cutoff: *"JSPARK Forge: last time you were on "Add Save as chart", step 4 of 10. Next:
  tests for the save route. Say 'continue' or tell me what to do instead."* Claude asks "Continue?" before picking
  the old task back up; a new first message is done after a one-line mention of the parked task. Show-and-wait is
  **instructed only** (Q8).
- At 95 % context or plan usage: *"Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were."*
  Plan figures only on plans that report usage (Pro/Max/Ultra; Team observed).
- A blocked action: plain reason + *"Do not try an equivalent command; tell the user and stop."* + "type CONFIRM
  <name>"; then Claude Code's normal yes/no prompt.
- A short "saved" note after the user's own status line (if they let init wrap it).
- **Grounding rule [owner 2026-11-03]:** a ≤ 10-line rule added at every SessionStart: cite path and line from the
  map or the file; say "not found" otherwise; never describe code not read this session (design 8.1).

**Files in `.jspark-forge/`** `handoff.md`, `rules.md` (committed), `.gitignore`, `state/session-<id>.json`,
`state/notes.md`, `state/confirm.json`, `usage/<session-id>.json`, `log/YYYY-MM-DD.log`, `log/summary.md`,
`archive/handoff-<timestamp>.md`. Machine level: `~/.claude/jspark-forge/` (status-line wrapper, original config,
settings backup).

**Commands** `/jspark-forge:resume` (on demand), `/jspark-forge:handoff [done]`, `/jspark-forge:init`
(`--undo-statusline`).

**Hooks used** SessionStart (resume summary, re-load after compaction, grounding rule), UserPromptSubmit (last request, CONFIRM
tokens), PreToolUse (block list; notes reminder before `git commit`; timeout 3 s), PostToolUse (matcher
`Edit|Write|NotebookEdit|Bash|PowerShell|TodoWrite|TaskCreate|TaskUpdate|Agent|mcp__.*`; saves, todo and job
tracking), PostToolUseFailure, Stop (save), PreCompact (save), SessionEnd (minimal write, timeout 1 s), SubagentStart
/ SubagentStop (job tracking; rule injection only if spike C passes), status-line wrapper (usage bridge).

**Save triggers** after a file write; after a commit; Stop; PreCompact; SessionEnd; 80 % (quiet + notes reminder) and
95 % (forced + message).

**Block list** `rm-rf-outside` (incl. project root, `.`, `.git` inside the project; hard deny on home/root/drive),
`git-force-push-main`, `git-reset-hard` (incl. `git checkout -- .`, `git restore .`, `git restore --staged .` at the
root), `git-clean-fdx`, `git-stash-drop`, `sql-destroy`, `secret-files` (templates like `.env.example` allowed),
`chmod-wide`, `pipe-to-shell`. Bash / Git Bash forms only.

**Ship gate [owner 2026-11-03]:** v0.1 ships only when the kill-and-resume test passes on Windows, macOS and
Linux, after spikes A–D.

**Acceptance criteria** kill-mid-task resume test passes on Windows, macOS, Linux; grounding rule present after
startup, resume and compact; resume < 30 s on a ~50k-line repo,
measured on a cold machine; no file changed before the user answers; a `claude -p` run with a handoff present is
never stalled; every published block has ≥ 5 positive and ≥ 5 negative tests; uninstall/undo leaves the status line
as before; `claude plugin validate --strict` passes.

**Success measure** back to work **< 2 min** after a cutoff with no re-explaining (per user, first month).

**Estimate** ~1 week, real build (design-v0.1.md section 15).

**Cut / deferred** [owner, 2026-11-03 review]: PowerShell command forms → v0.1.1; 10-minute activity save →
dropped (Stop covers it); hook-enforced show-and-wait → v0.1.1 only if spike D passes; Stop-block notes nudge →
removed, replaced by the `additionalContext` notes reminder (no extra turn); SubagentStart rule injection → only if
spike C passes.

**Depends on spikes** A (usage figures), B (status-line wrapper), C (SubagentStart context), D (headless detection;
decides only v0.1.1's guard). Builder checks B1–B5, B7.

---

## v0.1.1: Waiting on you + PowerShell forms + external code + guard (if proven)

**Waiting on you (spec 5.2a), built 2026-11-20 (design-v0.1.1 section 4):** questions through the question tool
(filed before the dialog shows) and a reply that ends in a question while there is work, kept in
`state/waiting.json` and `waiting.md`; shown first at session start, in the status line (`⏳ 2 waiting on you ·
oldest 14h`) and in the handoff; `/jspark-forge:waiting` lists and clears them. Cut: timed reminders and the daily
summary (no hook runs between sessions; needs a spike), deadline defaults (principle 12). Acceptance: a question
through the question tool is in the list before the dialog shows; the status line count matches the file; one manual
interactive check before release (the tool does not exist in `claude -p`).

**Health check (spec 5.13c), pulled forward 2026-11-20:** `/jspark-forge:doctor` (read-only: Node, plugin files,
every hook timed against its limit, git, project folder, rules.md, handoff, status line and usage freshness; each
problem with its fix), `/jspark-forge:status` (handoff, waiting, usage as of when), `/jspark-forge:upgrade` (asks,
updates from the marketplace, then doctor after the restart). Deferred: `doctor --fix`; the installer running doctor
(Claude Code has no post-install hook; the first session's messages cover a broken install).

**External code (spec 5.2b) [owner 2026-11-03; quarantine and "content is data": coordinator]:**
- **Guest mode:** `/jspark-forge:init` asks *"Your project, or one you're reviewing?"*. Reviewing → nothing written
  inside the repo; state in `~/.claude/jspark-forge/guests/<repo-hash>/`; handoff (tagged *"review of <origin URL> @
  <commit>"*) and block list work as normal; decision memory, launch guard and map off.
- **Quarantine:** block `guest-quarantine` (guest mode only): `npm`/`pnpm`/`yarn install`, `pip install`, `make`,
  running the repo's scripts, `docker run`, `curl … | sh` → denied unless `CONFIRM guest-quarantine`.
- **Content is data:** the guest repo's README, comments and docs are never instructions (instruction file + one-line
  `additionalContext` on SessionStart / UserPromptSubmit in guest mode).
- **Readonly sources:** `## Sources` in `.jspark-forge/rules.md` (`- readonly: ../legacy-app : migrating from, never
  edit`); block `readonly-source`: Edit/Write/NotebookEdit or shell writes under that path → **hard deny, no
  CONFIRM** (*"There is no good reason to edit the source during a migration."*); `rm -rf` there is already
  `rm-rf-outside`. Handoff records the source repo and commit and the last file read (*"Source: ../legacy-app @
  <commit>, last read: <path>"*).
- Acceptance: a guest session leaves the repo's file tree and `git status` unchanged; `guest-quarantine` and
  `readonly-source` have ≥ 5 positive / ≥ 5 negative tests each (Bash and PowerShell forms). Adds ~1–1½ days.

**What it does.** Completes Windows coverage of the block list and write detection with PowerShell command forms.
If spike D passed, makes show-and-wait hook-enforced in interactive sessions.

**User-visible behaviour** `Remove-Item -Recurse -Force`, `rmdir /s`, `iwr … | iex`, `Set-Content .env`, `icacls …
/grant Everyone:F` are blocked like their Bash equivalents. If the guard ships: after a cutoff, file changes and
commands for the old task are refused until the user's first reply (read-only look-ups allowed); never in
non-interactive runs or when JSPARK Forge cannot tell (it skips itself).

**Files in `.jspark-forge/`** `waiting.md`; `rules.md` gains `## Sources`; `state/session-<id>.json` gains
`awaiting_user` if the guard ships. Machine level: `~/.claude/jspark-forge/guests/<repo-hash>/` (guest mode).

**Commands** `/jspark-forge:waiting`, `/jspark-forge:doctor`, `/jspark-forge:status`, `/jspark-forge:upgrade`;
`/jspark-forge:init --guest` / `--mine` (guest mode is decided automatically; init only overrides it).

**Hooks used** PreToolUse (PowerShell forms; guard; `readonly-source`; `guest-quarantine`), PostToolUse (PowerShell
write redirects), SessionStart and UserPromptSubmit (set / clear the guard; guest reminder).

**Acceptance criteria** PowerShell forms have ≥ 5 positive / ≥ 5 negative tests per entry; the guard never fires in a
detected headless run; guest mode writes nothing inside the repo; `readonly-source` and `guest-quarantine` tested as
above; the v0.1 criteria still pass.

**Success measure** as v0.1.

**Estimate** ~4–5½ days: base ~2–3 + Waiting on you ~1 + external code ~1–1½.

**Cut / deferred** if spike D fails: no guard; show-and-wait stays instructed and the README claims only "asks
before continuing".

**Depends on spikes** D (headless detection).

**Pulled forward:** `/jspark-forge:doctor`, `status` and `upgrade` (spec 5.13c), built 2026-11-20 (above).

---

## First user (gate) [owner 2026-11-20, revised the same day]

**Revised [owner]:** "I am the first user, so I need a complete product." The owner uses each release on real
work before the next starts; build continues to v0.3; v0.4 is decided after v0.3 is in use; the outside launch below
follows v0.3.

**Outside launch (after v0.3):**

**What.** After v0.1.1 ships and before v0.2 starts, JSPARK Forge goes in front of 20–50 real users: the official
Claude Code plugin directory, the superpowers community, a short demo. What they hit is fixed first; the order of
everything below is then revisited from their feedback.

**Measured without telemetry** (spec principle 3): installs, GitHub issues and stars, direct replies.

**Success measure** users who come back after a cutoff in a second week.

---

## v0.2.1: Database guard (spec 5.2c) [owner 2026-11-20]

**Status: built** (2026-11-20, in dev/v0.2). The `database dev:` line is honoured only from the user's own
`~/.claude/jspark-forge/rules.md`; a project's line is ignored and reported at SessionStart, like `disable:`.

**What it does.** Guards databases instead of reading them: a write to a production database is denied until the
user types `CONFIRM db-write` (one-shot, 5 minutes). Reads are never blocked.

**User-visible behaviour**
- Writes = anything but `SELECT` / `WITH … SELECT` / `EXPLAIN` / `SHOW` / `DESCRIBE`, plus migration-apply, merge,
  reset and restore tools of database MCP servers.
- Checked in MCP tool calls and in Bash / PowerShell database clients (`psql`, `mysql`, `sqlite3`, `mongosh`,
  `supabase db`, `prisma migrate deploy`, …).
- Production by default: every database MCP server and every non-local host. One line in `rules.md` relaxes it:
  `- database dev: host:<glob> | mcp:<server or prefix*> | <exact host or server>` under `## Settings` (honoured only in the user's own rules.md; a
  repo's own line is ignored, in guest mode or not).
- `sql-destroy` keeps blocking `DROP` / `TRUNCATE` / `DELETE` without `WHERE` everywhere.

**Acceptance criteria** ≥ 5 positive / ≥ 5 negative tests per form (MCP, Bash, PowerShell); a `SELECT` is never
blocked; a dev line relaxes only its own server.

**Estimate** ~1–1½ days.

**Limits** seatbelt, not sandbox: a write inside a script file or stored procedure passes. JSPARK Forge never
connects to a database.

---

## v0.2: UI/UX companions tip (spec 5.14)

**Status: built** (2026-11-20, in dev/v0.2). Once per project (`state/tips.json`), own projects only, front-end
projects only: one SessionStart line naming only the missing companions (frontend-design, Playwright MCP, shadcn MCP
for React) with pinned install lines. Installs nothing. Code: `scripts/lib/uitip.js`; tests: `tests/uitip.test.js`.

## v0.2: Decision memory (the "why")

**Status (2026-11-20): built** on `dev/v0.2` with the licence check, the database guard (v0.2.1, released together),
the skill and brief templates with lint, the model map and the UI/UX tip; design and review record in
[`design-v0.2.md`](design-v0.2.md). Release after the Fable 5.2 code review, spike E and the owner's first-user check.

**What it does.** Keeps one-line decisions, standing rules and lessons, each with the files it touches, and injects
the matching ones as context **just before** Claude edits one of those files [owner, 2026-11-03]. It does not
describe code structure (that is v0.3).

**User-visible behaviour**
- At a commit and when a plan is accepted: *"Record the decision? (one line)"* with a drafted line, default yes; the
  user can edit or skip. Never silent.
- Before Claude edits a touched file, it receives e.g. *"Prices are stored in cents — don't change that."* (≤ 3
  entries, one line each).
- When a commit changes touched files: *"Decision #12 may be stale: still valid?"* (once per entry per day).
- `/jspark-forge:check`: "is my memory still true?" lists stale or contradicted entries, each with *"still valid? /
  update / retire"*; read-only unless the user confirms.
- superpowers design docs, plans and review notes read as decision sources if present.
- **[owner 2026-11-03]** `kind: reference` entries point to a file (e.g. `prisma/schema.prisma`, `docs/arch.md`);
  injected as the pointer only, the file read on demand.
- An entry over ~80 words is accepted; JSPARK Forge warns **once** that long entries go stale and cost tokens, and suggests
  a reference instead. Never blocked.
- Any entry without `touches:` is flagged at 30 days: *"still valid?"*.
- `/jspark-forge:decisions` shows a local count of reference and long entries: demand for a real knowledge feature,
  measured without telemetry. Requests for a separate knowledge base go to a local *"declined, revisit at 500
  users"* list with a count, not refused outright.
- **External code (spec 5.2b) [owner 2026-11-03; licence check: coordinator]:** migration mappings recorded as
  decisions (*"sessions: legacy/session.php → src/auth.ts, cookie format kept"*); licence check of guest repos and
  readonly sources (one file read) in plain words (permissive / restrictive / non-commercial / none found).
  **Licence check built (2026-11-20, in dev/v0.2):** `scripts/lib/licence.js`; one line in the SessionStart message per
  guest repo or read-only source, once per licence text (state in `licences.json` under the JSPARK Forge folder); a
  hint, not legal advice; reads only, failures silent. Tests: `tests/licence.test.js`.

**Files in `.jspark-forge/`** adds `decisions.md` (committed; human-readable).

**Commands** `/jspark-forge:decisions`, `/jspark-forge:decide "<line>"`, `/jspark-forge:check`.

**Hooks used** PostToolUse (commit, plan accepted, plan file written), PreToolUse (Edit/Write/NotebookEdit of a
touched path → `additionalContext`), SessionStart (index of titles ≤ 150 words; `touches:` globs that match nothing).

**Acceptance criteria** the prompt appears at every commit and accepted plan, default yes, never silent; editing a
touched file injects the entry; changed touched files raise one flag per day; `/jspark-forge:check` changes nothing
without confirmation; superpowers absence or layout change breaks nothing (test); a reference entry injects only its pointer; an entry over ~80 words is accepted with one warning; an entry without `touches:` is flagged at 30 days; `/jspark-forge:decisions` shows reference and long-entry counts; a knowledge-base request is logged with a count, not refused.

**Success measure** Claude **does not break a past decision**.

**Estimate** ~4½–5 days.

**Cut / deferred** map checks in `/jspark-forge:check` → v0.3; `/jspark-forge:review` → Later (owner 2026-11-03).

**Depends on spikes** none new (relies on v0.1 hooks and the PreToolUse `additionalContext` fact).

---

## v0.2: Skill and brief templates (spec 5.11) [owner 2026-11-07]

**What it does.** Ships two fill-in templates the kit also uses itself: a **skill** (one reusable task Claude picks by
its trigger) and a **brief** (one job handed to one helper, the `agent` node of v0.4). Both are checked by a lint
before use.

**User-visible behaviour**
- Skill template (`skills/<name>/SKILL.md`): `name` + a one-line "Use when …" description; numbered parts, each with
  input → action → output path; skip a part if its output exists; never overwrite an output name; a verification
  step with evidence (format: Q22).
- Brief template, fields in order: `Goal`, `CAN change` / `CANNOT change`, `Done`, `Setup` (wait for "go"), `Log`
  (fixed-schema, append-only), `Retries` (default 2), `Tie-break` (simpler wins), `Stop` (never "never stop"),
  `Outputs` (declared fields).
- The kit ships both as a plugin and as a plain instruction file from one source.

**Acceptance criteria** lint rejects a skill or brief missing any required field; a skill run twice makes no second
fetch and no overwrite; a brief's log survives a killed session; plugin and plain file carry the same rules (diff
test).

**Success measure** every helper brief in a build is written from the template without re-explaining scope.

**Estimate** ~1 week.

**Depends on spikes** none.

---

## v0.3: Codebase map (the "what and where") + launch-scope guard

**Status (2026-11-20): built, reviewed (Fable 5.2 design and code reviews), every finding fixed; ready to release**
on `dev/v0.3` (version 0.3.0, notes in `release-notes/v0.3.0.md`).

**Integrate, don't build [owner 2026-11-20].** JSPARK Forge builds no map engine. It detects an installed MCP map
engine and adds three layers: freshness ("as of <commit>" on every answer), the database schema from migration and
schema files, and links to the v0.2 decisions that touch each file. No engine → map features off with a one-time
tip; everything else works (spec 5.4).

**What it does.** The architecture memory: a local index of files, symbols, routes and call relations that Claude
queries instead of re-reading files. It also indexes `docs/`, ADRs and the schema source (migrations, Prisma schema,
ORM models, SQL files), so tables and relationships come from the code itself, never from a separate knowledge
base [owner 2026-11-03]. Plus the launch-scope guard, which shows the cost of a new idea before it lands
mid-roadmap.

**User-visible behaviour**
- Claude answers "where is the login check?" / "what breaks if I change this?" from the map; every answer shows the
  map's **last-refresh time** (and commit).
- The map refreshes **file by file as Claude edits** (only the changed files, in the background; skipped if a
  refresh is already queued), after commits, and at session start when `HEAD` moved [owner, 2026-11-03].
- `/jspark-forge:check` also lists stale map areas ("refresh now?"), read-only unless confirmed.
- On a new idea: *"Adding X: about 3 new modules, touches 2 critical paths. Your launch list has 7 items; this becomes
  #8. Before or after launch?"* (now / after launch / smaller / drop). A time range only with ≥ 10 finished items,
  marked "estimate". Silent until `launch.md` exists.
- **External code (spec 5.2b) [owner 2026-11-03]:** the map can index readonly sources (*"where is X in the old
  code?"*).

**Files in `.jspark-forge/`** adds `map/` (engine index, git-ignored), `launch.md` (committed; created by init with
5 blank slots and a launch date).

**Commands** `/jspark-forge:check` (extended); scope check as a skill (`scope-check`); `/jspark-forge:init` creates
`launch.md`.

**Hooks used** PostToolUse (Edit/Write/NotebookEdit → queue file re-index; commit → refresh), SessionStart (catch-up;
launch list titles), UserPromptSubmit (cheap "new scope" phrasing check → one-line reminder).

**Acceptance criteria** file re-index never blocks the next tool call; commit refresh < 10 s on ~50k lines (or async
with "as of"); answers always show last-refresh time; guard silent until `launch.md` exists; facts shown before any
estimate; estimate only with ≥ 10 history items.

**Success measure** **at least one feature shrunk or postponed** because the guard showed its cost.

**Estimate** ~1 week, **soft until the engine trial is done** (smaller than before: no engine is built).

**Honest caveat** [owner, 2026-11-03]: the hardest piece; a stale map is worse than none; the engine (Windows support,
licence, refresh speed) is unproven and **not chosen**. The trial runs after v0.1 ships (candidates and criteria:
spec 5.4).

**Cut / deferred** real git post-commit hook only as an opt-in (Q10); migration mode → Later (owner 2026-11-03).

**Depends on spikes** the engine trial (Windows first), after v0.1 ships.

---

## v0.4: Build graph (spec 5.10) [owner 2026-11-05]

**Status (2026-11-20): built** on `dev/v0.4` (graph file, runner, protected state, gates through Claude's tools,
`DONE` / `TRUST GRAPH`, four templates (software, documents, spike, ui), `/jspark-forge:build`, a real-Claude end-to-end run); design
and code reviews done; review fixes merged on `dev/v0.4`. As built, the plan below changed: graphs live in
`.jspark-forge/graphs/<name>.md` (local, git-ignored), the run record in `.jspark-forge/state/graph-<name>.json`;
saving after every step is automatic (no `save` kind); four templates. Exact behaviour: `docs/design-v0.4.md`.

**Originally "only if users ask"; built at the owner's request [owner 2026-11-19].** Multi-agent runs are the feature most likely to be absorbed by Claude Code;
built only on user demand after v0.3.

**What it does.** A build is written down once as a graph (`forge/graphs/<name>.md`): which steps exist, what each
hands to the next, which can run side by side, and where a person must act. JSPARK Forge runs it, saves after every
node, and resumes on the running node in a new session.

**User-visible behaviour**
- Node kinds: `agent` (one helper, declared model, inputs, outputs), `parallel` (capped by memory and usage), `gate`
  (commands with exit codes), `human` (pauses on one plain instruction), `save` (automatic after every node).
- Estimated tokens and time per node shown before the run; actuals after.
- `/jspark-forge:resume` shows the graph with the current node highlighted, and waits.
- Three generic templates: software (spec, plan, tasks, gate, release), documents (research, draft, review, publish),
  spike (measure, decide, build).

**Files** `forge/graphs/<name>.md`, `forge/graph-state.json`.

**Acceptance criteria** state survives a killed session; a `human` node blocks until a reply; a failing gate stops
the run and names the command; parallel never exceeds the cap; the three templates run end to end on the demo repo;
a graph that references an undeclared field fails before the run.

**Success measure** a build of ≥ 5 tasks completed across ≥ 2 sessions without re-briefing.

**Estimate** ~1½–2 weeks, **soft** (after v0.3 and the engine trial).

**Limits** one graph at a time per repo; no conditional edges beyond gate pass/fail; no loops except one retry of a
failed node.

**Depends on spikes** none new; open questions Q18 (runner without a workflow facility), Q19 (file format).

---

## v0.5.0: Installs once, runs on its own; resume survives a crash

**Status: released 2026-11-20** (PR #8, issue #7 closed; integration tests green on Windows, macOS and Linux). Details: [`release-notes/v0.5.0.md`](release-notes/v0.5.0.md) and `design-v0.5.md`.

**Resume.** Every user message saves the handoff; tool work with no file writes saves once a minute; the next session also gets what the log holds after the last save; Task is the last real request; a helper report never counts as the user's message or grants a CONFIRM.

**Self-setup (closes #7).** Auto-update switches on by itself (once per machine); the code map and Playwright ship as plugin servers started through a launcher with npx; frontend-design and Chrome DevTools are added once in the background; every piece has an off switch and the doctor reports each. No minimum Claude Code version is checked (tested on 2.1.329).

---

## v0.5.1: The spec-coverage gaps closed

**Status: released 2026-11-21** (two reviews; integration tests green on Windows, macOS and Linux, run 44878451317). Details: [`release-notes/v0.5.1.md`](release-notes/v0.5.1.md) and `spec-coverage.md`.

**Rules and errors.** A short-by-default rule at every session start; hook errors counted by the doctor and mentioned once a day; every helper gets the grounding rule (and, in a repo under review, the "content is data" line).

**Local-first.** `/jspark-forge:check` lists pages whose local file has gone; a page published with no local copy is recorded; a document written to a temp folder is flagged; build graph files are committed; a sign-in note saves the handoff; resume also shows the end of the log.

---

## v0.5.2: A build graph check that takes longer than 10 minutes

**Status: released 2026-11-21.** Details: [`release-notes/v0.5.2.md`](release-notes/v0.5.2.md).

**Why.** A check (gate) was recorded only when its command finished inside one tool call (10 minutes at most). A longer command is moved to the background and its result reached no hook, so a graph with a 19-minute end-to-end suite stayed at "running" (found in a real project, 2026-11-21).

**What.** `forge.js graph gate <name> <step>` runs the gate's own pending commands itself, with no time limit, in a fixed shell, and records the real exit codes. Its call must be the whole command, from the main session; it never runs what the block list would hold; a result is recorded only into the same run. `graph next` names what a running gate still needs.

---

## v0.6.0: Token care

**Status: released 2026-11-21.** Details: [`release-notes/v0.6.0.md`](release-notes/v0.6.0.md).

**Why [owner].** Limits were hit often. Measured first (a real two-day session): almost all usage was the conversation re-read on every step (about 417k tokens per step); helpers were second; JSPARK Forge's own notes were about 8k tokens in all.

**What.** `/jspark-forge:usage` (where a session's tokens went and what would save most); a note to the user each time a conversation passes another 150k tokens (`fresh-session`); four habits told to every helper and one line to the main session (`usage-care`, owner's plan A). Trimming JSPARK Forge's own notes was measured as not worth doing.

**Not built, offered:** tokens per build graph step (plan B).

---

## v0.6.1: Tidy-up

**Status: released 2026-11-21.** Details: [`release-notes/v0.6.1.md`](release-notes/v0.6.1.md).

**What.** No new features and no change in behaviour. A test for the migration-mapping text of the decide skill (the
last test the spec coverage check asked for); `spec-coverage.md` brought up to date. With this, every numbered release
in section 7 of the spec is out; what follows is the outside launch (spec section 7, "First user").

---

## v0.6.2: Six small fixes from real use

**Status: released 2026-11-22.** Details: [`release-notes/v0.6.2.md`](release-notes/v0.6.2.md).

**Why [owner, 2026-11-21].** Feedback from a Claude session that used JSPARK Forge in another of the owner's projects
(7 out of 10): a forced second "Continue?", a status that said "running" when nothing ran, a stale note taken as
current, a heavy start, two plugins both setting the process, and "Gate gate".

**What.**
1. A first message that already says "continue" (or "resume", "go on", "yes") is the answer: Claude says where the
   work stands in at most 4 lines and carries on. The question is still asked when the user has not answered.
2. The handoff lists the newest 8 touched files and a count ("+42 more"), not up to 50 names.
3. A gate that was handed out and that nobody is running is shown as "not yet passed (1 of 2 commands passed, none
   running)". "Running" is said only while `graph gate` runs its commands.
4. Gate messages read "Step <id> (gate) …", so a step named `gate` no longer gives "Gate gate".
5. Claude's notes in the handoff carry their date when they are not from today, and the label says to re-check any
   caution or limit before acting on it. The notes reminder asks for what was measured behind a caution.
6. With superpowers installed, one line at session start says who decides what: superpowers the method, JSPARK Forge
   the guard rails; then the user's own instruction, the block list and grounding rule, superpowers.

**Not in this release (offered as v0.7, not confirmed).** Pre-flight check for a gate, results kept per run, retry of
only what failed, flaky versus broken, a progress line for a background gate, time and tokens per step as it goes.

---

## v0.7.0: Better gates

**Status: released 2026-11-22.** Details: [`release-notes/v0.7.0.md`](release-notes/v0.7.0.md);
design: [`design-v0.7.md`](design-v0.7.md).

**Why [owner, 2026-11-22].** The same feedback as v0.6.2: in the owner's other project the hours went into the full
end-to-end run. It failed late for reasons that could be checked first, its results had to be read out of logs, one
failing test meant the whole suite again, and a flaky test looked like a broken one.

**What.** On a gate step of a build graph:
1. `before:` lines (free memory, a port open or free, a container running), checked before the gate starts. Not met:
   the gate is not started and nothing fails.
2. Every run recorded: passed, failed, skipped, not run, and the failing test names, read from the output of eight
   common test runners. `graph gate` keeps each run's output in a log file and prints a summary.
3. `retry:` line: a failing full run is followed by only what failed, then by the full command once more. A retry
   alone never completes a gate.
4. A test that failed and then passed with no change to the code is named flaky, every time, and never called fixed.
5. `graph status` says how far a running gate has got.
6. Every `graph next` ends with the time and tokens so far.

Also [owner, 2026-11-22]: a "stay reachable" rule at every session start (long commands in the background, the user's
mid-task message answered first; `- stay-reachable: off`). A second "side window" for questions was considered and
dropped: with the rule, the same window answers, and it knows more.

A graph without the new lines behaves as before.

---

## Later, only if asked

Built only if users ask; not estimated. Each keeps "nothing leaves the machine" except a dashboard the user chooses
to publish (summaries only).

**Security review prompts** (`/jspark-forge:security`): leaked keys in code and history, risky dependencies, common
holes, unsafe Claude Code settings/hooks/MCP config; uses free scanners if installed; plain output; never prints
"clean"; ends with *"This is a first-pass checklist, not an audit. Run semgrep/trivy/your linter before launch."*
Findings recorded as lessons in decision memory.

**`/capacity`** (hidden): reads free memory, CPU and running work; says how many tracks fit; names large memory users
and what closing each would buy (never closes anything); advises one agent vs agent with helpers vs parallel tracks.
Optional PreToolUse `ask` when memory is below a floor.

**Dashboard** (`/jspark-forge:dashboard`): hooks write `.jspark-forge/state.json` (summaries only); the command
publishes it as a private claude.ai Artifact with "as of <timestamp>", never "live"; fallback
`.jspark-forge/dashboard.html` rewritten at each save.

**`/jspark-forge:review`** (cut 2026-11-03): use / borrow / avoid verdict report on a guest repo. Reason: a
code-review product; a wrong verdict from Claude's judgment does harm.

**Migration mode** (cut 2026-11-03): inventory, parity plan, cutover checklist, sign-off, `migration.md`. Reason:
drifts into project management.

**Council mode** (with security review prompts; spec 5.6): several helpers answer one high-stakes review, rank each
other blind, and a chair writes the verdict. Rules C1–C5 (shuffled labels, no self-ranking, chair not a voter, quorum
of complete rankings, stored aggregate); quorum and ties: Q20. Never "clean".

**Git view** (with the dashboard; spec 5.8): "what was built" from the repo's own history, per task label, day and
model, with test-run ids. Rules G1–G5; renders with the network off.

**Customer edition** (spec 5.12): the kit inside a customer's network on a local model, producing only a product's
declared extension artifacts through the product's own gates; a person approves every install. Only when a product
built with the kit asks; after v0.4. Signing: Q21.

**Three ideas of 2026-11-19** (spec 5.13):
- *Secrets by name:* a secret stored in the OS keychain, referred to by name, resolved only into one command's
  environment; one new block for commands that would print it. Needs a spike first.
- *Limit handover:* rides on v0.1's 95 % band; the forced-save message adds when the limit resets and the person's
  configured fallbacks. Never switches accounts or spends money.
- *`/jspark-forge:doctor`* (+ `status`, `upgrade`): read-only health check, one fix step per failing line. Candidate
  for v0.1.1.

Test for any new item (spec principle 12): hooks, not verdicts.

**Acceptance criteria / success measure** per spec section 5 when scheduled.

**Depends on spikes** none defined yet.

---

## v0.8.0: Build graphs that keep going while you are away

**Status: released 2026-11-22.** Details: [`release-notes/v0.8.0.md`](release-notes/v0.8.0.md); spec 5.10.

**Why [owner, 2026-11-22].** Three things went wrong while running JSPARK Forge 0.6.0 on another project: a build
stopped for hours at a plan approval because nobody was there; `TRUST GRAPH` sent before `graph start` had asked
was lost without a word; and a trial graph could not run while the main build waited for the owner.

**What.**
1. `APPROVE AHEAD <graph> <step>`: the person's own typed decision on a human step, given before the run reaches
   it; recorded as given early, with the step's instruction. `CANCEL APPROVAL <graph> <step>` withdraws it. A step
   marked `- ahead: no` (every release step in the templates) never takes one. Any change to the graph's steps, or
   stopping the run, cancels it. JSPARK Forge still never decides a human step.
2. `TRUST GRAPH <name>` is always answered: sent early, a valid graph is trusted as it is and what was trusted is
   shown; a missing or broken graph gets one line; a near miss gets the exact text to send.
3. More than one graph can be open. A graph waiting at a human step holds nothing. Helper steps and gates of two
   graphs never overlap, unless both carry `- lock: <name>` with different names. `graph status` with no name lists
   every open graph; `DONE <graph> <step>` when the same step waits in two graphs.
4. Smaller: status words kept apart (running, waiting to be run, interrupted); a step named like its kind is named
   once; a long list of touched files is a count and the log; "Record the decision?" is asked once and Claude can mark
   "no decision here"; caution lines in notes are shown as things to re-check; a clearer refusal from the gate runner.

**Not checked.** The tests that drive a real Claude Code session (`tests/integration/`) were not run.
