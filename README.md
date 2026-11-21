<p align="center">
  <a href="https://github.com/harishgoswami23/jspark-forge">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/jspark-ai-logo-dark.jpeg">
      <img alt="JSPARK AI" src="assets/jspark-ai-logo-light.jpeg" width="360">
    </picture>
  </a>
</p>

# JSPARK Forge

**Claude Code forgets. JSPARK Forge doesn't. Open Claude Code and pick up where you left off in 30 seconds.**

*Rules enforced by hooks, not by hoping Claude remembers.*

A Claude Code plugin for technical solo founders. Built for Claude Code, by JSPARK AI. Free and open source (MIT).

> **Plan-limit saves need a plan that reports usage: Claude Pro, Max, Ultra or Team** (Team: observed, re-checked
> each release). Claude Code shares plan usage (5-hour and weekly limits) only with plans that report it. On any plan, JSPARK Forge still saves before the context limit and after every
> step, and `/jspark-forge:handoff` saves on demand.

<!-- demo GIF: kill a session mid-task, reopen, "here's where we were, continue?" -->

---

## What it does

1. **Saves where you are, all the time.** A one-page handoff (task, step, next action, what was running, what is
   waiting on you) is rewritten on every save trigger below. The task is your last real request (not "go on", and not a
   helper's report); the four requests before it and the end of Claude's last reply are kept, work in another git
   project is named ("Also worked in"), and step progress is read from Claude Code's task tools as well as the plan.
   It counts the files not committed (an untracked folder counts every file in it, up to 2000) and says when a repo
   has no commits yet. Resuming a session never wipes the history.
2. **Shows it back after any cutoff, and asks first.** Open Claude Code again: JSPARK Forge shows where you were and
   asks "Continue?" before picking the old task back up. No command to type. If the last session was cut off by a crash
   or a power cut, it also says so and tells Claude to check what was half done first (see "When it saves").
3. **Blocks dangerous actions.** A published list, enforced by hooks, with a typed confirmation to override.
4. **Keeps a short action log** for the step that was cut off (7 days, then a one-paragraph summary per day).
5. **Keeps Claude grounded, and short.** Two rules at every session start. Grounding: cite the file and line, say
   "not found" otherwise, never describe code it has not read. Short by default: lead with the answer, bullets or a
   table for lists, one line of explanation unless you ask for more, and always the warnings, risks, decisions and
   blockers. `- short-answers: off` switches the second one off.
6. **Keeps open questions in sight.** A question Claude asks you that holds up work stays on a "waiting on you" list
   until you answer it: in the status line (`⏳ 2 waiting on you · oldest 14h`), first thing at the next session
   start, and in the handoff, so a cutoff cannot bury it. A question can say what it blocks and whether the answer can
   be undone, and shows `blocks launch item: <title>` when it names an item on your launch list. After you answer,
   Claude offers to record the answer as a decision.
7. **Keeps a local copy of every page Claude publishes.** A link can stop working when you change account; a file
   does not. In your own projects the page's file is copied into `.jspark-forge/artifacts/` and listed in
   `.jspark-forge/artifacts.md` with its link. A page published without a file is listed as having no copy, and Claude
   is told to save it. Session start and `/jspark-forge:check` list pages whose copy is missing. Claude is warned when
   it writes a document into a temporary folder, and once a day session start lists up to 5 such documents that are
   not in the project. The copies stay on your machine: they are not committed.

Your work stays on your machine. No telemetry. JSPARK Forge goes online only when `npm` installs the two servers (once, in the background, on
their first start) and when it adds two companions with `claude plugin install` (see Install).

## How JSPARK Forge differs

| | Claude Code alone | Method / workflow kits | Large all-in-one kits | **JSPARK Forge** |
|---|---|---|---|---|
| Back to work after a crash or limit from a one-page handoff, shown when you open Claude Code | Reopens the whole old conversation | No | Not as a core feature | **Yes** |
| Save forced at 95 % of context or plan usage | No | No | No | **Yes** (plan usage: Pro/Max/Ultra/Team) |
| Dangerous actions blocked by hooks, with a published list and typed override | Permission prompts only | Instructions Claude may forget | Varies, many hooks | **Yes, every hook documented** |
| Small: one job, a handful of hooks | n/a | Yes | No | **Yes** |

Beyond the handoff (where you were), JSPARK Forge keeps the **why** (decision memory), the **what and where** (a code
map, with codebase-memory-mcp), **long builds** that survive a cutoff (build graphs), and a **launch
list** against scope creep. It also has **guest mode** (review someone else's repo without writing anything into it),
**readonly sources** (keep an old system next to the new one, never edited) and a health check
(`/jspark-forge:doctor`). Each is described below.

## Decision memory (the why)

Decisions, rules and lessons for a project live in `.jspark-forge/decisions.md` (commit it to share with your team).
Each is one line, tied to the files it covers. Just before Claude edits one of those files, it sees the decisions that
touch it (as data, not orders). After a commit that settles a choice, or a plan you approve in plan mode, JSPARK Forge
offers *"Record the decision?"*; nothing is recorded without your yes. When a commit changes a covered file, the
decision is flagged for a look: at most once a day for each decision, and not in the 14 days after it was recorded or
verified.

- `/jspark-forge:decide` records, updates, verifies or retires a decision. To turn one into a hard block, it prints
  the line to add to `rules.md` (`forge.js decide --promote <id>`); it never edits `rules.md` itself.
- `/jspark-forge:decisions` lists what is on file. `/jspark-forge:check` asks whether each is still true.
- `/jspark-forge:handoff done` offers once to record the task's lasting lessons as decisions.

## Code map (the what and where)

[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) comes with JSPARK Forge, as a plugin server
(version 0.12.1, installed once with `npm` into `~/.claude/jspark-forge/engines/` in the background on the first start, then started by a small launcher). Claude can answer
"who calls X" and "what breaks if I change Y" from a map of your code instead of reading file after file. JSPARK Forge
keeps the map fresh in the background after commits, and adds how fresh each answer is ("as of <commit>"). Switch it
off with `- code-map: off` under `## Settings` in `rules.md`, or `JSPARK_FORGE_CODE_MAP=off`; then these features stay
quiet and everything else works. `/jspark-forge:doctor` reports whether the engine started.

Migrating from an old system listed as a readonly source (below)? Claude can index it as well, as its own map, and
answer "where is X in the old code?". Those answers are labelled **old code**, with the old system's commit; if the old
code changed since it was indexed, Claude is told to index it again first. It is never edited.

## Skills and briefs for your project

`/jspark-forge:new-skill <name>` creates a project skill from a checked template, and `/jspark-forge:new-brief <name>`
a brief (one job for one helper: goal, what it may and may not change, when it is done). Both are checked for missing
parts. `JSPARK-FORGE.md` in this repo is the whole method in plain words, for any AI tool.

## Database layout

`/jspark-forge:schema [table]` shows the tables, columns, keys and foreign keys your SQL migration files describe,
with the file and line each came from, the commit it was read at, and the decisions that touch each migration file.
It reads the files in `migrations/`, `db/migrations/`, `supabase/migrations/` or `prisma/migrations/` (one layout per
folder, never merged) and never connects to a database. What it cannot read is marked "uncertain", never guessed.

## Works best with superpowers

JSPARK Forge does not teach Claude *how* to build. [superpowers](https://github.com/obra/superpowers) by Jesse
Vincent (MIT) does: brainstorm, plan, test first, review, verify. **It is installed together with JSPARK Forge**: it is
a declared dependency, listed in the JSPARK Forge marketplace from its own repository (nothing is copied or changed).
The handoff then shows superpowers plan progress ("Task 3 of 8").

Already had superpowers from another marketplace? Then it is installed twice and its skills show twice; JSPARK Forge
tells you once which copy to remove.

## Building a UI?

Most of the UI kit arrives by itself (see Install): **frontend-design** and **Chrome DevTools MCP** (so Claude sees
console errors, performance and layout shift) are added once in the background, and **Playwright MCP** (so Claude can
check its own screens) ships with JSPARK Forge and serves tools only in projects with a front end. Only one step is
yours, because it depends on the project. In your own React project, JSPARK Forge says one line, once, if it is
missing:

- **shadcn MCP** (React projects): `npx shadcn@4.23.0 mcp init --client claude`

**Having the skills is not the same as using them.** So in your own project with a front end, JSPARK Forge tells
Claude at every session start, and every helper that builds, plans or reviews, to load frontend-design and your brand
skill before it designs or changes anything a user sees, and to check the result on the real page. Name your brand
skill once with `- brand-skill: <name>` under `## Settings`: in `~/.claude/jspark-forge/rules.md` for every project,
or in a project's `rules.md` for that project. With none named, Claude is told to look for a brand skill among its
skills and to ask you before it chooses colours or a typeface itself. `- ui-skills: off` switches the rule off, and
`/jspark-forge:doctor` says which skills a project uses.

Then give the product its own brand rules and build screens through a checked path:
- **Brand skill:** copy `templates/brand-skill.md` to `skills/brand/SKILL.md` in your project and fill in colours,
  type, spacing, components and voice. Claude follows it for anything a user sees and ends with a screenshot check.
- **The `ui` build graph:** `/jspark-forge:build` with the `ui` template runs design direction (strongest model) →
  **you approve the look** → build → three checks that must pass (screens match the approved look; no accessibility
  violations axe can find, at phone and desktop width, light and dark; Lighthouse scores) → a design review → **your
  final approval**. The check files are ready to copy from `templates/ui/`. Choices and sources: `docs/ui-research.md`.

This makes good UI the default path, not luck. The look is still only as good as the direction you approve.

## Launch list

Keeps scope creep in sight before a launch. `/jspark-forge:launch` creates `.jspark-forge/launch.md` (commit it): a
launch date, 5 blank slots for what must work, a "Critical paths" line and an "After launch" list. Until that file
exists, JSPARK Forge does nothing here. Then, in your own projects only:

- each session starts with the launch date and the open and done items (titles are passed to Claude as data);
- a prompt that sounds like new scope ("can we add", "while we're at it", "add a new feature") gets one line suggesting
  `/jspark-forge:scope`, at most every 30 minutes, only when someone is at the keyboard, never at 95 % usage;
- `/jspark-forge:scope` shows the facts first (the list count, "this becomes #8", critical paths touched, and an
  estimate only after 10 finished items with dates), then asks: now, after launch, a smaller version, or drop;
- items that arrived with git are listed to you once; every change through JSPARK Forge is announced.

It never blocks anything.

## When it saves (published list)

1. Every message from you.
2. After any tool call that writes or edits a file.
3. Once a minute while Claude works without writing files (commands, helpers, a new branch).
4. After any commit Claude makes (a commit you make yourself is noticed at the next save).
5. When Claude finishes a reply.
6. Just before the conversation is compacted.
7. When the session ends.
8. At **80 %** of context or plan usage (quiet) and at **95 %** (forced, and you see:
   *"Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were."*).
9. When you sign in again during a session. You are told to start a new session and say "resume" if you changed
   account. This rests on a notice from Claude Code that has not yet been seen to arrive after `/login`, so do not
   count on it.

`/jspark-forge:handoff` saves on demand. A save is written only when there is work to resume.

A crash or a hard limit gives no warning, so at most the last minute of work is lost, and the next session is also
given what the action log holds after the last save.

If the machine itself dies (a power cut, a crash, a killed window):

- **Saves are forced to disk** before they replace the old file, and the handoff before the newest is kept. If the
  newest is damaged, the one before it is shown and the doctor says so. If both are, the next session is given what
  the action log holds.
- **What is in flight is recorded:** each command, file write or helper that has started and not finished.
- **At the next start** you are told the last session "was cut off, or is still open in another window" (JSPARK Forge
  cannot tell the two apart). Claude is told what was half done: what was in flight, which background commands and
  helpers are gone (dev servers die with the machine; Claude asks before starting them again), which files written in
  the last 2 minutes are now missing, empty or end in NUL bytes, what was logged after the last save, and Claude's last
  words. Claude checks before carrying on.

It waits 90 seconds of silence (10 minutes when all that is left is a command in flight, such as a long test run)
before it says so. It never changes another window's files, and it stays quiet after a session that ended normally
and in a folder that is not a git repo.

**What a crash can still lose:** the reply Claude was writing, output a program had not yet written to disk, and the
newest log lines if the cut came before they reached the disk. The NUL-byte check is a hint, not proof. Secrets quoted
in what it shows are hidden on a best-effort basis: common shapes, not every secret.

## What it blocks (published list)

Each needs you to type `CONFIRM <name>` to allow it once (then Claude Code's normal yes/no prompt). When JSPARK Forge
blocks something, Claude is told: *"Do not try an equivalent command; tell the user and stop."*

| Name | Blocks |
|---|---|
| `rm-rf-outside` | `rm -rf`, `Remove-Item -Recurse`, `rd /s` outside the project, and inside it on the project root, `.` or `.git`. On your home folder, the root or a whole drive it is **always refused** |
| `git-force-push-main` | `git push --force` / `--force-with-lease` to `main` or `master` |
| `git-reset-hard` | `git reset --hard`; also `git checkout -- .`, `git restore .`, `git restore --staged .` at the project root |
| `git-clean-fdx` | `git clean -fdx` |
| `git-stash-drop` | `git stash drop`, `git stash clear` |
| `sql-destroy` | `DROP`, `TRUNCATE`, `DELETE` without `WHERE` (psql, mysql, sqlite3, sqlcmd, `Invoke-Sqlcmd`, database MCP tools) |
| `db-write` | A write to a production database: any statement that is not a read (`SELECT`, `WITH … SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) through a database MCP server or a client (`psql`, `mysql`, `sqlite3` on a remote host, `mongosh`, `redis-cli`, `sqlcmd`, `Invoke-Sqlcmd`, `pg_restore -d`), a script file, redirect or pipe into a remote client (its content is unknown), `supabase db push`, `prisma db push` / `migrate deploy` / `migrate reset`, the write tools of Redis, DynamoDB and MongoDB servers, and migration-apply, merge, reset and restore tools of database MCP servers. Reads are never blocked. Production is every database MCP server and every host except localhost, `127.x.x.x`, `::1`, a Unix socket or a local file (a host in an unresolved variable, a `service=` or a `--login-path` counts as production); to mark one as dev, add `- database dev: host:*.dev.internal` (every host in the command must match), `- database dev: mcp:local_postgres` (an exact MCP server name, or `mcp:local_*` for a prefix) or a bare exact host or server name under `## Settings` in **your own** `~/.claude/jspark-forge/rules.md` (a project's `rules.md` cannot, like `disable:`). A seatbelt, not a sandbox: SQL inside a stored procedure is not seen, and JSPARK Forge never connects to a database |
| `secret-files` | Editing `.env*`, key, secret and credential files, also via `>`, `tee`, `Set-Content`, `Out-File` (templates such as `.env.example` and `.env.sample` are allowed) |
| `chmod-wide` | `chmod 777`, `chmod -R`, `icacls … /grant Everyone:F` |
| `pipe-to-shell` | `curl … \| sh`, `iwr … \| iex`, `iex (irm …)` and similar |
| `readonly-source` | Any change to an old system listed under `## Sources` in `rules.md` (below). **Always refused** |
| `forge-state` | Any change to a build graph's running record (`.jspark-forge/state/graph-*`), and running JSPARK Forge's own hooks from the shell. **Always refused**: only JSPARK Forge writes it. A command that only *looks* like it might write the record asks you first (Claude Code's normal yes/no prompt, no CONFIRM) |
| `guest-quarantine` | In a repo you are reviewing, after `/jspark-forge:init --guest`: its install, build, test and run commands (see guest mode). One CONFIRM covers the rest of that session |

Bash, Git Bash, PowerShell and cmd forms are all matched (PowerShell from v0.1.1), also when one shell starts another
(`powershell -Command "…"`, `bash -c "…"`, `cmd /c "…"`). Commands inside `$( )`, backticks, `if` / `for` blocks,
`eval`, `find -exec` and PowerShell script blocks are checked too; a commit message is text, not a command. A command
with two different blocks needs both CONFIRMs.

Add your own in `.jspark-forge/rules.md` ("Confirm" or "Never" lines; commit it to share them with your team), or in
`~/.claude/jspark-forge/rules.md` for every project. Switching a built-in block off (`- disable: chmod-wide`) works
only in that personal file: a project's `rules.md` may come from a repo you cloned, so it can add rules but never
remove one. Blocks also fire inside helper agents.

**Migrating from an old system?** List it under `## Sources` in `rules.md` (`- readonly: ../legacy-app : migrating
from`): Claude can read it but any change to it (edit, write, move, delete, `sed -i`, `git -C … commit`) is always
refused, with no CONFIRM. Remove the line to allow edits. The handoff names it and its commit.
This is a seatbelt, not a sandbox: a deliberately disguised command can get past pattern matching.

## Install

Needs Claude Code, git and **Node.js 18 or newer**. If Node.js is missing or too old, JSPARK Forge says so when Claude
Code starts (*"JSPARK Forge is off: it needs Node.js 18 or newer…"*) instead of failing silently.

```
/plugin install jspark-forge --marketplace harishgoswami23/jspark-forge
```

That is the whole install. superpowers comes with it. On first start JSPARK Forge sets up, by itself, each with its undo:

- **Auto-update.** It switches on updates for the JSPARK Forge marketplace (one key in your `settings.json`, once per
  machine), so each new version loads the next time Claude Code starts. Undo: `/plugin`, then **Marketplaces**, then
  **jspark-forge**.
- **The code map** (codebase-memory-mcp 0.12.1), as a plugin server. Undo: `- code-map: off` under `## Settings` in
  `rules.md`, or `JSPARK_FORGE_CODE_MAP=off`.
- **Playwright** (`@playwright/mcp` 0.0.86), as a plugin server, so Claude can check its own screens. It gives Claude
  tools only in a project with a front end. It needs Node.js 20 or newer and stays off on Node.js 18 and 19. Undo:
  `- playwright: off` under `## Settings` in `rules.md`, or `JSPARK_FORGE_PLAYWRIGHT=off`.
- **frontend-design and Chrome DevTools**, added once, in the background, from Anthropic's plugin directory. They load
  the next time Claude Code starts. Undo: `/plugin uninstall frontend-design@claude-plugins-official` and
  `/plugin uninstall chrome-devtools-mcp@claude-plugins-official`.
- **A status line**, only when you have none. Undo: `/jspark-forge:init --undo-statusline`.

Undo for the two servers stops them but does not delete them. They sit in `~/.claude/jspark-forge/engines/` (under
`CLAUDE_CONFIG_DIR` if you set it); delete that folder to remove them. They are installed again on the next start unless
you have switched them off.

To stop the automatic switch-on of auto-update and the two companions, set `JSPARK_FORGE_AUTO_SETUP=off`.

What this adds to your machine, said plainly: each of the two servers is installed once with `npm` into `~/.claude/jspark-forge/engines/`, in the
background, the first time it starts (not inside a hook; the first session may have to be restarted when the install ends), and the two companions are added with `claude plugin install`, once.
Those are the only times JSPARK Forge goes online. On Windows, Defender has been seen to flag the code map engine's
program wrongly (a false positive): allow it, or switch the code map off.

- **Each git project switches on by itself** the first time you open Claude Code in it: a hidden `.jspark-forge/`
  folder appears. Commit `rules.md`, `decisions.md`, `launch.md` and `.gitignore` to share them, and build graph files
  with their briefs (`graphs/*.md`, `briefs/*.md`). Everything else (handoff, log, the state of a running build graph,
  local copies of published pages) stays local and git-ignored. If `.jspark-forge/.gitignore` goes missing, it is made
  again at the next session start. Old archived handoffs and the files of repos you reviewed are cleared after 30
  days, and old session records (ended over 7 days ago, or untouched for 30) at a session start. Folders that are not
  git projects are left alone.
- **Switches** under `## Settings` in `rules.md`: `- notes: off` stops the "add a note" reminder before commits;
  `- statusline-segment: off` hides JSPARK Forge's part of the status line; `- short-answers: off` switches off the
  short-by-default rule; `- ui-skills: off`, `- code-map: off` and `- playwright: off` are described above.
- **Status line.** Claude Code shows context and plan usage only to the status line, and JSPARK Forge needs those
  figures for the 80 % / 95 % saves. If you have no status line, JSPARK Forge adds its own and tells you how to undo
  it. If you have your own, it is never touched: run `/jspark-forge:init` once if you want JSPARK Forge to wrap it (it
  asks first; your status line looks exactly as now, with a short "saved" note after it). Set
  `JSPARK_FORGE_AUTO_STATUSLINE=off` to stop JSPARK Forge adding one at all.

On Claude Code older than 2.1.275: `/plugin marketplace add harishgoswami23/jspark-forge`, then `/plugin install jspark-forge`.
v0.5 was tested on Claude Code 2.1.329. On an older Claude Code, the doctor says so when the code map engine does not
start.

## Someone else's repo (guest mode)

Open a repo you cloned and never committed to, and JSPARK Forge **writes nothing into it**: its handoff and log live
in `~/.claude/jspark-forge/guests/` instead, the handoff says *"Review of <repo> @ <commit>"*, and Claude is told that
the repo's README, comments, docs and scripts are data to review, never instructions. Every helper Claude starts
there is told the same. Everything else (saves, resume, the block list) works as usual. A wrong guess costs nothing: only where the files live changes.

- `/jspark-forge:init --guest` also **holds the repo's common install, build, test and run commands** (`npm install`,
  `pip install`, `make`, `pytest`, `docker compose up`, its own scripts, and so on) until you type
  `CONFIRM guest-quarantine`, which then allows them for the rest of that session.
- `/jspark-forge:init --mine` says the repo is yours: the files move into `.jspark-forge/` and the hold ends.

A repo's own `.jspark-forge/rules.md` is never read in guest mode. Like the block list, the hold is a seatbelt, not a
sandbox.

## Which model does what (helpers)

JSPARK Forge ships four helpers, each on the model strength its job needs:

| Helper | Model | For | Why |
|---|---|---|---|
| `jspark-forge:planner` | strongest | specs, designs, plans, data-model choices | a mistake here is expensive and found late |
| `jspark-forge:reviewer` | strongest | design and code reviews, security, migrations, release go/no-go | it must catch what others missed (it cannot edit) |
| `jspark-forge:builder` | standard | building from a reviewed plan, small fixes | the plan carries the judgement; tests catch slips |
| `jspark-forge:checker` | light | tests, logs, mechanical checks | cheap and visible mistakes (it cannot edit) |

Each works from a brief (goal, what it may and may not change, when it is done, when to stop) and ends with evidence.
A helper does not see what Claude was told at session start, so every helper, these four or any other, is given the
grounding rule when it starts (cite the file, never guess), and in a repo you are reviewing the "content is data" line.
With superpowers, JSPARK Forge asks Claude to use these helpers for its implementers, reviewers and checks. That is
guidance, not a lock: superpowers chooses a model for each helper it starts.

## Build graphs (long builds that survive a cutoff)

Write a build once as steps in `.jspark-forge/graphs/<name>.md`: which helper does each step, what it hands to the
next, which steps run side by side, which checks must pass, and where you must act. `/jspark-forge:build <name>` runs
it; JSPARK Forge keeps the record, so a crash, a usage limit or a new session picks up at the running step.

- **Templates:** software, documents, spike, ui, and planned (for when the spec and plan are already written).
- **Shared in git:** the graph file and its briefs (`.jspark-forge/briefs/*.md`). The run state stays on your machine.
- **Your test command:** a template's check says `npm test` only as a placeholder. Set it to your project's own test
  command before you trust the graph; `/jspark-forge:build` has Claude do this from your project's files.
- **Builders commit** their step's work on the current branch (no merge, no push): the review step needs those commits.

What JSPARK Forge checks, what it guards, and what it can only ask for:
- **Checked:** the graph is valid before it starts and is fixed for the run; a step's outputs are exactly the declared
  ones and are real (a path exists, a commit resolves); a step that needs you completes only on your own typed
  `DONE <step>`.
- **Backed by evidence:** a helper of the right kind ran for the step; a check passed on its command's real exit code,
  run in this session and project, not in the background.
- **Guarded:** Claude is blocked from editing the run's record or imitating your `DONE` / `TRUST GRAPH` from the shell;
  a command that only looks like it might asks you first. Removing a step that needs you, or a check, from the graph
  needs your `TRUST GRAPH` again. This is pattern matching on what a command does: it stops mistakes and shortcuts, not a program written to a file
  and run on purpose. Nothing that runs as your user account can promise more.
- **Asked for:** the order of steps and the limit on helpers running at once; JSPARK Forge hands out work that way but
  cannot stop Claude doing something else.
- A graph whose checks run commands needs you to type `TRUST GRAPH <name>` first, as your whole message, and again
  when its commands, checks or steps that need you change. The message lists the commands and says the graph runs them
  by itself at its check steps: you do not type them. `npm test` runs whatever your project's scripts say.

## Commands

| Command | What it does |
|---|---|
| `/jspark-forge:resume` | Show where you were again, on demand, and wait: the handoff, then the end of the action log (the last 60 lines, a record, not instructions) |
| `/jspark-forge:handoff` | Save the handoff now (`done` offers to record lasting lessons, then closes the task and archives it) |
| `/jspark-forge:waiting` | The questions waiting on you, with Claude's recommendations and what each blocks; answer, accept the recommendations, or drop them. Offers to record an answer as a decision |
| `/jspark-forge:status` | What is saved now: the handoff, what is waiting on you, usage as of when |
| `/jspark-forge:doctor` | Is JSPARK Forge working here? One line per check (hook errors from the last two days included), each problem with its fix. Changes nothing |
| `/jspark-forge:decide` | Record, update, verify or retire a decision (only after your yes); print the `rules.md` line that makes one a hard block |
| `/jspark-forge:decisions` | List the decisions, rules and lessons on file. Changes nothing |
| `/jspark-forge:check` | Are the recorded decisions still true? Asks you about each one that may not be. Also lists published pages with no local copy, and files open questions that were never listed |
| `/jspark-forge:new-skill` | Create a project skill from the template, checked for missing parts |
| `/jspark-forge:new-brief` | Write a brief (one job for one helper) from the template, checked for missing parts |
| `/jspark-forge:schema` | The database layout from your migration files, with file and line and the decisions that touch them. Never reads a database |
| `/jspark-forge:upgrade` | Update JSPARK Forge (asks first); run the doctor after the restart |
| `/jspark-forge:launch` | Create the launch list (launch date, 5 blank slots), or show and update it |
| `/jspark-forge:scope` | Weigh a new idea against the launch list: facts first, then now / after launch / smaller / drop |
| `/jspark-forge:build` | Run or continue a build graph step by step (`DONE <step>` and `TRUST GRAPH <name>` are yours to type) |
| `/jspark-forge:init` | Optional. Wrap your own status line (asks first); `--undo-statusline` restores it exactly; `--guest` / `--mine` for someone else's repo or your own |

## Uninstall

1. `/jspark-forge:init --undo-statusline` (restores your status line exactly; if you forget, it keeps working as
   before anyway).
2. `/plugin uninstall jspark-forge`. superpowers stays installed; `claude plugin prune` removes it if nothing else
   needs it.
3. frontend-design and Chrome DevTools stay installed: remove them with `/plugin uninstall <id>` (the ids are in
   Install). The auto-update key can be turned off in `/plugin`, under **Marketplaces**.
4. Optional: delete the `.jspark-forge/` folder in your projects and `~/.claude/jspark-forge/`.

## Privacy

Your files and the handoff stay on your machine. The handoff holds paths, short text and the last lines of Claude's reply, never file contents. The log
hides likely secrets (keys, tokens, passwords) before writing. After a cut-off session, Claude's last words are read
from the end of that session's transcript, only when that file is inside the Claude home. JSPARK Forge itself sends nothing anywhere. It goes
online only through `npm` (the one-time install of the code map and Playwright servers) and through `claude plugin install`
(once, for the two companions). Those two programs, and the servers they run, are not JSPARK Forge's own code. A hook
never waits on a download.

## Every hook, documented

Every hook runs `node scripts/forge.js <event>` and fails open: an error never blocks Claude Code. A hook that fails
skips its save or block, so the error is not hidden: `/jspark-forge:doctor` counts hook errors from the last two days,
and a session start says so once a day. Files are written
only in the project's `.jspark-forge/` (or, for a repo you are reviewing, `~/.claude/jspark-forge/guests/<id>/`).
Details per feature: [design-v0.1.md](docs/design-v0.1.md), [design-v0.1.1.md](docs/design-v0.1.1.md),
[design-v0.2.md](docs/design-v0.2.md), [design-v0.3.md](docs/design-v0.3.md), [design-v0.4.md](docs/design-v0.4.md).
Before each release, every promise in the spec is checked against the code and its tests; what is partly built or not
built is listed in [spec-coverage.md](docs/spec-coverage.md).

| Hook (time limit) | What it does | What it writes | Can it block? |
|---|---|---|---|
| SessionStart (10 s; a Node check first, 5 s) | Switches JSPARK Forge on in a git project; shows where you were and waits; the crash check after a cut-off session; questions waiting on you; the grounding rule; the short-by-default rule; decision index; code map freshness; launch list; a running build graph; pages with no local copy; one-time tips; at most once a day each: a hook error was logged, documents left in a temporary folder, a repo with no commits yet | the handoff state, the action log, `state/` files | No |
| UserPromptSubmit (10 s) | Switches JSPARK Forge on if session start missed it; saves the handoff on each message from you; your `CONFIRM <name>`, `TRUST GRAPH <name>`, `DONE <step>`; clears a question you answered; offers to record a decision; the launch-scope nudge | handoff, confirm tokens, session state, graph trust and state | No |
| PreToolUse (3 s; shell, edits, the question tool, MCP tools) | The block list (asks or denies); files a question you are asked; the decisions about a file just before Claude edits it; the notes reminder before a commit; notes an allowed command, file write or helper as in flight | waiting list, "already shown" ids, in-flight records | **Yes**: deny or ask |
| PostToolUse (10 s) | Saves after file changes and commits, and once a minute while Claude works; clears the in-flight record; keeps a local copy of a published page; warns about a document written to a temporary folder; offers to record a decision; stale-decision flags; code map freshness on map answers; build graph evidence (gate results, helper tokens); "recorded" notices | handoff, task and session state, map and graph state, `artifacts/` and `artifacts.md` | No |
| PostToolUseFailure (10 s) | Logs the failure; clears the in-flight record; a failed gate command stops a build graph | log, graph state | No |
| Stop (10 s) | Saves the handoff after each reply; files a closing question when there is work; clears what was in flight | handoff, waiting list | No |
| PreCompact (10 s) | Saves before compaction (prints nothing) | handoff | No |
| SessionEnd (1 s) | Marks the session ended | session state | No |
| Notification, sign-in only (10 s) | Shows one line when a sign-in completes during a session, saves the handoff and writes the log, and says how to carry on after a change of account (not yet seen to arrive after `/login`) | the handoff, the action log | No |
| SubagentStart / SubagentStop (10 s) | Tracks running helpers; build graph evidence that a helper ran; at start also gives every helper the grounding rule, in a repo you are reviewing the "content is data" line, and in a front-end project the UI rule | session and graph state | No |

The status line (if you let JSPARK Forge add or wrap it) writes usage figures to `usage/` and shows "saved …" and
"waiting on you". The code map's background refresh (`scripts/map-refresh.js`) is started by hooks and runs
codebase-memory-mcp's indexer; it never blocks a hook.

## Credits and licence

MIT. Built for Claude Code; not made or endorsed by Anthropic. superpowers is by its own authors under its own
licence.
