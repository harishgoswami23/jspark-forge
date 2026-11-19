# JSPARK Forge v0.3: design

Status: draft for review, 2026-11-20. Scope: spec 5.4 (codebase map: integrate, don't build) and 5.5 (launch-scope
guard). Engine chosen by the Windows trial: **codebase-memory-mcp** ([`engine-trial.md`](engine-trial.md)). Earlier
designs: [`design-v0.1.md`](design-v0.1.md), [`design-v0.1.1.md`](design-v0.1.1.md), [`design-v0.2.md`](design-v0.2.md).

---

## 1. The code map: an engine plus three JSPARK Forge layers (spec 5.4)

JSPARK Forge builds no index. Claude asks the engine directly (its MCP tools: `search_graph`, `trace_path`,
`detect_changes`, `get_file_outline`, `get_architecture`). JSPARK Forge adds only what the engine lacks: freshness tied
to git, the database layout from migration files, and the decisions about each file.

### 1.1 Detection

- **On** when the engine is reachable: an MCP server whose command or name contains `codebase-memory` in the project's
  `.mcp.json` or the user's Claude Code config, or the `codebase-memory` plugin is installed. Read once per session
  start; no process is started to check.
- **Off** otherwise: every map feature is silent; everything else works (principle 7). Once per project with a git
  repo of more than ~2,000 source lines, a one-line tip names the engine and its install page.
- Other engines (CodeGraph) may be added later behind the same three layers; not in v0.3.

### 1.2 Freshness: "as of <commit>"

The engine records when it indexed (`indexed_at`), not which commit. JSPARK Forge keeps `state/map.json`:
`{ commit, indexedAt, dirty, startedAt, pid }`.

- **After a commit** (PostToolUse, the existing detection), and **at session start when `HEAD` moved** since the
  recorded commit: JSPARK Forge starts `scripts/map-refresh.js` **detached** (never in front of the next tool call),
  which runs `codebase-memory-mcp cli --quiet index_repository {"repo_path": …}` and, when it finishes, records the
  commit it indexed. A refresh already running is not started again (`startedAt` under 2 minutes and the process
  alive); a finished one that changed nothing is cheap (the trial: 5 s after one edit on 68,000 lines).
- **Between commits**, the engine's own watcher keeps the session's project current when Claude Code runs it as an
  MCP server; JSPARK Forge does not re-index per edit (spec 5.4's "file by file" is the engine's watcher).
- **Every map answer carries its freshness:** PostToolUse on a `mcp__*codebase-memory*` tool adds one line of
  context: *"Code map as of 3f2e1d0 (indexed 14:02); HEAD is 9a8b7c6, 2 commits ahead: say "as of 3f2e1d0" when you
  use this answer, and read the files listed below before relying on them: src/a.ts, src/b.ts"* (files changed since
  the indexed commit, `git diff --name-only`, at most 10). When the map is current: *"Code map current (as of
  9a8b7c6)."* A map behind `HEAD` always says so (spec 5.4).
- **Session start** (when on): one line for Claude: which engine, as of which commit, how far behind.

### 1.3 The database layout from source files (never the live database)

- **Prisma:** the engine indexes models, fields and relations (trial); Claude asks it.
- **SQL migrations** (the engine indexes only table names): `scripts/lib/schema.js` reads `migrations/**/*.sql`,
  `db/migrations/**`, `supabase/migrations/**`, `prisma/migrations/**/migration.sql` and `*.sql` under folders named
  `schema` or `migrations`, in file-name order, and replays `CREATE TABLE`, `ALTER TABLE … ADD / DROP / RENAME COLUMN`,
  `DROP TABLE`, `REFERENCES` / `FOREIGN KEY`. Output: tables, columns (name, type, null / default, primary key) and
  foreign keys, each with the file and line it came from. Lenient: a statement it cannot read is skipped and counted.
- **`/jspark-forge:schema [table]`** (`forge.js schema`): the layout, "as of <commit>", with sources. Read-only. Works
  without the engine (the SQL reader is JSPARK Forge's own).
- Store nothing (principle 11): computed from the files on each call; under 200 ms for a few hundred migrations.

### 1.4 Decisions on the map

- PostToolUse on a map tool call: the file paths in its answer are matched against active decisions (v0.2 matching);
  the ones that apply are added to the same freshness line, framed as project notes, at most 3, and marked as shown
  (same once-per-conversation rule as v0.2 1.3). A map answer about `src/billing/` then carries *"D-012 Prices are
  stored in cents"*.
- `/jspark-forge:schema` lists the decisions that touch each migration file next to its table.

### 1.5 `/jspark-forge:check`, extended

Adds: the map is N commits behind (files changed since), the engine reported parse problems (`index_status`), the
refresh failed last time (its log line). Each with "refresh now?" → `forge.js map refresh` (the same detached run).
Read-only unless the user says yes.

### 1.6 Limits

The engine decides what "where" and "callers" mean; JSPARK Forge does not check its answers, only their age. A
refresh can lag a commit by its own run time (seconds on 50k lines). The SQL reader understands common DDL, not every
dialect: unknown statements are counted, never guessed.

---

## 2. Launch-scope guard (spec 5.5)

### 2.1 The launch list

- `.jspark-forge/launch.md` (committed; shared like `decisions.md`; added to the `.gitignore` exceptions when created),
  made by `/jspark-forge:launch`: a launch date, **5 blank slots**, a "Critical paths" line (folders or globs such as
  `src/billing/**, src/auth/**`), and an "After launch" list. Each item: `- [ ] <title> (started <date>) (done <date>)`.
- **The guard does nothing until the file exists** (spec 5.5).

### 2.2 Detection: facts first, the judgement is Claude's

- **Session start:** the launch date, items open / done, and the titles (≤ 60 words).
- **UserPromptSubmit:** a cheap phrase check for new scope ("let's also", "can we add", "what if we", "new feature",
  "add support for", "while we're at it" and a few more; whole prompt under 400 characters only, so pasted logs do
  not trigger it) adds one line: *"JSPARK Forge: this may be new scope. Before starting, run the scope check
  (/jspark-forge:scope)."* At most once per user turn; never when the prompt is a reply to a question.
- **`/jspark-forge:scope` (skill)**, facts before any estimate:
  - **modules and files** it would likely touch: from the map when on (`search_graph`, `get_architecture`), else from
    file names;
  - **critical paths** among them (the launch file's list);
  - **the launch list:** "your list has 7 items; this becomes #8";
  - **a time range only with ≥ 10 finished items** that have start and done dates (the median and range of their
    durations), always marked "estimate";
  - then the options: now / after launch / a smaller version / drop, and the over-engineering line ("this is more
    than the problem needs; the simplest version is …") when it applies.
- **The choice is recorded** with the v0.2 decision flow (offered, then recorded only after the user's yes), and the
  item is added to the launch list or its "After launch" list by `forge.js launch add|after|done`.

### 2.3 Limits

The phrase check misses new scope said in other words; it never blocks. Estimates need history; before 10 finished
items there are none.

---

## 3. Tests (both parts)

- Detection: engine present or absent in `.mcp.json`, user config, plugin list; absent → no map line anywhere.
- Freshness: after a commit, a detached refresh starts once (a second commit while it runs does not start another);
  the recorded commit is the one indexed; a map tool answer gets "as of" and the changed-file list; current map says
  current. A fake engine binary (a small Node script answering `cli index_repository`) keeps tests fast and offline.
- SQL reader: ≥ 25 cases (create, alter add / drop / rename, foreign keys inline and table-level, quoted names,
  Postgres / MySQL / SQLite forms, comments, statements it cannot read counted).
- Decisions on map answers: paths in an answer match, at most 3, once per conversation.
- Launch guard: silent without launch.md; phrase check on and off cases (≥ 10 each); once per turn; never on long
  prompts; the facts line; estimates only from ≥ 10 dated items.
- Integration (real Claude, the engine installed for the test only): a "who calls X" question answered with "as of".

## 4. Open questions for the owner

- **Q-M1:** the tip when no engine is installed: name codebase-memory-mcp with its install page only, or also offer
  `/jspark-forge:map install` that runs the official installer after asking? Recommendation: name only (JSPARK Forge
  installs nothing itself, as with the UI tip).
- **Q-M2:** the scope phrase check: on by default when `launch.md` exists (spec), or opt-in? Recommendation: on, as the
  spec says; it is one line and only after a matching prompt.
