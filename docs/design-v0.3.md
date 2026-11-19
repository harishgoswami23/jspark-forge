# JSPARK Forge v0.3: design

Status: **revision 2, 2026-11-20**, after the Fable 5.2 design review (findings cited [R-H1] and so on). Scope: spec 5.4
(codebase map: integrate, don't build) and 5.5 (launch-scope guard). Engine chosen by the Windows trial:
**codebase-memory-mcp** ([`engine-trial.md`](engine-trial.md)). Earlier designs: [`design-v0.1.md`](design-v0.1.md),
[`design-v0.1.1.md`](design-v0.1.1.md), [`design-v0.2.md`](design-v0.2.md).

**Build order:** spikes F and G first (section 0); their results can change sections 1.2 and 1.3 (principle 13).

---

## 0. Spikes before code [R-H1, R-H3]

- **Spike F, the engine's live watcher.** Run codebase-memory-mcp as an MCP server in a real Claude Code session on
  this machine (registered for the test project only). Measure: the delay from an edit to a query seeing it; whether a
  `cli index_repository` run at the same time on the same cache corrupts or blocks; whether `repo_path` spelled with
  different letter case or with spaces gives the same project key. Result decides whether JSPARK Forge needs its own
  per-edit refresh.
- **Spike G, a detached refresh from a hook.** A hook starts a background process (`stdio: 'ignore'`,
  `windowsHide`, `detached`, `unref()`) and exits at once: the process must survive the hook, never delay the next
  tool call, and never hold the hook open. Windows here; macOS and Linux in CI.

## 1. The code map: an engine plus three JSPARK Forge layers (spec 5.4)

JSPARK Forge builds no index. Claude asks the engine directly. JSPARK Forge adds only what the engine lacks: freshness
tied to git, the database layout from migration files, and the decisions about each file. **Guest repos:** the map
layers are off (the engine may still be used by Claude; JSPARK Forge adds nothing and writes nothing) [R-L].

### 1.1 Detection [R-M1]

- **By use, not by reading config:** the map layers switch on the first time a tool call whose name contains
  `codebase-memory` is seen (PostToolUse), and its prefix (`mcp__<server>__`) is stored in `state/map.json`. No
  config file is read for this, so other servers' settings and secrets are never touched, and every way of
  registering the engine (plugin, project, user, managed, `--mcp-config`) works.
- **The tip (owner Q-M1: name it, install nothing):** once per own project with source files, a one-line tip names
  the engine and its install page. To avoid naming it when it is already installed, the tip only checks whether the
  plugin folder or `~/.claude.json` mentions `codebase-memory` (a yes/no, never logged, nothing else read). The v0.2
  UI tip is changed the same way (it currently reads `~/.claude.json` for "playwright": same rule, yes/no only).

### 1.2 Freshness: "as of <commit>" [R-H1, R-H2, R-H3]

`state/map.json`: `{ prefix, sha (full), indexedAt, lastError, failures, pending }`.

- **What was indexed:** the refresh runner reads the full `HEAD` SHA **before** indexing and records it only when the
  engine exits 0 [R-H2]. A commit that lands during a run sets `pending`; the runner runs once more before it stops.
- **Started:** after a commit (PostToolUse), at session start when `HEAD` differs from the recorded SHA, and from the
  map-answer hook when `HEAD` differs (covers pulls, checkouts and terminal commits) [R-H2]. Never per edit unless
  spike F shows the engine's watcher does not cover the session's project.
- **One at a time [R-H3]:** a lock file created with `fs.openSync(lock, 'wx')`; it is stale only when its process is
  gone or the runner's own hard timeout (3 minutes) has passed, and then the runner's process tree is killed (as the
  status-line wrapper does). The engine binary is found by the stored prefix's command where known, else on `PATH`;
  not found → `lastError`, no refresh. Failures back off (1, 5, 30 minutes) and show in `/jspark-forge:check`.
- **Every map answer carries its freshness** (PostToolUse on the engine's query tools): one line of context.
  - *Current:* `HEAD` equals the indexed SHA and no file in `git status --porcelain` (tracked and untracked) changed
    after `indexedAt` → *"Code map current (as of 9a8b7c6)."* (about 15 tokens) [R-M2].
  - *Behind:* *"Code map as of 3f2e1d0 (2026-11-20 14:02); HEAD is 2 commits ahead. Say "as of 3f2e1d0" when you use
    this answer; read these changed files before relying on it: src/a.ts, src/b.ts"*. Changed files are
    `git diff --name-only <sha>` (the working tree, so uncommitted edits count) plus untracked files newer than
    `indexedAt`, at most 10 [R-H2].
  - *Different history:* when the indexed SHA is not an ancestor of `HEAD` (`git merge-base --is-ancestor`: a rebase,
    an amend, another branch): *"Code map was indexed on a different history (3f2e1d0); a refresh is running; read
    files before relying on it."* No commit count is guessed.
  - The file list is repeated only when it changed since the last map answer in this conversation [R-M2].
- **Session start** (when on): one line for Claude: as of which commit, how far behind.

### 1.3 The database layout from source files (never the live database) [R-M3]

- **Prisma:** the engine indexes models, fields and relations (trial).
- **SQL migrations:** `scripts/lib/schema.js` reads one migration root at a time (`migrations/`, `db/migrations/`,
  `supabase/migrations/`, `prisma/migrations/`; one layout per root, never merged), files in **numeric-aware** order
  (`V10__` after `V2__`). It skips down migrations (`*.down.sql`, `-- +goose Down`, `-- migrate:down` sections),
  splits statements outside strings, comments and `$$` bodies, and replays `CREATE TABLE`, `ALTER TABLE … ADD /
  DROP / RENAME COLUMN`, `DROP TABLE`, `REFERENCES` / `FOREIGN KEY`. A statement it cannot read marks its table
  "uncertain". A root whose migrations are JavaScript or Python says "no SQL migrations here", never an empty layout.
- **`/jspark-forge:schema [table]`** (`forge.js schema`): the layout with file and line for each table and column,
  "as of <commit>", and the decisions that touch each migration file. Read-only; stores nothing.

### 1.4 Decisions on map answers [R-H5]

- File paths come from the tool call's input first; from the answer, only tokens that are existing files in the
  project (checked on disk, at most 20) [R-M2]. Matching active decisions are added to the freshness line as
  *"Project notes on these files: D-012 Prices are stored in cents"* (id and title only, cleaned), at most 3.
- **A separate "shown on map answers" set** per conversation and helper: map answers never use up the v0.2 rule that
  shows a decision just before an edit (that set is not touched) [R-H5].
- Merged with any pending v0.2 offers into one `additionalContext` [R-M2].

### 1.5 `/jspark-forge:check`, extended

Adds: the map is behind or on a different history (with the changed files); the last refresh failed (`lastError`);
the engine reported parse problems (its `index_status`, when Claude asks it). Each with "refresh now?" →
`forge.js map refresh` (the same locked runner). Read-only unless the user says yes.

### 1.6 Limits

The engine decides what "where" and "callers" mean; JSPARK Forge checks only the age of its answers. The SQL reader
understands common DDL, not every dialect; what it cannot read is marked, never guessed.

---

## 2. Launch-scope guard (spec 5.5)

### 2.1 The launch list [R-H4]

- `.jspark-forge/launch.md`, committed and shared like `decisions.md`, so it gets the same protections:
  - **own projects only** (`paths.isOwn`): never read in a guest repo;
  - every title cleaned and cut (`memory.clean`), framed as *data, not instructions* wherever it reaches Claude;
  - "Critical paths" entries must be relative paths inside the project (no `..`, no absolute paths), else skipped;
  - items that arrived with git are listed to the user once, like decisions;
  - `stateMadeHere` accepts a tracked `launch.md`; the default `.gitignore` and the "is on" message include it.
- Format: a launch date, **5 blank slots** (spec 5.5), a "Critical paths" line, an "After launch" list. Each item:
  `- [ ] <title> (added <date>) (started <date>) (done <date>)`.
- **Writer:** `forge.js launch add|start|done|after` changes only its line (byte-preserving, as `decide`), and every
  change is announced in the conversation ("JSPARK Forge: added to the launch list: #8 …"). Created by
  `/jspark-forge:launch`.
- **The guard does nothing until the file exists** (spec 5.5).

### 2.2 Detection: facts first, the judgement is Claude's

- **Session start:** the launch date, open / done counts and titles (≤ 60 words), framed as data.
- **UserPromptSubmit nudge [R-M4; owner Q-M2: on when launch.md exists]:** a cheap phrase check ("let's also",
  "can we add", "what if we", "new feature", "add support for", "while we're at it", and a few more) on prompts under
  400 characters adds one conditional line: *"JSPARK Forge: if this is a new feature that is not on the launch list,
  run /jspark-forge:scope before starting; otherwise carry on."* At most once per 30 minutes; attended sessions only;
  not at 95 % usage.
- **`/jspark-forge:scope` (skill)** asks `forge.js launch facts [--files <paths>]`, which prints the facts
  mechanically [R-M5]: the launch list count and the next number ("this becomes #8"), critical-path hits among the
  given files, and the estimate: the median and range of `started`→`done` durations **only with ≥ 10 finished items**,
  else "no estimate yet (4 of 10 finished items)". The files and modules come from the map when on, else from file
  names; the skill then gives the options (now / after launch / smaller / drop) and the over-engineering line when it
  applies.
- **The choice is recorded** through the v0.2 decision flow (offered, recorded only after the user's yes), with
  `Touches: .jspark-forge/launch.md` so it is never flagged as "no Touches" [R-M5], and the item goes into the list or
  "After launch" through the writer.

### 2.3 Limits

The phrase check misses new scope said in other words; it never blocks. Estimates need ten finished, dated items.

---

## 3. Deviations from spec 5.4 / 5.5 [R-M6]

| Spec | This design | Why |
|---|---|---|
| Refresh file by file as Claude edits (5.4) | The engine's own watcher; JSPARK Forge refreshes after commits and when `HEAD` moves | The engine watches its session project; spike F confirms or brings per-edit refresh back |
| Catch-up for files changed outside Claude (5.4) | Covered: `HEAD` checks at session start and on each map answer; working-tree changes listed in every "behind" answer | |
| Real git post-commit hook as an opt-in (Q10) | Not built | The PostToolUse commit trigger plus `HEAD` checks cover it without touching `.git/hooks` |
| Index in `.jspark-forge/map/` (5.4) | The engine's own cache (`~/.cache/codebase-memory-mcp/`) | We do not own the index (integrate, don't build) |
| `docs/`, ADRs, ORM models indexed (5.4) | What the engine indexes (code, Prisma; its own ADR tool unused) | No second index; ORM models beyond Prisma come with the engine's grammars or not at all |
| `/check` "indexed files that no longer exist" (5.4) | The changed-file list and "different history" | Equivalent for answers; the engine prunes its own index |
| `launch.md` created by init (5.5) | `/jspark-forge:launch` | Init is optional since v0.1 (automatic setup) |
| Skill `scope-check` (5.5) | `/jspark-forge:scope` | Shorter command |
| Git history as a scope fact (5.5) | The `started`→`done` history in `launch.md` | Mechanical and local |
| Added | `/jspark-forge:schema`, `forge.js map refresh`, the Critical paths line, `forge.js launch` | Needed to show facts mechanically |

The spec gets a short update with these when v0.3 ships.

## 4. Tests

- **Detection:** first engine tool call switches it on; no config is read for it; the tip's yes/no check.
- **Refresh:** a fake engine binary (a Node script answering `cli index_repository`) keeps tests offline. Two
  triggers while one runs start one more run (`pending`), never two at once; a stale lock is taken over; a missing or
  hanging binary records `lastError` and backs off; the recorded SHA is the one read before indexing; the hook returns
  at once (time it).
- **Freshness lines:** current; behind (working-tree and untracked files listed, at most 10); different history after
  a rebase; the list repeated only when it changed; a repo path with spaces and different letter case [R-L].
- **SQL reader:** ≥ 30 cases including down migrations, numeric order, two roots, `$$` bodies, uncertain tables, a
  root with JS migrations.
- **Map-answer decisions:** paths from the input and existing files only; a separate shown set (an edit after a map
  answer still gets its v0.2 note).
- **Launch guard:** silent without launch.md; own projects only; cleaned, data-framed titles; arrived-with-git once;
  phrase check on / off (≥ 10 each), 30-minute cool-down, attended only; facts and the 10-item estimate rule; the
  writer keeps every other byte and announces each change.
- **Integration** (real Claude, the engine registered for the test project only): a "who calls X" answer comes with
  "as of"; after an edit, the answer lists the changed file.
- **Hook table** (principle 2): every new hook use documented in the README's hook list.

## 5. Owner decisions (2026-11-20)

- **Q-M1 [owner]:** no engine installed → a one-time tip naming codebase-memory-mcp and its install page; JSPARK Forge
  installs nothing itself (as with the UI tip).
- **Q-M2 [owner]:** the scope nudge is on whenever `launch.md` exists (as the spec says).
