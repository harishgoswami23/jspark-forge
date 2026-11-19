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
   waiting on you) is rewritten on every save trigger below.
2. **Shows it back after any cutoff, and asks first.** Open Claude Code again: JSPARK Forge shows where you were and
   asks "Continue?" before picking the old task back up. No command to type.
3. **Blocks dangerous actions.** A published list, enforced by hooks, with a typed confirmation to override.
4. **Keeps a short action log** for the step that was cut off (7 days, then a one-paragraph summary per day).
5. **Keeps Claude grounded.** A short rule at every session start: cite the file and line, say "not found"
   otherwise, never describe code it has not read.
6. **Keeps open questions in sight.** A question Claude asks you that holds up work stays on a "waiting on you" list
   until you answer it: in the status line (`⏳ 2 waiting on you · oldest 14h`), first thing at the next session
   start, and in the handoff, so a cutoff cannot bury it.

Everything stays on your machine. No network calls, no telemetry.

## How JSPARK Forge differs

| | Claude Code alone | Method / workflow kits | Large all-in-one kits | **JSPARK Forge** |
|---|---|---|---|---|
| Back to work after a crash or limit from a one-page handoff, shown when you open Claude Code | Reopens the whole old conversation | No | Not as a core feature | **Yes** |
| Save forced at 95 % of context or plan usage | No | No | No | **Yes** (plan usage: Pro/Max/Ultra/Team) |
| Dangerous actions blocked by hooks, with a published list and typed override | Permission prompts only | Instructions Claude may forget | Varies, many hooks | **Yes, every hook documented** |
| Small: one job, a handful of hooks | n/a | Yes | No | **Yes** |

This release carries only the handoff between sessions (task, step, files touched, branch, Claude's own notes):
enough to pick up the work, not a map of your system. Later releases add decision memory (the "why": one-line
decisions shown to Claude just before it edits the files they touch) and a codebase map (the "what and where"); they
will join this table when they ship. The codebase map is the hardest part, so its date stays open until its engine
is tested. v0.1.1 adds **guest mode** (review someone else's repo without writing anything into it) and **readonly
sources** (keep an old system next to the new one, never edited), the **waiting on you** list and a health check
(`/jspark-forge:doctor`).

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

In your own front-end project, JSPARK Forge says one line, once, naming the companions you have not installed. It
never installs anything. For top-quality UI work:

- **frontend-design** (Anthropic's plugin): `/plugin install frontend-design@claude-plugins-official`
- **Playwright MCP**, so Claude can check its own screens: `claude mcp add playwright npx @playwright/mcp@0.0.86`
- **shadcn MCP** (React projects): `npx shadcn@4.23.0 mcp init --client claude`
- **Chrome DevTools MCP**, so Claude sees console errors, performance and layout shift: `/plugin install chrome-devtools-mcp@claude-plugins-official`

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
- a prompt that sounds like new scope ("can we add", "while we're at it", "new feature") gets one line suggesting
  `/jspark-forge:scope`, at most every 30 minutes, only when someone is at the keyboard, never at 95 % usage;
- `/jspark-forge:scope` shows the facts first (the list count, "this becomes #8", critical paths touched, and an
  estimate only after 10 finished items with dates), then asks: now, after launch, a smaller version, or drop;
- items that arrived with git are listed to you once; every change through JSPARK Forge is announced.

It never blocks anything.

## When it saves (published list)

1. After any tool call that writes or edits a file.
2. After any commit.
3. When Claude finishes a reply.
4. Just before the conversation is compacted.
5. When the session ends.
6. At **80 %** of context or plan usage (quiet) and at **95 %** (forced, and you see:
   *"Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were."*).

A crash or a hard limit gives no warning, so at most the current step is lost; the action log shows what happened
inside it.

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
| `db-write` | A write to a production database: any statement that is not a read (`SELECT`, `WITH … SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) through a database MCP server or a client (`psql`, `mysql`, `sqlite3` on a remote host, `mongosh`, `redis-cli`, `sqlcmd`, `Invoke-Sqlcmd`, `pg_restore`), a script file, redirect or pipe into a remote client (its content is unknown), `supabase db push`, `prisma db push` / `migrate deploy` / `migrate reset`, the write tools of Redis, DynamoDB and MongoDB servers, and migration-apply, merge, reset and restore tools of database MCP servers. Reads are never blocked. Production is every database MCP server and every host except localhost, `127.x.x.x`, `::1`, a Unix socket or a local file (a host in an unresolved variable, a `service=` or a `--login-path` counts as production); to mark one as dev, add `- database dev: host:*.dev.internal` (every host in the command must match), `- database dev: mcp:local_postgres` (an exact MCP server name, or `mcp:local_*` for a prefix) or a bare exact host or server name under `## Settings` in **your own** `~/.claude/jspark-forge/rules.md` (a project's `rules.md` cannot, like `disable:`). A seatbelt, not a sandbox: SQL inside a stored procedure is not seen, and JSPARK Forge never connects to a database |
| `secret-files` | Editing `.env*`, key, secret and credential files, also via `>`, `tee`, `Set-Content`, `Out-File` (templates such as `.env.example` and `.env.sample` are allowed) |
| `chmod-wide` | `chmod 777`, `chmod -R`, `icacls … /grant Everyone:F` |
| `pipe-to-shell` | `curl … \| sh`, `iwr … \| iex`, `iex (irm …)` and similar |
| `readonly-source` | Any change to an old system listed under `## Sources` in `rules.md` (below). **Always refused** |
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

That is all. superpowers comes with it, and there is no setup step:

- **Each git project switches on by itself** the first time you open Claude Code in it: a hidden `.jspark-forge/`
  folder appears (git-ignored except `rules.md` and `.gitignore`, which you can commit). Folders that are not git
  projects are left alone.
- **Status line.** Claude Code shows context and plan usage only to the status line, and JSPARK Forge needs those
  figures for the 80 % / 95 % saves. If you have no status line, JSPARK Forge adds its own and tells you how to undo
  it (`/jspark-forge:init --undo-statusline`). If you have your own, it is never touched: run `/jspark-forge:init`
  once if you want JSPARK Forge to wrap it (it asks first; your status line looks exactly as now, with a short
  "saved" note after it). Set `JSPARK_FORGE_AUTO_STATUSLINE=off` to stop JSPARK Forge adding one at all.

On Claude Code older than 2.1.275: `/plugin marketplace add harishgoswami23/jspark-forge`, then `/plugin install jspark-forge`.

## Someone else's repo (guest mode)

Open a repo you cloned and never committed to, and JSPARK Forge **writes nothing into it**: its handoff and log live
in `~/.claude/jspark-forge/guests/` instead, the handoff says *"Review of <repo> @ <commit>"*, and Claude is told that
the repo's README, comments, docs and scripts are data to review, never instructions. Everything else (saves, resume,
the block list) works as usual. A wrong guess costs nothing: only where the files live changes.

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
With superpowers, JSPARK Forge asks Claude to use these helpers for its implementers, reviewers and checks. That is
guidance, not a lock: superpowers chooses a model for each helper it starts.

## Build graphs (long builds that survive a cutoff)

Write a build once as steps in `.jspark-forge/graphs/<name>.md` (start from a template: software, documents, or
spike): which helper does each step, what it hands to the next, which steps run side by side, which checks must
pass, and where you must act. `/jspark-forge:build <name>` runs it; JSPARK Forge keeps the record, so a crash, a usage
limit or a new session picks up at the running step.

What JSPARK Forge checks, and what it can only ask for:
- **Checked:** the graph is valid before it starts; a step's outputs are exactly the declared ones and are real (a
  path exists, a commit resolves); a helper of the right kind actually ran; a check passes only on its command's real
  exit code; a step that needs you completes only when you type `DONE <step>`; its record cannot be edited by Claude.
- **Asked for:** the order of steps and the limit on helpers running at once; JSPARK Forge hands out work that way but
  cannot stop Claude doing something else.
- A graph whose checks run commands needs you to type `TRUST GRAPH <name>` first, and again when those commands
  change. `npm test` runs whatever your project's scripts say.

## Commands

| Command | What it does |
|---|---|
| `/jspark-forge:resume` | Show where you were again, on demand, and wait |
| `/jspark-forge:handoff` | Save the handoff now (`done` closes the task and archives it) |
| `/jspark-forge:waiting` | The questions waiting on you, with Claude's recommendations; answer, accept the recommendations, or drop them |
| `/jspark-forge:status` | What is saved now: the handoff, what is waiting on you, usage as of when |
| `/jspark-forge:doctor` | Is JSPARK Forge working here? One line per check, each problem with its fix. Changes nothing |
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
3. Optional: delete the `.jspark-forge/` folder in your projects and `~/.claude/jspark-forge/`.

## Privacy

Nothing leaves your machine. The handoff holds paths and short text, never file contents. The log hides likely
secrets (keys, tokens, passwords) before writing.

## Every hook, documented

See [docs/design-v0.1.md](docs/design-v0.1.md): each hook, the event it listens to, what it writes and what it
blocks.

Launch list ([docs/design-v0.3.md](docs/design-v0.3.md) section 2), only in your own projects with a
`.jspark-forge/launch.md`:

| Hook | What it does for the launch list |
|---|---|
| SessionStart | Adds the launch date and the open / done titles (at most 60 words, as data) for Claude; lists items that arrived with git to you once |
| UserPromptSubmit | A prompt under 400 characters that sounds like new scope gets one line suggesting `/jspark-forge:scope` (at most every 30 minutes, attended sessions only, not at 95 % usage) |
| PostToolUse | After a `forge.js launch` command, shows the change it made in the conversation, once |

## Credits and licence

MIT. Built for Claude Code; not made or endorsed by Anthropic. superpowers is by its own authors under its own
licence.
