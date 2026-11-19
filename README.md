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
sources** (keep an old system next to the new one, never edited).

## Works best with superpowers

JSPARK Forge does not teach Claude *how* to build. [superpowers](https://github.com/obra/superpowers) by Jesse
Vincent (MIT) does: brainstorm, plan, test first, review, verify. **It is installed together with JSPARK Forge**: it is
a declared dependency, listed in the JSPARK Forge marketplace from its own repository (nothing is copied or changed).
The handoff then shows superpowers plan progress ("Task 3 of 8").

Already had superpowers from another marketplace? Then it is installed twice and its skills show twice; JSPARK Forge
tells you once which copy to remove.

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
| `secret-files` | Editing `.env*`, key, secret and credential files, also via `>`, `tee`, `Set-Content`, `Out-File` (templates such as `.env.example` and `.env.sample` are allowed) |
| `chmod-wide` | `chmod 777`, `chmod -R`, `icacls … /grant Everyone:F` |
| `pipe-to-shell` | `curl … \| sh`, `iwr … \| iex`, `iex (irm …)` and similar |

Bash, Git Bash, PowerShell and cmd forms are all matched (PowerShell from v0.1.1), also when one shell starts another
(`powershell -Command "…"`, `bash -c "…"`, `cmd /c "…"`). Coming next in v0.1.1: `readonly-source` (no edits to an
old system you are migrating from, always refused) and `guest-quarantine` (no installing or running a repo you are
only reviewing without `CONFIRM`).

Add your own in `.jspark-forge/rules.md` ("Confirm" or "Never" lines). Blocks also fire inside helper agents.
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

## Commands

| Command | What it does |
|---|---|
| `/jspark-forge:resume` | Show where you were again, on demand, and wait |
| `/jspark-forge:handoff` | Save the handoff now (`done` closes the task and archives it) |
| `/jspark-forge:init` | Optional. Wrap your own status line (asks first); `--undo-statusline` restores it exactly |

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

## Credits and licence

MIT. Built for Claude Code; not made or endorsed by Anthropic. superpowers is by its own authors under its own
licence.
