# JSPARK Forge: product spec

Status: **Final, approved by owner 2026-11-03. Build order: spikes A–D, then v0.1. Started 2026-11-19 (owner moved
it ahead of the earlier schedule).** Consolidated 2026-11-02; revised 2026-11-03, 2026-11-07, 2026-11-19 and 2026-11-20.
Brought in line with the released product (v0.5.0) on 2026-11-20, after the first spec-coverage check
([`spec-coverage.md`](spec-coverage.md): what is built, partly built and not built). Latest decisions only; superseded text dropped. The v0.1 build design is
[`design-v0.1.md`](design-v0.1.md); spikes in [`spikes.md`](spikes.md); open questions in
[`open-questions.md`](open-questions.md); every release in detail in [`releases.md`](releases.md); this spec's
revision history in [`changelog.md`](changelog.md).

Tags: **[owner]** decided by the owner; **[owner, 2026-11-03 review]** owner decision from the accepted review;
**[builder]** builder's call; **[spike]** depends on a spike; **[coordinator]** proposed by the coordinator and
accepted with the owner's decisions of that date; **[updated 2026-11-20: v0.5]** text brought in line with the
released product; **[owner decision open, …]** the owner has not decided yet (none open as of 2026-11-20; the answers are in section 12).

---

## 1. Vision and pain

**One line:** a Claude Code plugin that keeps a solo founder's work, rules and decisions intact across sessions,
crashes and limits, and stops the launch from drifting.

**Pitch (README line one) [owner, 2026-11-03 review; Q1 decided]:** *"Claude Code forgets. JSPARK Forge doesn't.
Open Claude Code and pick up where you left off in 30 seconds."* Sub-line: *"Rules enforced by hooks, not by hoping
Claude remembers."* The pitch never asks the user to type a command (Claude Code has its own built-in `/resume`);
`/jspark-forge:resume` stays as the on-demand command.

**The pain** of building alone with Claude Code:
1. **Lost work:** after a logout, limit or crash, everything has to be explained again.
2. **Forgetting why:** Claude re-learns the codebase each session and breaks past decisions it never knew about.
3. **Rules that slip:** instructions fade in long conversations, after compaction, and in helper agents.
4. **Drift:** new ideas land mid-roadmap, things get over-engineered, launch slips by months.
5. **Security left to the end:** leaked keys and open holes nobody looked for.
6. **Research cost:** good tools exist, but finding and wiring them takes days.

**Wedge [owner]:** Resume is the headline. Everything else is "also included".

---

## 2. Audience and positioning [owner]

- **Positioning line [owner, 2026-11-21]:** a Claude Code based coding tool for non-technical founders. (Before:
  "technical solo founders who ship with Claude Code".)
- **Output quality:** plain language by default (short, no jargon), with "show details" for files, lines, commits and
  terms. Coders are welcome; the product is written for a founder who is not one.

| | Plain view | "Show details" |
|---|---|---|
| Resume | "We were adding Save as chart. Step 4 of 10. Continue?" | branch, commits, files, log |
| Block | "This would throw away your unsaved work." | rule id, matched command |
| Scope | "This becomes launch item #8. Before or after launch?" | modules, files, history |

---

## 3. Principles [owner]

1. **Opinionated project judgement only.** Build what Claude Code does not: resume checkpoint, decision memory,
   launch-scope guard, hook-enforced rules. **No thin wrappers** on native features (plan mode, basic memory,
   permission settings).
2. **Rules are enforced by code that runs outside Claude** (hooks), not by Claude remembering. Every hook is
   documented: event, what it writes, what it blocks.
3. **The user's work never leaves the machine.** No telemetry; JSPARK Forge itself sends nothing anywhere. The only
   exception for the user's data is a dashboard the user chooses to publish, and then only summaries.
   [updated 2026-11-20: v0.5] JSPARK Forge goes online for its own setup only (it made no network call until v0.5):
   `npm` installs its two pinned engines, once, into `~/.claude/jspark-forge/engines/` (5.4, 5.14);
   `claude plugin install` adds the two UI companions, once (5.14); and its marketplace auto-updates (section 6).
   Never inside a hook. Off switches: `JSPARK_FORGE_AUTO_SETUP=off` (auto-update and the two companions),
   `- code-map: off` and `- playwright: off` under `## Settings` in `rules.md` (the two engines).
4. **Lean.** Each piece does one job. If JSPARK Forge starts over-engineering itself, it has failed.
5. **Never act after a cutoff without the user.** Show and wait.
6. **Freshness is mechanical.** Anything stored (map, decisions) is refreshed or flagged by hooks, with dates.
7. **Soft coupling.** Other tools (superpowers, scanners, map engines) are detected and used if present, never
   required; any read failure is skipped silently and tested. [updated 2026-11-20: v0.5] The map engine now ships
   with the plugin and can be switched off (5.4). [owner 2026-11-20] superpowers is the one exception: it is required, installed with
   JSPARK Forge as a declared dependency, and the plugin does not load without it (5.9).
8. **Honest output.** No invented numbers, no "all clear". Estimates are marked as estimates.
9. **Local-first, account-independent [owner 2026-11-03].** Nothing the project depends on may live only inside one Claude account or one session's temporary folder. Every page, mockup, dashboard, decision or handoff JSPARK Forge creates is written first as a file in the project (`.jspark-forge/` or the project's docs folder), committed where sensible; a published Artifact is only a *view* of that file, never the only copy. [updated 2026-11-20: v0.5] Claude is told this rule at every session start. When a page is published, JSPARK Forge keeps its file (the copy is made after the publish; a file from outside the project is copied into `.jspark-forge/artifacts/`) and lists it in `.jspark-forge/artifacts.md` with date, title, local file and link (no account: a hook cannot read the account); Claude tells the user the path. At session start a listed page whose local file has gone is flagged. What of this principle is built and what is not yet is kept in [`spec-coverage.md`](spec-coverage.md). [updated 2026-11-21: v0.5.1] The flag in `/jspark-forge:check` and the temp-file warning are built in v0.5.1; what remains is the account field (a hook cannot read the account) and files nobody listed. [owner 2026-11-20] `artifacts.md` and `artifacts/` stay local: they are git-ignored and exist on one machine only. Build graph files are committed. Reason: a design approved on one account became unreadable after a login switch.
10. **Short by default [owner 2026-11-03].** Every status, answer and explanation JSPARK Forge shows (and the instruction file asks Claude to give) leads with the answer, uses bullets or a table, keeps explanations to one line, and offers details only on request. Short never means missing: warnings, risks, decisions and blockers are always stated, one line each. Reason: users skip long paragraphs and miss what matters; shorter output also saves tokens now and on every later turn (history is re-read).
    **Stay reachable [owner 2026-11-22: v0.7].** A message the user sends mid-task reaches Claude only when its
    current command ends. At every session start Claude is told to run anything longer than about a minute in the
    background and to answer the user's mid-task message first (`- stay-reachable: off` switches it off). A rule, not
    a hook: a running command cannot be interrupted. A second "side window" for questions was considered and dropped.
11. **Store nothing JSPARK Forge can re-derive from the repo [owner 2026-11-03].** Specs, schema and architecture are
   indexed from their source files by the v0.3 map (5.4), never copied into memory. Users may still write whatever
   they want into `decisions.md`; JSPARK Forge never blocks it (it warns, points to a reference and counts locally, 5.3).
12. **Hooks, not verdicts [owner 2026-11-03].** A proposal that needs Claude's judgment to produce a verdict or a
   plan is out; a hook that denies, saves or points is in. This is the test for every future addition.
13. **Spike results override review decisions. [owner, 2026-11-03 review]** If a spike contradicts a reviewed
   decision (e.g. headless detection is impossible from hook input, or the PostToolUse matcher misses a write path
   we need), the spike wins: record the deviation, the evidence and the reason in the "Deviations from review" list
   in [`design-v0.1.md`](design-v0.1.md#16-deviations-from-review), and update the affected decision.
14. **Token care: measure, then act on the largest cost [owner 2026-11-21, v0.6].** Measured on a real session: the
   conversation re-read on every step is nearly all the usage; helpers are second; JSPARK Forge's own notes are
   negligible. So: `/jspark-forge:usage` reports where a session's tokens went (read-only, only from inside the Claude
   home); the user is told each time a conversation passes another 150k tokens that a new session would save usage
   (to the user only, `fresh-session` setting); every helper is told four usage-care habits and the main session one
   line (`usage-care` setting). These are measurements and hints, never blocks. Tests: `tests/usage-report.test.js`,
   `tests/fresh-session.test.js`, `tests/usage-care.test.js`.

---

## 4. Verified Claude Code facts and their limits

Checked 2026-11-02 in `code.claude.com/docs/en/` (hooks.md, statusline.md, sub-agents.md,
plugins/manifest-reference.md, plugins/components.md); hook input fields, PreCompact output and timeouts re-checked in
hooks.md on 2026-11-03. Re-check each release.

| Fact | Limit / consequence |
|---|---|
| Context % (`context_window.used_percentage`) is given **only to the status line** | Hooks need a bridge: status line writes `.jspark-forge/usage/<session>.json`; hooks read it. May be `null` early and right after `/compact` |
| Plan quota (`rate_limits.five_hour` / `seven_day` `.used_percentage`, `.resets_at`) is **status line only** | Present for Pro/Max/Ultra per the docs (or a gateway spend limit) and **observed on Team** (spike A, 2026-11-19), only after the first reply; each window may be absent. README first screen states this |
| Status line refreshes on events (new assistant message, `/compact`, mode change) + optional `refreshInterval`; 300 ms debounce | The file is timestamped; hooks ignore figures older than ~2 min |
| One `statusLine` command; plugins cannot set it (plugin settings take only `agent`, `subagentStatusLine`) | JSPARK Forge installs a **wrapper** in user settings that chains the user's existing command, with disclosure and undo |
| Hook events used: SessionStart (`startup`/`resume`/`clear`/`compact`/`fork`), UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PreCompact (`manual`/`auto`), SessionEnd, SubagentStart, SubagentStop, Notification (sign-in only) [updated 2026-11-21: v0.5.1] | SessionEnd shares a 1.5 s budget (raised by per-hook `timeout`, max 60 s) |
| `additionalContext` works on SessionStart, SubagentStart, UserPromptSubmit, Pre/PostToolUse, Stop | Used for re-loading rules after compaction and just-in-time reminders. PreCompact cannot inject (it can only block; its `systemMessage` is discarded) |
| PreToolUse `permissionDecision`: `allow` / `deny` / `ask` / `defer` (`defer` only in `-p`) | Blocks = `deny`; override = typed confirmation then `ask` |
| Hook input has **no documented field for interactive vs headless** (`claude -p`, CI, Agent SDK). Common fields: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode` (`default`/`plan`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`), `effort`, `hook_event_name`; SessionStart adds `source`, `model`, `agent_type`, `session_title`. `-p` shows up in the docs only as a condition (`defer`, `initialUserMessage`) | SessionStart `startup` fires in `claude -p` too, so a deny-until-reply guard would stall headless runs. Show-and-wait is instructed-only until spike D finds a reliable signal (Q8) |
| Default `command` hook timeout is 600 s | Every JSPARK Forge hook sets its own short timeout (PreToolUse 3 s, SessionEnd 1 s) |
| Plugin PreToolUse/PostToolUse hooks **fire inside subagents** | Blocks apply to helpers |
| SubagentStart can add context to a helper | "Rules reach every helper" claimed **only if spike C proves it** (since v0.5.1 every helper is given the grounding rule, the guest line and the UI rule at SubagentStart) [updated 2026-11-21: v0.5.1] |
| Plugin commands/skills are namespaced (`/jspark-forge:resume`); a built-in `/resume` exists | The pitch never says "type `/resume`" (Q1 decided) |
| `${CLAUDE_PLUGIN_ROOT}` changes per update; `${CLAUDE_PLUGIN_DATA}` survives updates, deleted on uninstall | Machine-level files live in `~/.claude/jspark-forge/` |
| Exec-form hooks (`command` + `args`) bypass shells | All JSPARK Forge hooks use exec form with `node` |
| Rewriting a helper's prompt through the Agent tool input is not documented | Not used |
| **Spikes 2026-11-19 (Windows, 2.1.328):** hook env has `CLAUDE_CODE_SESSION_ATTENDED` (1 interactive, 0 `-p`) and `CLAUDE_CODE_ENTRYPOINT` (`cli` / `sdk-cli`), both **undocumented**; Stop input has `background_tasks`; PreCompact rejects `hookSpecificOutput`; SubagentStop also fires for internal helpers | Re-check each release. Guard uses ATTENDED = 1 only (owner 2026-11-19); details in spikes.md and design section 16 |

---

## 5. The pieces

### 5.1 Resume (v0.1) [owner: scope; detail in design-v0.1.md]

**What carries across sessions [owner, 2026-11-03]:** in v0.1, **only the handoff**: task, step, files touched,
branch, Claude's own notes. Enough to resume the work, not a map of the system. The "why" comes with decision memory
(v0.2, 5.3); the "what and where" with the codebase map (v0.3, 5.4).

**Behaviour**
- A **handoff file** (`.jspark-forge/handoff.md`, hard cap ~1 page / ~600 words) is rewritten in place on
  **mechanical save triggers** [owner]: (a) after any tool call that writes or edits a file; (b) after any commit;
  (c) on Stop; (d) on PreCompact; (e) on SessionEnd (minimal write, 1 s); (f) at 80 % context/plan usage (quiet)
  and 95 % (forced + message). The 10-minute activity trigger is dropped: Stop already saves after every reply
  [owner, 2026-11-03 review]. [updated 2026-11-20: v0.5] Two more, so a crash loses at most the last minute:
  (g) every message from the user; (h) once a minute while Claude works without writing files (commands, helpers,
  a new branch).
- [updated 2026-11-20: v0.5] **Only the user's own text counts as the user's message.** A helper's report or a
  system notice never sets the handoff's task or last request, and never grants a `CONFIRM` (5.2). The task is the
  user's last real request, not "go on".
- **Usage-limit save [owner, hard rule]:** at 95 % of context **or** plan usage (5-hour or weekly), JSPARK Forge forces a
  full save and tells the user: *"Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were."*
  Plan figures only on plans that report usage (Pro/Max/Ultra; Team observed); elsewhere the step triggers + manual `/jspark-forge:handoff` cover it.
- An **action log** (one line per action, secrets redacted) is the safety net for the step a crash cuts off.
  [updated 2026-11-20: v0.5] The handoff's history (recent actions, files touched) is built from the log for all
  sessions, so resuming a session does not wipe it; the next session is also given what the log holds after the
  last save.
- [owner 2026-11-21: built in v0.5.1] **Crash recovery** (the machine dies at an arbitrary instant: no Stop, no
  SessionEnd, half-run commands, dead dev servers, possibly half-written files). Files are written with a flush to the
  disk before the rename; the previous good handoff pair is kept (`handoff.prev.md`, `state/handoff.prev.json`) and is
  read when the newest is damaged, and when both are, the context is built from the action log alone; a log line cut
  off mid-write is ignored. PreToolUse records each allowed shell, file-write or helper call (Bash, PowerShell, Write,
  Edit, NotebookEdit, Agent) as one small file in `state/inflight-<session>/` (flushed when added; removed by
  PostToolUse and PostToolUseFailure; the folder emptied at Stop and at that session's own start). Every PreToolUse,
  PostToolUse and UserPromptSubmit touches the session file: that, the in-flight folder, the last save and the log
  are the session's last sign of life. At the next start (startup or resume, not compact or clear), a session with
  no `ended` stamp that left something in flight, running or logged after its last save, and whose last sign of life
  is older than 90 seconds (10 minutes when its only evidence is in-flight calls or one of them is younger than 10
  minutes), is reported as "cut off, or is still open in another window": one line for the user, and for Claude a
  record (in flight, was running and is gone, files written in the last 2 minutes marked missing / empty / ends in
  NUL bytes, what was logged after the last save, Claude's last words (600 characters) and unfinished tool call from
  the tail of the transcript, and what to check after the user says to continue). The session that is starting is
  judged too when it resumes under its own id. A session's last log line that is not SAVE, WAIT or GROUNDING being a
  normal STOP or END is a clean end. "Already reported" lives in `state/crash-noted.json` (session id to the last sign
  of life reported); the check never deletes another session's files or writes another session's session file; all
  sessions found are marked, the newest two are told; `forge.js show` shows the same record until handled. A missing
  `ended` stamp alone says nothing. The check runs only in a git repo with the own marker or in a guest project (a
  `.jspark-forge/state/` shipped in a folder that is not a git repo proves nothing), and a transcript is read only when
  its real path is inside the Claude home. A start deletes at most 50 old session files (ended over 7 days ago, or
  untouched for 30) and in-flight records older than 7 days. What a crash can still lose: the reply Claude was writing,
  a command's unsaved output, anything a program had not yet written to disk, and the newest log lines if the cut came
  before they reached the disk; the NUL-byte check is a hint, not proof. Redaction of quoted text is best effort.
- [updated 2026-11-20: v0.5] **Step progress** ("n of m") is read from Claude Code's task tools (TaskCreate and
  TaskUpdate; TodoWrite on older versions) as well as from the plan.
- **New session: show and wait [owner].** JSPARK Forge shows "here's where we were: continue?" and Claude is told to wait.
  **Instructed only in v0.1** (no hook enforcement) [owner, 2026-11-03 review; Q8 decided]: a deny-until-reply guard
  would also fire in `claude -p` / CI runs and stall them. The hook guard ships only if spike D proves JSPARK Forge can
  detect non-interactive mode, and is then skipped there. After compaction JSPARK Forge re-injects the handoff and rules
  and carries on.
- **Notes reminder [owner, 2026-11-03 review; Q5 decided]:** no Stop block. JSPARK Forge adds `additionalContext` "update
  your notes now" at the moments notes matter: PreToolUse of a `git commit`, and the 80 % usage band (and at
  compaction, see design 5.3). No extra turn.
- `/jspark-forge:resume` starts from the handoff and may also read the action log, Claude's notes and the other files the handoff names, whenever they add to it [owner 2026-11-20] (until then: only the handoff, never the log). Target: back to work < 30 s.
  [updated 2026-11-20: v0.5] At session start the log lines written after the last save are added (the gap a crash
  leaves), never the whole log.
- **A go-ahead is asked for once [owner 2026-11-21: v0.6.2]:** the session-start line already tells the user to say
  "continue". A first message that says so ("continue", "resume", "go on", "yes") is the answer: Claude says where
  the work stands in at most 4 lines and carries on, after the crash check when there is one. A question or the
  `/jspark-forge:resume` command is not a go-ahead.
- **Notes are dated [owner 2026-11-21: v0.6.2]:** the handoff shows the notes' date when it is not today's and says to
  re-check any caution or limit before acting on it; the notes reminder asks for what was measured behind a caution.
- Short-term only: when a task is closed, the handoff is archived (and from v0.2 its lasting lessons move into
  decision memory).

**Data files** `.jspark-forge/handoff.md`, `.jspark-forge/state/notes.md` (Claude's ≤ 120-word notes),
`.jspark-forge/state/session-<id>.json`, `.jspark-forge/usage/<session>.json`, `.jspark-forge/log/YYYY-MM-DD.log`,
`.jspark-forge/log/summary.md`, `.jspark-forge/archive/`.

**Handoff fields:** as-of time and save reason; branch, HEAD, uncommitted count; Task; Step "n of m"; Done; Next
action; Still running at cutoff; Waiting on you; Your last request; Claude's notes; recent actions; files touched
(the newest 8 and a count of the rest, v0.6.2); pointers to log and archive.

**Commands** `/jspark-forge:resume`, `/jspark-forge:handoff [done]`, `/jspark-forge:init` (optional).

**No setup step [owner 2026-11-19]:** the first SessionStart or prompt in a git project creates `.jspark-forge/`
by itself (never outside git projects, the home folder or a drive root). Once per machine, if the user has no status
line, JSPARK Forge adds its own (one-line notice with the undo command); a user's own status line is never touched
automatically (a one-time tip points to `/jspark-forge:init`). `JSPARK_FORGE_AUTO_STATUSLINE=off` turns the automatic
status line off. This supersedes Q15's "write nothing before init" for owned projects; in a repo the user only
reviews, nothing is written inside it (guest mode, 5.2b). [updated 2026-11-20: v0.5] The first start also sets up
auto-update, the two engines and the two UI companions (principle 3, 5.4, 5.14, section 6).

**Hooks** SessionStart, UserPromptSubmit, PreToolUse (blocks, commit notes reminder), PostToolUse (matcher limited
to writing/state tools, not Read/Grep/Glob), PostToolUseFailure, Stop, PreCompact, SessionEnd, SubagentStop and
SubagentStart (job tracking; rule injection only if spike C passes; since v0.5.1 every helper is given the grounding rule, the guest line and the UI rule at SubagentStart [updated 2026-11-21: v0.5.1]), status-line wrapper.

**Limits** Log: rotate daily, keep 7 days, then a mechanical summary per day; 2 MB per day cap [owner: rotation,
retention, cap; builder: numbers]. Handoff ≤ 600 words. Old handoffs prompted only if < 14 days old (Q12).

**Failure modes**
| Failure | Behaviour |
|---|---|
| Hard crash or limit mid-step | At most the last minute of work is lost [updated 2026-11-20: v0.5]; the log shows what happened after the last save |
| Status line not wrapped / figures absent / stale | Step triggers still save; no usage message |
| Hook script error or Node missing | Fail open (work continues), `FORGE-ERROR` logged; init reports it (and `/jspark-forge:doctor`, 5.13c, once it ships; the doctor reports hook errors, built in v0.5.1 [updated 2026-11-21: v0.5.1]) |
| Two sessions in one project | One block per session in the handoff, newest first, max 3 |
| Commit made outside Claude | Picked up at the next hook via `HEAD` change |

### 5.1a Grounding rule (v0.1) [owner 2026-11-03]

A ≤ 10-line rule injected as `additionalContext` at every SessionStart (`startup`, `resume`, `clear`, `compact`):
cite path and line from the map or the file; say "not found" otherwise; never describe code not read this session.
It is layer 4 of 5.2. Exact text: design 8.1. **Acceptance:** the rule is present after startup, resume and compact.

### 5.2 Hooks and the block list (v0.1) [owner: list and typed override]

**How rules stay in force [owner, layers]**
| Layer | Mechanism | Can Claude forget it? |
|---|---|---|
| 1. Hard hooks | PreToolUse deny / typed-confirm on the published list | No |
| 2. Just-in-time reminders | `additionalContext` at the moment it matters (v0.1: "update your notes now" before a commit and at 80 % usage; v0.2: a decision about the file being edited) | No, it arrives with the action |
| 3. Re-load after compaction | SessionStart `compact` re-injects handoff + active rules | No |
| 4. Tiny always-loaded rules | ≤ 10 lines added at SessionStart, incl. the grounding rule (5.1a) | Possible in very long sessions, hence layers 1–3 |
| 5. Helpers | blocks fire inside helpers; SubagentStart adds rules if spike C passes (since v0.5.1 every helper is given the grounding rule, the guest line and the UI rule [updated 2026-11-21: v0.5.1]) | No (blocks); conditional (rules) |
| 6. Proof | every block/save/confirm logged; hook-fire test that each hook fires (section 8); `/jspark-forge:doctor` on the user's machine once it ships (5.13c) | n/a |

**Published block list (v0.1) [owner]:** `rm -rf` outside the repo or on home/root, and inside the repo on the
project root, `.` or `.git` [owner, 2026-11-03 review]; `git push --force` / `--force-with-lease` to main/master;
`git reset --hard`, plus `git checkout -- .`, `git restore .`, `git restore --staged .` at the project root [owner,
2026-11-03 review]; `git clean -fdx`; `git stash drop/clear`; database `DROP` / `TRUNCATE` / `DELETE` without
`WHERE`; editing `.env*` (except templates such as `.env.example`, `.env.sample`), key/secret/credential files;
`chmod 777` / `chmod -R`; `curl … | sh`. **v0.1 matches Bash / Git Bash command forms only; PowerShell forms move to
v0.1.1** [owner, 2026-11-03 review]. Hard-deny (no override): `rm -rf` on home, root or a drive root (Q7).

**Added in v0.1.1 [owner 2026-11-03] (5.2b):** `readonly-source`: any write under a `readonly:` path in `rules.md`,
**hard deny, no CONFIRM**; `guest-quarantine` (guest mode only, and only after `/jspark-forge:init --guest`): the
guest repo's common install, build, test and run commands, typed `CONFIRM guest-quarantine`, which then covers the
rest of that session (5.2b). Each has ≥ 5 positive / ≥ 5 negative tests, like the others.

**Added later [updated 2026-11-20: v0.5]:** `db-write` (v0.2.1, 5.2c): a write to a production database, typed
`CONFIRM db-write`; `forge-state` (v0.4, 5.10): any change to a build graph's running record
(`.jspark-forge/state/graph-*`) and running JSPARK Forge's own hooks from the shell, **hard deny, no CONFIRM** (a
command that only looks like it might write the record gets Claude Code's normal yes/no prompt instead).

**Override [owner: typed; builder: mechanism]:** blocked → `deny` with "type CONFIRM <name>" and the line *"Do not
try an equivalent command; tell the user and stop."* [owner, 2026-11-03 review]; the user's typed `CONFIRM <name>`
(seen only by UserPromptSubmit) creates a one-shot, 5-minute, session-bound token; the retry gets `ask` with the
reason shown (Q6). [updated 2026-11-20: v0.5] `CONFIRM` counts only on a line of its own, in a message the user
typed: a quoted or pasted mention, a helper's report or a system notice never grants one. `guest-quarantine` is the
one exception to one-shot: its `CONFIRM` covers the rest of the session.

**User rules:** `.jspark-forge/rules.md` (project, shared through git) and `~/.claude/jspark-forge/rules.md` (the
user's own, for every project), with "Confirm" and "Never" lines (plain text or `re:` regex) and JSPARK Forge
settings under `## Settings`: `- notes: off`, `- statusline-segment: off`, and from v0.5 `- code-map: off`,
`- playwright: off`, `- ui-skills: off`, `- brand-skill: <name>` (5.4, 5.14). [updated 2026-11-20: v0.5]
`disable:` for built-ins works only in the user's own file: a project's `rules.md` may come from a cloned repo, so
it can add rules but never remove one (its `disable:` lines are ignored and reported). A setting in the user's own
file is not undone by a project file that does not mention it.

**Limits / failure modes:** a seatbelt, not a sandbox: obfuscated commands (`eval`, encoded scripts, a script file)
can pass; README says so. False positives are overridable per action. Matching errors fail open and are logged.

### 5.2a Waiting on you (v0.1.1) [owner 2026-11-03]

**Built 2026-11-20** as design-v0.1.1 section 4: capture, status line, session start, handoff and
`/jspark-forge:waiting`. The timed reminders and deadline defaults below are cut there, with reasons.

Solves two problems: questions to the user get buried in long replies (visibility), and answers get put off (procrastination).

- **Capture:** every question Claude asks that blocks work is logged in `.jspark-forge/waiting.md` (id, question, options,
  Claude's recommendation, asked at, what it blocks, reversible yes/no). Questions through Claude Code's question tool are
  captured by a PreToolUse/PostToolUse hook on that tool; questions in plain text are filed by Claude via the instruction
  file ("file every blocking question"). [spike: confirm the question tool's name/input in hook input]
- **Always visible:** the status-line wrapper shows `⏳ 3 waiting on you · oldest 14 h`; session start lists them first;
  answered items move to the decision memory (v0.2) or are cleared.
- **Cost of delay:** each item states what it holds up in plain words ("blocks go-live; each day moves launch by a day"),
  linked to the launch-scope guard when present.
- **Effortless answers:** questions are batched into one short list, each with a recommendation; one reply
  ("go with recommendations") settles all; `/jspark-forge:waiting` shows the list and lets the user answer or dismiss items.
- **Nudge, not nag:** one reminder after N hours (default 4) through Claude Code's Notification event (reaches the phone
  when remote control is on), plus a once-a-day summary ("3 decisions, about 5 minutes"); both switchable off.
- **Never stall:** Claude keeps working on everything not blocked and says what is parked.
- **Optional deadline default (off by default):** "if no answer by 18:00, I'll go with my recommendation" — only for
  items marked reversible; never for destructive, live-facing, security, money or legal choices.
- **Limits:** a question written only in prose and not filed is missed — the instruction plus `/jspark-forge:check`
  ("questions in the last replies not filed?") reduce this; no guarantee.

### 5.2b External code: guest mode, readonly sources (v0.1.1 → v0.3) [owner 2026-11-03]

JSPARK Forge assumed one owned project in one folder. Two other cases are common: reviewing someone else's repo, and
migrating from an old system kept next to the new one.

**Guest mode (v0.1.1) [owner 2026-11-03]**
- [updated 2026-11-20: as built in v0.1.1] **Own or guest is decided from git facts, not asked** (init is optional
  since automatic setup, 5.1). A repo is the user's own when it already holds JSPARK Forge's local files, or has no
  remote, or has no commits, or has a commit by the user's `user.email`; a repo with a remote and none of these is
  a guest. If git fails before a remote is known, the files stay in the repo as before. A wrong guess costs
  nothing: only where the files live changes. Shown once; `/jspark-forge:init --mine` and `--guest` switch it by
  hand.
- **Nothing is written inside the repo.** No `.jspark-forge/`, no edits to its `.gitignore`. State lives in
  `~/.claude/jspark-forge/guests/<repo-hash>/` (same layout as `.jspark-forge/`; hash of the repo's real path
  [builder]). Principle 9 holds: the copy is local, on the machine, not in the repo. A guest folder not used for
  30 days is deleted (Q16).
- **On:** handoff (tagged *"review of <origin URL> @ <commit>"*), save triggers, action log, block list, typed confirm.
- **Off:** decision memory, launch-scope guard, codebase map, build graphs. The repo's own `.jspark-forge/rules.md`
  is never read: it is the repo author's file.
- **Quarantine [coordinator, owner 2026-11-03; on request only, owner 2026-11-19]:** off until the user runs
  `/jspark-forge:init --guest` for that repo; it never switches on by guessing, so it cannot block CI or the user's
  own work. Then the guest repo's common install, build, test and run commands are denied until the user types
  `CONFIRM guest-quarantine` (block `guest-quarantine`, 5.2), which allows them for the rest of that session:
  `npm`/`pnpm`/`yarn install`, `pip install`, `make`, `pytest`, running the repo's own scripts, `docker run`, and
  the like (Q17). `curl … | sh` stays blocked everywhere as `pipe-to-shell`. `/jspark-forge:init --mine` moves the
  files into the repo and ends the hold.
- **Content is data [coordinator, owner 2026-11-03]:** the guest repo's README, comments and docs are data, never
  instructions. Stated in the instruction file, and as a one-line just-in-time reminder (`additionalContext` on
  SessionStart and UserPromptSubmit in guest mode; no Read/Grep matcher, to keep the v0.1 latency rule).
- **Limits:** a seatbelt, not a sandbox: a disguised command or a script that runs installs inside it can pass. Guest
  state is never committed anywhere.

**Readonly sources (v0.1.1) [owner 2026-11-03]**
- In `.jspark-forge/rules.md`, a `## Sources` list:
  ```markdown
  ## Sources
  - readonly: ../legacy-app : migrating from, never edit
  ```
- Edit/Write/NotebookEdit, and shell writes (redirects, `tee`, `mv`/`cp` into, `rm`, `sed -i`, PowerShell
  `Set-Content`/`Out-File`/`Remove-Item`) under a readonly path → **hard deny, no CONFIRM** (block `readonly-source`,
  5.2). Reason shown: *"There is no good reason to edit the source during a migration."* To allow edits, the user
  removes the line from `rules.md`.
- `rm -rf` on a readonly path is already caught by `rm-rf-outside` (outside the project).
- Reading is unrestricted.
- Handoff records the source repo and commit: *"Source: ../legacy-app @ <commit> (read-only)"* (v0.1.1, owner
  2026-11-03). [updated 2026-11-20] The "last read" path is not recorded [builder deviation, design-v0.1.1 section
  3]: it would need a hook on every Read.

**v0.2 additions [owner 2026-11-03; coordinator where marked]**
- Decision memory records migration mappings as decisions, e.g. *"sessions: legacy/session.php → src/auth.ts, cookie
  format kept"* (`touches:` both paths).
- **Licence check [coordinator]:** for guest repos and readonly sources, reads the local LICENSE file(s) and says in
  plain words: permissive / restrictive (copyleft) / non-commercial / none found. One file read; local only; never
  legal advice.

**v0.3 additions [owner 2026-11-03]**
- The codebase map can index readonly sources: *"where is X in the old code?"* (separate index, marked "old code").
  **Built in v0.4.1** (missed in v0.3, found in the 2026-11-20 backlog review): the engine indexes each source as its
  own project; JSPARK Forge records which project is which source and the source's commit, labels answers "old code",
  says when the old code changed since its index, and lists sources at session start, in `map status` and in
  `/jspark-forge:check`. No background refresh: the source is never edited by Claude, so a re-index is asked for only
  when its commit moved.

**Cut to "Later, only if asked" [owner 2026-11-03; principle 12]:** `/jspark-forge:review` (use / borrow / avoid
verdict report) and migration mode (inventory, parity plan, cutover checklist, sign-off, `migration.md`). See 5.8a.

**Files** `~/.claude/jspark-forge/guests/<repo-hash>/` (v0.1.1); `## Sources` in `.jspark-forge/rules.md` (v0.1.1).
**Hooks** PreToolUse (`readonly-source`, `guest-quarantine`), SessionStart and UserPromptSubmit (guest reminder),
PostToolUse (source map freshness, v0.4.1).
**Commands** `/jspark-forge:init --guest` / `--mine` (v0.1.1).
**Failure modes** no origin URL → tag uses the folder name; readonly path missing → flagged at SessionStart, rule kept;
path matching errors fail open and are logged (as 5.2).

### 5.2c Database guard (v0.2.1) [owner 2026-11-20]

**Guard databases, don't read them.** Live database access already exists through database MCP servers (Supabase,
Postgres and others) and command-line clients. Reading data is not JSPARK Forge's job; protecting it is.

**Behaviour**
- **Production is read-only unless you type `CONFIRM db-write`.** A write to a production database is denied with
  the usual "type CONFIRM db-write" reason; the confirm is one-shot, 5 minutes, like the others (5.2).
- **A write** is any statement other than `SELECT` / `WITH … SELECT` / `EXPLAIN` / `SHOW` / `DESCRIBE`, plus
  migration-apply, branch-merge, reset and restore tools of database MCP servers.
- **Where it looks:** MCP tool calls (`mcp__*`, the text of their inputs, as `sql-destroy` does today) and Bash /
  PowerShell database clients (`psql`, `mysql`, `sqlite3`, `mongosh`, `supabase db`, `prisma migrate deploy`, …).
- **What counts as production:** every database MCP server and every client connection to a host other than
  `localhost` / `127.0.0.1` / a Unix socket, **unless** `rules.md` names it as dev: `- database dev: <server name or
  host pattern>`. Safe by default; one line to relax. [updated 2026-11-20: v0.5] The line works only in the user's
  own `~/.claude/jspark-forge/rules.md`: a project's `rules.md` cannot mark a database as dev (like `disable:`,
  5.2).
- [code review H1/M7, 2026-11-20] Reads are listed and every other statement is held (literals and comments removed;
  only the SQL sent to that client; a script file, `<` or a pipe into a remote client is held); an unresolved
  variable, `service=` or `--login-path` is production; `database dev:` takes `host:<glob>` (every host in the
  command must match), `mcp:<server>` or `mcp:<prefix>*`, and a bare name matches one host or server exactly.
- `sql-destroy` (5.2) stays as it is: `DROP` / `TRUNCATE` / `DELETE` without `WHERE` are blocked on dev databases too.

**Tests** ≥ 5 positive / ≥ 5 negative per form (MCP, Bash, PowerShell), like every block-list entry; a `SELECT` is
never blocked; a `database dev:` line lets writes through for that server only.

**Limits** a seatbelt, not a sandbox: a write hidden in a script file or a stored procedure passes; the README says
so. JSPARK Forge never connects to a database itself.

### 5.3 Decision memory (v0.2): the "why" [owner: prompted author, touches, staleness, last verified]

**What it is [owner, 2026-11-03]:** one-line decisions, rules and lessons, each with the files it touches, injected
as context **just before** Claude edits one of those files. It does not describe code structure (that is the map,
5.4).

**Behaviour**
- **Offered, never silent, never without a yes [updated 2026-11-20: as built in v0.2, owner Q-D1]:** after a
  **commit that may have settled a choice** (not one that touches only docs, lockfiles or `.jspark-forge/`, or
  whose subject starts with `chore`, `docs`, `style`, `bump`, `release`, `merge` or `revert`) and when a **plan is
  accepted** (plan-mode exit approved, or a new plan or design file from superpowers), Claude is asked to offer
  *"Record the decision?"* with a drafted line. It is recorded **only after the user says yes** or gives an edit; a
  skip records nothing. Every recording is announced. No offer in unattended runs or at 95 % usage.
- **Kinds:** decision ("prices are stored in cents"), standing rule ("never edit generated files"), lesson from a
  mistake ("a test run without the test flag wrote to real data").
- **Used before changes:** PreToolUse on Edit/Write/NotebookEdit of a path listed in an entry's `touches:` returns
  `additionalContext` listing the matching entries (just-in-time, ≤ 3 entries, one line each), e.g. *"Prices are
  stored in cents — don't change that."*
- **Staleness:** when a commit changes files in an entry's `touches:`, JSPARK Forge flags *"Decision #12 may be stale: still
  valid?"* (at most once per entry per day). Answer yes → `last verified` = today; no → the user edits or retires it.
  [owner 2026-11-20] At most once per entry per day, and only entries recorded or verified more than 14 days ago
  (the code flagged once a week until v0.5.1).
- At SessionStart only an index of titles is loaded (≤ 150 words); full entries just in time.
- **Reference entries [owner 2026-11-03]:** `kind: reference` is a pointer to a file (e.g. `prisma/schema.prisma`,
  `docs/arch.md`); injected as the pointer only, the file read on demand.
- **Long entries [owner 2026-11-03]:** an entry over ~80 words is accepted; JSPARK Forge warns **once** that long entries
  go stale and cost tokens, and suggests a reference instead.
- **No `touches:` [owner 2026-11-03]:** any entry without `touches:` is flagged at 30 days with *"still valid?"*.
- **Demand measured locally [owner 2026-11-03]:** `/jspark-forge:decisions` shows a local count of reference
  entries and long entries, so demand for a real knowledge feature is measured without telemetry (nothing leaves
  the machine). Requests for a separate knowledge base are logged in a local *"declined, revisit at 500 users"*
  list with a count, not refused outright.
- A rule can be promoted to a hook rule in `.jspark-forge/rules.md` when it should be a hard block.

**Data file** `.jspark-forge/decisions.md` (committed; human-readable, editable):
```markdown
## D-012 Prices are stored in cents
- Kind: decision
- Why: avoids rounding errors in totals and refunds
- Decided by: you (drafted by Claude)
- Date: 2026-11-02 · Last verified: 2026-11-02
- Touches: src/billing/**, src/models/price.ts
- Source: commit 3f2e1d0 · plan docs/plans/billing.md
- Status: active   (or: superseded by D-019 / retired)
```

- **`/jspark-forge:check`: "is my memory still true?" [owner, 2026-11-03]:** compares each decision's `touches:`
  files and `last verified` date against the actual files (missing or renamed paths, files changed since last
  verified, globs that match nothing); lists the stale or contradicted entries, each with a one-step prompt
  *"still valid? / update / retire"*. **Read-only unless the user confirms** an update or retirement. Extended in
  v0.3 to check the map too (5.4).

**Commands** `/jspark-forge:decisions` (list, plain), `/jspark-forge:decide "<line>"` (add by hand),
`/jspark-forge:check` (memory check).
**Hooks** PostToolUse (commit, plan accepted, plan file written), PreToolUse (Edit/Write/NotebookEdit just-in-time),
SessionStart.
**Limits** one-line decisions by default (long entries accepted, warned once); ≤ 3 injected per edit; stale flag once per entry per day [owner 2026-11-20]; entries > 200 → JSPARK Forge
suggests archiving retired ones.
**Failure modes** user skips everything → no memory, no nagging beyond the one prompt; `touches:` globs that match
nothing → flagged at SessionStart; superpowers files unreadable → skipped silently.

### 5.4 Codebase map (v0.3): the "what and where" [owner: post-commit refresh; builder: engine]

**Built 2026-11-20 (v0.3)** on codebase-memory-mcp after a Windows trial and spikes F and G; design and review record in
[`design-v0.3.md`](design-v0.3.md); deviations listed there (section 3).

**Integrate, don't build [owner 2026-11-20].** JSPARK Forge does **not** build its own map engine. Code mapping is
crowded (several open-source MCP engines exist), expensive to build, and likely to improve inside Claude Code itself.
JSPARK Forge uses an existing engine and adds only the three layers others skip. [updated 2026-11-20: v0.5] The
engine, `codebase-memory-mcp` (MIT, pinned: 0.12.1 in v0.5.0), ships with the plugin as a server: on the first
start it is installed once with `npm` into `~/.claude/jspark-forge/engines/`, in the background, never inside a
hook, then started by a small launcher (it was a separate install with a one-time tip until v0.5). The pin is
bumped on purpose, like the other pins. The three layers:
1. **Freshness:** every map answer carries "as of <commit>", and a map behind `HEAD` says so.
2. **Database schema from the source files:** tables and relationships read from migrations, Prisma schema, ORM
   models and SQL files (through the engine if it covers them, else a small reader for SQL migrations and Prisma),
   each with the file it comes from. Never the live database (5.2c).
3. **Links to decisions:** a map answer about a file also lists the v0.2 decisions that touch it, so the map answers
   "why" as well as "where".
[updated 2026-11-20: v0.5] There is no install tip any more. Off switches: `- code-map: off` under `## Settings`
in `rules.md`, or `JSPARK_FORGE_CODE_MAP=off`; then the map features stay quiet and everything else works.
`/jspark-forge:doctor` says whether the engine started, with the fix when it did not, and names a second copy of
the engine if the user has their own. In a guest repo the three layers are off (5.2b). The rest
of this section describes what the combined map does; the engine supplies the index, JSPARK Forge the three layers.

**Behaviour:** the architecture memory: a local index of files, symbols, routes and call relations that Claude
queries ("where is the login check?", "what breaks if I change this?") instead of re-reading files. Used by the
scope guard for "new modules / critical paths" facts.

**Also indexed [owner 2026-11-03; updated 2026-11-20: as built in v0.3]:** what the engine indexes (code and the
Prisma schema); SQL migrations are read by JSPARK Forge's own small reader (`/jspark-forge:schema`). Tables and
relationships come from the code itself, never copied into memory (principle 11). `docs/`, ADRs and other ORM
models are not indexed by JSPARK Forge: there is no second index.

**Refresh [owner, 2026-11-03; updated 2026-11-20: as built in v0.3, deviations in design-v0.3 section 3]:**
- **As Claude edits:** the engine's own watcher covers the session's project. JSPARK Forge does no per-file
  refresh.
- **After commits** Claude makes: a background refresh started by the hook, one at a time, never in front of the
  next tool call. There is no git post-commit hook (Q10): `.git/hooks` is never touched.
- **Catch-up** at SessionStart and on each map answer when `HEAD` differs from the indexed commit (pulls, checkouts,
  commits made in a terminal).
Every map answer carries its freshness: the commit it is based on and, when it is behind `HEAD` or on a different
history, the indexing time and the changed files to read first (uncommitted edits included).

**`/jspark-forge:check` (extended from v0.2) [owner, 2026-11-03]:** also says when the map is behind `HEAD` or on a
different history (with the changed files) and when the last refresh failed, each with "refresh now?". Read-only
unless the user confirms.

**Honest caveat [owner, 2026-11-03]:** this is the hardest piece. A stale map is worse than none (Claude trusts
wrong answers), so every answer carries "as of <commit>" and a map behind `HEAD` says so. [updated 2026-11-20] The
engine was chosen after a Windows trial ([`engine-trial.md`](engine-trial.md)). Known risk: on Windows, Defender
has been seen to flag the engine's program wrongly; the user allows it or switches the code map off.

**Engine choice criteria (used for the Windows trial; the engine is never forked or copied into this repo [owner
2026-11-20]; from v0.5 it is installed by JSPARK Forge, pinned, instead of by the user [updated 2026-11-20:
v0.5]):** works on Windows, macOS, Linux without a compiler;
permissive licence (MIT/Apache/BSD); local only (no
upload); exposed over MCP; incremental refresh < 10 s after a commit on a ~50k-line repo; covers the common web
stacks (TypeScript/JavaScript, Python, Go at minimum); index size reasonable (< 200 MB on 50k lines). Candidates
were: codebase-memory-mcp (chosen), Serena (as an optional helper given its app licence), Graphify, CodeGraph.
Non-commercial tools are inspiration only.

**Data** the engine's own index, in the engine's own cache outside the project; JSPARK Forge keeps only
`.jspark-forge/state/map.json` (which commit was indexed, when, the last error) [updated 2026-11-20]. **Hooks**
PostToolUse (commit refresh; freshness on map answers), SessionStart. **Commands** `/jspark-forge:check` (extended),
`/jspark-forge:schema`.
**Failure modes** engine off, not installed yet or not starting → map features quiet, the doctor says why,
everything else works; a refresh that fails or runs long → backs off, and map answers say so with "as of <commit>".

### 5.5 Launch-scope guard (v0.3) [owner]

**Built 2026-11-20 (v0.3):** `/jspark-forge:launch`, `/jspark-forge:scope`, `forge.js launch`; design-v0.3 section 2.

**Behaviour**
- `/jspark-forge:launch` creates `.jspark-forge/launch.md` with **5 blank slots**, a launch date, a "Critical paths"
  line and an "After launch" list (not init, which is optional since v0.1) [updated 2026-11-20: as built in v0.3].
  The guard **does nothing until it exists**. Own projects only.
- When a new idea comes up mid-work, **scope facts first**: *"Adding X: about 3 new modules, touches 2 critical
  paths (billing, login). Your launch list has 7 items; this becomes #8. Before or after launch?"* Options: now,
  after launch, a smaller version, drop.
- A rough time range ("about 1–3 weeks") **only once enough real history exists** (≥ 10 finished launch items with
  start and done dates), always marked "estimate".
- Over-engineering flag (soft rule): "this is more than the problem needs; here's the simplest version."
- The choice is recorded in decision memory with its reason.

**Detection** SessionStart injects the launch list titles; a cheap UserPromptSubmit check for "new scope" phrasing
adds a one-line reminder to run the scope check (at most every 30 minutes, attended sessions only); the judgement
is Claude's (skill `/jspark-forge:scope`), the facts are mechanical (map + launch list + the start and done dates
in `launch.md`) [updated 2026-11-20: as built in v0.3].

**Data** `.jspark-forge/launch.md` (committed): launch date; items with status, start and done dates; "after launch" list.
**Limits / failure modes** no launch file → silent; no map → facts limited to files/lines touched; never blocks.

### 5.6 Security review prompts (later, only if users ask) [owner]

- Name: **"Security review prompts"**, never "auditor" or "scan passed".
- Checks: leaked keys in code and git history; risky or outdated dependencies; common holes (injection, missing
  permission checks, unsafe file handling); unsafe Claude Code settings, hooks and MCP config (wide allow lists,
  hooks fetching remote scripts, tokens in plain config).
- Uses free scanners **if installed** (gitleaks, OSV-Scanner, Trivy, Semgrep CE: detected, not bundled unless the
  licence is permissive and the binary small), plus a Claude checklist for AI-built-code specifics.
- Runs on demand (`/jspark-forge:security`) and optionally before a release.
- Plain output: what, how serious, how to fix, one-step fix where safe.
- **Never prints "clean" or "no issues".** Every output ends with: *"This is a first-pass checklist, not an audit.
  Run semgrep/trivy/your linter before launch."*
- Findings and fixes recorded in decision memory as lessons.

**Council mode (later, with 5.6; for high-stakes reviews such as security and go-live) [owner 2026-11-07]**

Several helpers (different models where available) answer the same review question; each ranks the others' answers
blind; a chair writes the verdict from the ranked answers. Rules, each testable
([`learnings/2026-11-07-council-and-git-dashboard.md`](learnings/2026-11-07-council-and-git-dashboard.md)):

| # | Rule |
|---|---|
| C1 | Labels of the answers are shuffled per evaluator; never a fixed order (fixed order rewards position, not quality) |
| C2 | No evaluator ranks its own answer |
| C3 | The chair is not a voter; it receives the label-to-author map and refuses a verdict that cites an unmapped label |
| C4 | A ranking counts only if it lists every label exactly once; a verdict needs a quorum of complete rankings (Q20); a failed chair never stores a placeholder as the verdict |
| C5 | Aggregate = mean position over complete rankings only; the label map, every ranking and the aggregate are stored with the verdict; fixed seed/temperature where the model allows; bounded retry; per-call timeout; atomic writes |

- Principle 12 holds: the runner enforces C1–C5 mechanically (shuffle, exclusion, quorum, persistence, retry, timeout,
  atomic write); the verdict is advice a person reads and decides on. The 5.6 ending line applies: never "clean".
- Evaluators run through the platform's own helper facility or a locally configured model; the kit itself makes no
  network call (principle 3).
- **Tests:** same inputs, two runs → different label orders; no evaluator sees a label that maps to itself; the chair
  prompt holds every label with its author; a ranking with a missing or duplicated label is discarded; 1 of 3 clean
  rankings blocks the verdict and stores nothing; a reload shows the same rankings and aggregate; a second run with the
  same seed reproduces the aggregate; a hung evaluator times out and the run continues or stops by quorum.

### 5.7 `/capacity` (later, hidden) [owner]

Hidden command (never in the README top section).
- Reads the machine: free memory, CPU, what is running (dev servers, databases, test runs, helpers).
- Knows typical costs per kind of work (a helper editing code ~0.3–0.5 GB; a test run 1–2 GB; a browser check
  1–1.5 GB; editable in a config file) and shared bottlenecks (one test database, one dev server).
- Answers plainly: *"You can run 3 tracks now. Tests will take turns."*
- **Free-up tips:** names large memory users that are not part of the work and what closing each would buy (*"A
  browser is using 3.1 GB. Close it → room for 1 more track."*). **Never closes anything itself**; re-checks after.
- **Working style advice:** one agent alone (cheapest, small clear fixes) vs an agent with helpers that build and
  review each step (more mistakes caught, more time and usage; big or risky work) vs parallel tracks (independent
  jobs on separate branches; limited by memory and shared test resources).
- **Model choice advice [owner 2026-11-03]:** recommends which model per job. **Strongest model** where a mistake is
  expensive or invisible: specs, designs and plans; architecture and data-model decisions; security, permission and
  row-access reviews; database migrations and upgrade scripts; hard debugging; number-correctness checks (does a figure
  mean the right thing); weighing critiques and trade-offs; the final go/no-go release gate. **Lighter model** where a
  mistake is cheap and caught by tests: building from a detailed reviewed plan, mechanical changes (renames, moves,
  version bumps), running tests and reading logs, formatting docs, small well-tested fixes. Plain answer, e.g.
  *"Security review: strongest model. Renaming files: lighter model."* Advice only; the user decides. Writing the
  spec itself (this document) is done with the strongest model.
- Optional guard: PreToolUse on starting a helper → `ask` when free memory is below a floor.
- Upgrade hint when the limit keeps biting.

### 5.8 Dashboard (later, only if users ask) [owner]

- Hooks write **`.jspark-forge/state.json`** at each save (summaries only: launch date and list, decision titles, resume
  status, security finding counts; never code, keys or file contents).
- `/jspark-forge:dashboard` publishes it as a private claude.ai Artifact (where the user's plan allows) showing
  **"as of <timestamp>"**; refreshed when the command is run. Never called "live". Shareable by link at the user's
  choice.
- Fallback: a local static HTML page `.jspark-forge/dashboard.html` rewritten at each save.
- The engine stays local; the dashboard is only a view.

**"What was built" view, computed from git alone (later, only if users ask) [owner 2026-11-07]**

- A view of the dashboard built from the repo's own history, about a hundred lines of the kit's own code, no
  dependency. Groupings: commits per task label (from the handoff and the graph state, 5.10), per day, per model
  (from the action log), with the test-run ids from the log beside each. Still only a view; `state.json` is unchanged.
- Rules, each testable ([`learnings/2026-11-07-council-and-git-dashboard.md`](learnings/2026-11-07-council-and-git-dashboard.md)):

| # | Rule |
|---|---|
| G1 | Escape every commit field (message, author, email) before rendering |
| G2 | Count each SHA once; attribute it to the first ref that reaches it; bucket by authored date; the newest commit is drawn |
| G3 | An explicit time window on authored date; an explicit, configurable "substantial" threshold (lines changed); contributor key = email local part; per-file numstat; one diff per commit, cached |
| G4 | Quote every link; vendor or pin third-party scripts; no CDN fonts: the page renders with the network off |
| G5 | Guard degenerate cases (one timestamp, empty window, one commit) with a plain message, never a crash |

- **Tests:** a message holding markup renders as text; a commit on two branches appears once and the max-date commit
  is drawn; a window of N days returns only those commits; a threshold change moves a commit in or out; the page
  renders with the network off; a one-commit repo and an empty window show a message.

### 5.8a Cut 2026-11-03 (later, only if asked) [owner; principle 12]

- **`/jspark-forge:review`** (use / borrow / avoid verdict report on a guest repo). Reason: a code-review product,
  and a wrong verdict from Claude's judgment does harm.
- **Migration mode** (inventory, parity plan, cutover checklist, sign-off, `migration.md`). Reason: drifts into
  project management. Kept: readonly sources, the source line, migration mappings as decisions, map of readonly sources.
- **Installing project prerequisites** (Python, Docker, language toolchains) [owner 2026-11-19: out of scope].
  Reason: Claude Code already installs them when the user asks, with a permission prompt per command; an installer
  would run admin-rights downloads (what `pipe-to-shell` blocks) and accept licences (Docker Desktop) on the user's
  behalf. Not planned, not "later": cut.

### 5.9 superpowers integration [owner]

- **Required [owner 2026-11-20].** superpowers is a required, declared dependency: it is installed with JSPARK Forge, and the
  plugin does not load without it.
- **Installed with JSPARK Forge [owner 2026-11-19, supersedes "recommend, don't bundle or install"]:** `plugin.json`
  declares `"dependencies": ["superpowers"]`, resolved against the JSPARK Forge marketplace, so installing JSPARK
  JSPARK Forge installs superpowers (tested: "+ 1 dependency: superpowers"). Nothing is copied. A user who already had it from
  another marketplace has two copies: JSPARK Forge says once which to remove (a dependency on another marketplace's
  copy is not used: fresh setups name the official marketplace `anthropic-plugin-directory`, older ones
  `claude-plugins-official`, and cross-marketplace dependencies need an allowlist). JSPARK Forge builds no "how"
  (plan/test/review) piece of its own.
- **Listed in our marketplace [owner 2026-11-19]:** the JSPARK Forge marketplace lists superpowers from its own
  repository at a pinned commit (the same form Anthropic's official marketplace uses), so users install both from
  one place (`/plugin install superpowers@jspark-forge`). Nothing is copied into this repo; the pin is bumped each
  release.
- README section "Works best with superpowers" says why and how to install it.
- First run: if missing, suggest **once** (never again); if present, from v0.2 read its design docs and plans
  as decision-memory sources (review notes cut [owner 2026-11-21]: superpowers writes no file of them). **v0.1 already reads one file [owner 2026-11-19]:** the plan's progress
  ledger (`.superpowers/sdd/<plan>/progress.md`), so the handoff shows "Task 3 of 8" for superpowers users.
- Reads defensively: if the layout changes or a read fails, skip that source silently (covered by a test).
- **Who decides what [owner 2026-11-21: v0.6.2]:** both plugins give rules at a session start, so one line says the
  order: superpowers sets the method, JSPARK Forge the guard rails (resume, block list, decisions, grounding); at a
  session start JSPARK Forge's lines come first; if the two still disagree, the user's own instruction, then the
  block list and grounding rule, then superpowers.
- JSPARK Forge does not run without it [owner 2026-11-20]: Claude Code switches the plugin off when the dependency is missing,
  and the install puts both in place.


### 5.10 Build graph (v0.4; planned "only if users ask", built at the owner's request [owner 2026-11-19]) [owner 2026-11-05: add; builder: runner]

**Built 2026-11-20 (v0.4)** at the owner's request to keep building; Claude runs the graph through `/jspark-forge:build`,
JSPARK Forge keeps the record. What is enforced, evidenced, guarded or only instructed is stated in
[`design-v0.4.md`](design-v0.4.md) section 1 (revision 3, after the code review); deviations in its section 8.

**What.** A build is written down once as a graph: which steps exist, what each hands to the next, which steps can
run side by side, and where a person must act. Claude runs the graph, step by step, through the skill
`/jspark-forge:build` (a plugin cannot start helpers itself); JSPARK Forge hands out the steps, keeps the record,
saves where it is after every step, and resumes from that point in a new session [updated 2026-11-20: as built in
v0.4]. Today this knowledge lives in the head of whoever drives the session.

**Why [owner].** Prompts ask for one answer; an agent works a task; a loop keeps an agent going; a graph decides which
agents exist, in what order, and what passes between them. The graph is the part that survives a crash, a usage limit
or a change of account, and the part a second person can read. It is also where the cost is visible before a run.

**Shape (`.jspark-forge/graphs/<name>.md` as built; the plan said `forge/graphs/`; plain text, one node per heading):**

| Node kind | What it does | Example |
|---|---|---|
| `agent` | One of the four helpers (5.15; the helper carries the model tier), with a brief, inputs and output fields | "build task 5: inputs = plan section, previous report; outputs = commit, test totals, leftovers" |
| `parallel` | Runs its child nodes together, capped by `max_parallel` and plan usage | two document tasks beside one build task |
| `gate` | A fixed check list that must pass: tests, lint, a browser check script | "full test run green; no banned words" |
| `human` | The graph pauses and shows one plain instruction; it continues only on the person's reply | "run this `!` command", "approve the mockup", "merge main" |
| `save` | Writes the handoff and the graph state (5.1) | after every node, automatic |

Edges carry **declared fields only**: a node names what it produces, the next node names what it consumes. Free-text
reports are kept in the handoff but never parsed. The graph is **fixed before the run**: a helper may choose a path
that the graph offers, never add nodes or edges while running.

**Rules.**
- [updated 2026-11-20: as built in v0.4] No model per node: each `agent` node names one of the four helpers, and
  the helper carries the model tier (light for mechanical steps, strongest for design and review; 5.15). Minutes
  per node are measured; tokens are shown only when Claude Code reports them, else "not reported"; estimates come
  only from the graph's own `estimate:` lines, marked "estimate".
- `human` nodes are first-class. JSPARK Forge never decides them: it never performs them, never skips them, never
  asks a helper to. **A person may give their decision early [owner 2026-11-22].** Their own whole message
  `APPROVE AHEAD <graph> <step>` (typed by them in an attended session, like `DONE <step>`; no command, helper,
  quotation or file can give it) is accepted when the graph is valid and trusted and the step is a human step the
  run has not reached. It is stored with the time and the step's `say:` text as it was. When the run reaches the
  step, JSPARK Forge completes it, records "approved ahead by the person at <time>", and prints the instruction and
  that it was approved ahead, so the record shows what was approved without having been read at the time. A step
  marked `- ahead: no` (every release step in the templates) can never be approved ahead; the mark is covered by
  `TRUST GRAPH`. Any change to the graph's steps cancels the approval, and so does stopping the run; the person is
  told. `CANCEL APPROVAL <graph> <step>` withdraws it. `graph status <name>` shows what is approved ahead.
- State lives in `.jspark-forge/state/graph-<name>.json` (as built; the plan said `forge/graph-state.json`) (`done`, `running`, `next`, outputs per node, "as of"). `/jspark-forge:resume`
  shows the graph with the current node highlighted and waits (5.1 show-and-wait).
- A gate that was handed out and that nobody is running is shown as "not yet passed", with how many of its commands
  passed; "running" is said only while `graph gate` runs them [owner 2026-11-21: v0.6.2].
- **Better gates [owner 2026-11-22: v0.7; design-v0.7.md].** (a) `before:` lines on a gate (free memory, a port open
  or free, a container running; fixed forms, never commands) are checked before the gate is handed out and again
  when `graph gate` starts; not met: the gate is not started and nothing fails. This replaces the graph-wide memory
  line cut in v0.4. (b) Every run of a gate command is recorded: counts and failing test names read from the
  runner's output (eight common runners; an unknown one keeps the exit code only), and `graph gate` keeps each run's
  output in a log file (the last 5 per step). (c) `retry:` (one command, on a gate with one `run:` line, shown and
  covered by TRUST GRAPH): a failing full run is followed by the retry of what failed, then by the full command once
  more; only a passing full run completes a gate. (d) A test that failed and then passed with no change git can see
  is recorded and named as flaky, never as fixed. (e) `graph status` reads a running gate's log for progress.
  (f) Every `graph next` ends with the time and tokens so far.
- Principle 12 holds: the runner moves state and enforces gates; it produces no verdicts. A gate's checks are commands
  with exit codes, not judgments. Counts and names read from a runner's output are for people: they never change a
  verdict.
- Parallel nodes are capped by `max_parallel` and by plan usage from the usage bridge (nothing new is handed out at
  the 95 % band; unknown usage counts as under the limit). There is no memory cap [updated 2026-11-20: as built in
  v0.4]. JSPARK Forge never hands out more than the cap; it cannot see helpers Claude starts by itself.
- [updated 2026-11-20: as built in v0.4] A graph whose gates run commands needs the user's typed
  `TRUST GRAPH <name>` first, and again when those commands, a gate or a human step change (or a human step's
  `- ahead: no` mark); a human step completes only on the user's own typed `DONE <step>`, or on their own typed
  `APPROVE AHEAD <graph> <step>` given before the run reached it. **`TRUST GRAPH <name>` is never dropped in silence
  [owner 2026-11-22]:** sent before `graph start` has asked, a graph that exists and is valid is trusted as it is
  now and the answer lists what was just trusted (commands, gates, human steps); a graph that is missing or not valid
  gets one line; a message that is close but not exact trusts nothing and is told the exact text to send. Spaces
  around the message are accepted. Commands that changed after `graph start` showed them are still refused. The run's record is guarded by the `forge-state` block (5.2). What is
  enforced, evidenced, guarded or only instructed: design-v0.4 section 1.
- A node is marked done on its first hand-back; a late or repeated report from the same helper is logged, not re-run.

**What JSPARK Forge ships.** Four templates as built (the three below plus `ui`, spec 5.14), generic, no company words: *spec, plan, tasks, gate, release* (software),
*research, draft, review, publish* (documents), *measure, decide, build* (a spike that gates a task). Claude runs
the loop through the skill, dispatching helpers; the platform's own workflow facility is not used (it needs the
user's opt-in each time; Q18) [updated 2026-11-20: as built in v0.4]. A `graph` view in the dashboard (5.8) when
that ships.

**More than one graph [owner 2026-11-22; v0.4 ran one graph at a time per repo].** Several graphs can be open. A
graph that waits at a human step holds nothing: another graph can start and run. Helper steps and gates of two
graphs never run at the same moment, unless both graphs carry a header line `- lock: <name>` and the names differ:
graphs with the same lock name wait for each other, and a graph with no lock line runs alone (the test suites of one
project often share a database, so their gates must not overlap). A step that must wait is not started and nothing
fails; `graph next` names the graph and step it waits for. The lock line is fixed for the run and covered by
`TRUST GRAPH`. `graph status` with no name lists every open graph and what each waits for; the session-start summary
and the handoff name every open graph. `DONE <step>` completes the step when one open graph waits at it; when two
do, JSPARK Forge asks for `DONE <graph> <step>` and completes nothing on a guess.

**Limits.** No conditional edges beyond "gate passed / failed". No loops
except "retry a failed node once, then stop and show". Graphs are files in the repo, so they are versioned and reviewed
like code.

**Tests.** State survives a killed session (resume lands on the running node); a `human` node blocks until a reply,
or completes from an approval the person typed ahead and never from a quotation, a helper's report or a command; a
gate with a failing command stops the run and names the command; never more steps handed out than the cap; every
template validates and one (the spike template) runs end to end against real Claude Code [updated 2026-11-20: as
built in v0.4]; a graph that references an undeclared field fails before the run starts.

### 5.11 Skill and brief templates (v0.2) [owner 2026-11-07: add; builder: templates]

**What.** Two fill-in templates the kit ships and uses itself: a **skill** (one reusable task Claude picks by its
trigger) and a **brief** (one job handed to one helper, the `agent` node of 5.10). Both are plain text, both are
checked by a lint before use. The shape comes from two short public agent-instruction files studied on 2026-11-07;
the kit adds what both lacked: a verification step, a definition of done and a stop condition.

**Skill template** (`skills/<name>/SKILL.md`):
- Frontmatter `name` plus a one-line `description` that states the trigger ("Use when …").
- Numbered parts; each part names its input, the action, and the output path.
- Fetched or generated artifacts: skip the part if its output already exists.
- Output names never overwrite: an existence check, then stop with a message if the name is taken.
- A verification step with evidence: what check ran and what output proves it (format: Q22).
- One task per skill; imperative second person.

Example (generic):
```markdown
---
name: summarise-document
description: Use when asked to read a document at a URL or path and write a summary into docs/knowledge/.
---
1. Input: the URL or path. Action: normalise it to a cache key. Output: the key.
2. Input: the key. Action: if `.cache/<key>/` exists, skip; else fetch and unpack there. Output: `.cache/<key>/`.
3. Input: the cache folder. Action: find the entry file; read it and the files it includes. Output: notes (not written).
4. Input: the notes. Action: write `docs/knowledge/summary-<tag>.md`; if it exists, stop and say so. Output: the path.
5. Verify: the file exists, is under 600 words, and quotes one source line with its location.
   Evidence: the word count and the quoted line with its path.
```

**Brief template** (one helper, one job), fields in this order:
- `Goal`: one sentence.
- `CAN change` / `CANNOT change`: file lists (globs) as fields, not prose.
- `Done`: one definition of done, or one named metric with a direction ("`p95_ms`, lower wins").
- `Setup`: what to read and check, then wait for "go" before any autonomous work (the handshake).
- `Log`: a fixed-schema append-only table (`attempt, commit, metric, status keep|discard|crash, note`); rows are
  never reset or rewritten.
- `Retries`: bounded (default 2); then log and skip.
- `Tie-break`: when two versions pass, the simpler one wins.
- `Stop`: an explicit stop condition (attempts, budget or time) plus a human gate. Never "never stop".
- `Outputs`: declared fields consumed by the next node (5.10), e.g. `commit`, `test_totals`, `leftovers`.

Example (generic):
```markdown
Goal: make the import step idempotent.
CAN change: src/import/**, tests/import/**
CANNOT change: src/db/schema.*, scripts/measure-import, package manifests
Done: tests/import pass and `scripts/measure-import` reports duplicates = 0
Setup: read docs/plans/import.md; run the test suite once; report the baseline; wait for "go"
Log: .jspark-forge/briefs/import-idempotent.tsv (attempt, commit, duplicates, status, note)
Retries: 2, then log and skip
Tie-break: simpler wins
Stop: after 3 kept attempts or 90 minutes; hand back and wait
Outputs: commit, test_totals, leftovers
```

**Packaging [owner 2026-11-07].** The kit ships both ways from one source: as a **plugin** (skills folder +
marketplace manifest, installed with the platform's plugin commands) and as a **plain instruction file** (one Markdown
file with the same rules) for platforms without plugins. A test diffs the two.

**Tests.** Lint: a skill without a trigger description, without a verification step, or with a part that lacks an
output path fails; a brief without `CAN`/`CANNOT`, without `Done`, or without `Stop` fails; a brief whose `Outputs`
are not declared fields fails before a graph run (5.10). Behaviour: the plugin and the plain instruction file
carry the same rules (diff test). Cut [owner 2026-11-21]: the tests "a skill run twice makes no second fetch and no
overwrite" and "a brief's log survives a killed session". No code runs a skill or writes a brief's log; both are
instructions in the templates that Claude follows, so the lint above is what is tested.

### 5.12 Customer edition (later): a bounded customisation agent [owner 2026-11-07]

**What.** The kit can also run inside a customer's network, on a local model, as a customisation tool for a product
that was built with it. In that role it produces **only the product's declared extension artifacts**: configuration
packs (types, formulas, rules, pages, vocabularies, templates). It never touches the product's core code, its
database or its live servers.

**Rules.**
- Every output passes the product's **own** gates: lint and schema check, a dry run on a check copy inside the
  network, the product's tests at install, its approvals, its signing. The kit adds no gate of its own and bypasses
  none.
- A person approves every install. The kit never approves its own output (principle 12) and never holds a signing
  key (Q21).
- Nothing leaves the customer's network (principle 3 applied to the network, not just the machine).
- Resume, decision memory and the build graph work as in a normal project; the handoff names the pack, not the
  product.

**Prerequisites (the product's side, before this edition exists).**
- Layered packs: core / vendor / customer overlay, so a customer change never edits a vendor file.
- A complete declarative surface: everything a customer may change is expressible in a pack; anything else is out of
  this edition's reach by construction.
- The local model's licence pinned and recorded; model and version named in every output.

**Status.** Later, after the build graph (5.10) and after the product's signed-pack gate exists; built **only when a
product built with the kit asks**. **Open questions it raises:** who signs a customer overlay (Q21); how a core
upgrade treats an existing overlay; what the model is tuned on and who owns that data; whether a customer may keep
the overlay when the vendor relationship ends. The first is listed in `open-questions.md`; the rest are recorded here
until a product asks.

### 5.13 Three ideas noted on 2026-11-19 (later, only if asked) [owner 2026-11-19: add]

Borrowed as ideas from a review of an open-source local agent host; nothing of it is installed or copied (source
notes kept privately, outside this repo). Each passes principle 12: a hook or a script that hands over, saves or points,
never a verdict. None is in a numbered release; each is built only when users ask.

**a. Secrets by name.** A secret (API key, password, token) is saved once on the machine and Claude refers to it by a
name, never by its value.
- A small script resolves the name to the value at the moment a command runs and passes it through the environment of
  that one command. The value never enters the conversation, the handoff, the action log, the decisions file or any
  file under `.jspark-forge/`.
- Storage is the operating system's own keychain (Windows Credential Manager, macOS Keychain, the Linux secret
  service). The kit holds no store of its own and no master password. If no keychain is available the feature is
  off; there is no plain-file fallback.
- An "ask each time" flag per secret: the PreToolUse hook answers `ask` when a command uses that name.
- The block list (5.2) gains one rule: a command that would print a resolved secret (echo, cat of the environment,
  a debug dump) is denied.
- Signing keys are out of scope: never stored, never handed out.
- **Open:** whether a hook can inject an environment variable into a single Bash call on every surface (needs a
  spike before any promise); how output that happens to contain the value is kept out of the transcript.

**b. Limit handover.** When the plan's usage is close to its limit, the work is saved and the person is pointed to
their next option, instead of the session dying mid-task.
- The usage bridge (v0.1, `usage/<session-id>.json` from the status line) already gives the five-hour and seven-day
  figures. **No new threshold:** this piece rides on v0.1's 95 % band (design 7.2). When a plan figure (five-hour or
  seven-day) crosses it, the v0.1 forced save already writes the handoff; this piece only extends that one-line
  message with when the limit resets and the fallbacks the person has configured. The 80 % quiet band is unchanged.
- A fallback is the person's own second way in (another plan they hold, an API key saved under 5.13a). The kit names
  it and gives the one command to continue there; **it does not switch accounts or spend money by itself**. A plugin
  cannot change the signed-in plan, and silent spending on an API key fails principle 12.
- Resume (5.1) works the same on the fallback: the handoff is the carrier, so no re-explaining.
- **Limit:** the usage figures exist only on plans that report them (section 4); elsewhere this piece stays silent.

**c. Health check.** One command, `/jspark-forge:doctor`, that says in plain words whether the kit is working, plus
`status` and `upgrade` beside it. **Pulled into v0.1.1 [owner 2026-11-20]**, without `--fix` and without the installer
step (Claude Code has no post-install hook); see `releases.md`.
- `doctor` checks, read-only: Node version; plugin files present and valid; every hook registered and answering
  inside its timeout; the status-line wrapper in place and `usage.json` fresh; `.jspark-forge/` writable; the last
  handoff readable; the block list parsing; (when 5.13a exists) the keychain reachable. Each line is pass or fail with
  the one step that fixes it. It changes nothing; a `--fix` form applies only the listed steps, each shown first.
- `status`: what is saved now (last handoff time, open "Waiting on you" items, usage as of when).
- `upgrade`: updates the plugin, keeps `.jspark-forge/` and the person's settings, and runs `doctor` afterwards.
- The installer ends by running `doctor`, so a broken install is seen in the first minute.
- Of the three this is the cheapest and the likeliest to be asked for; if one is pulled forward, it is this one
  (Built in v0.1.1 as `/jspark-forge:doctor`, `status` and `upgrade`.)

### 5.14 UI/UX companions (v0.2) [owner 2026-11-20]

**Built 2026-11-20:** the tip (v0.2), the brand-skill template, the `ui` build
graph with screenshot, accessibility (axe) and Lighthouse gates, and ready-to-copy check files (v0.4); the automatic
setup and the "use the skills" rule (v0.5). Sources and choices: [`ui-research.md`](ui-research.md).

**Integrate, don't build** (principles 4 and 7). JSPARK Forge builds no UI tooling; it brings in the best existing
pieces so products built with it get first-class UI/UX [updated 2026-11-20: v0.5; a tip with install lines until
v0.5]:
- **frontend-design** (Anthropic's official skill, claude-plugins-official): a clear visual direction before UI code.
  Added once per machine, in the background, with `claude plugin install`. **Not a dependency** (many projects have
  no UI; a disabled dependency would stop JSPARK Forge loading).
- **Chrome DevTools MCP** (claude-plugins-official): console errors, performance and layout shift on the live page.
  Added the same way.
- **Playwright MCP**: Claude opens the running app, takes screenshots and clicks through flows, so it checks its own
  UI instead of guessing from code. Ships with the plugin as a server (`@playwright/mcp`, pinned: 0.0.86 in v0.5.0),
  installed once with `npm` like the code map engine (5.4). Needs Node 20 or newer (off on Node 18 and 19); serves
  tools only in a project with a front end.
- **shadcn/ui and its MCP server** (React / Next.js): accessible components copied into the project. Stays a manual
  step, as a one-time tip in the user's own React projects: it is per project and writes the project's config, which
  an automatic setup must not do.
- **A brand skill per product** (colours, type, spacing, voice): recommended pattern, with a short template.

**Behaviour [updated 2026-11-20: v0.5]**
- **Set up once, never again.** Each automatic step happens once per machine; a companion the user removed stays
  removed. A failed install is recorded and shown by `/jspark-forge:doctor`, which reports each piece ok or FIX.
- **Off switches:** `JSPARK_FORGE_AUTO_SETUP=off` (no automatic adding of the two companions), `- playwright: off`
  under `## Settings` in `rules.md` or `JSPARK_FORGE_PLAYWRIGHT=off`. Undo for the companions: `/plugin uninstall`.
- **The skills are used, not only installed [owner 2026-11-20].** In the user's own project with a front end (a
  `package.json` depending on react, vue, svelte, next, nuxt, astro or similar, or `.html` / `.tsx` / `.vue` files),
  Claude is told at every session start, and each helper that builds, plans or reviews is told when it starts, to
  load frontend-design and the brand skill before it designs or changes anything a user sees, and to check the
  result on the real page. The brand skill is named with `- brand-skill: <name>` under `## Settings` (the user's
  own `rules.md` for every project, or a project's for that project); with none named, Claude is told to look among
  its skills and to ask before it chooses colours or a typeface itself. `- ui-skills: off` switches the rule off.

**Before listing** each companion: check its licence (permissive), current activity and Windows support. The two
servers JSPARK Forge installs with `npm` are pinned by version; the two companions from Anthropic's directory are
not pinned (listed in [`spec-coverage.md`](spec-coverage.md)) [updated 2026-11-20: v0.5]. **Limit** not a guarantee
of good design; the check that matters is Claude looking at the running UI (Playwright).

### 5.15 Model map: which model does what, and why (v0.2) [owner 2026-11-20]

**Built 2026-11-20 (v0.2):** `agents/planner.md`, `reviewer.md`, `builder.md`, `checker.md`, `rules/model-tiers.json`;
verified with real Claude Code (the checker was dispatched and ran).

**What.** JSPARK Forge ships four helper agents, each pinned to a model **tier** with a one-line reason, so the right
strength of model does each job without the user choosing every time. Built with the skill and brief templates
(5.11): a brief is one job for one helper, and the helper decides the model.

| Helper | Tier | Does | Why that tier |
|---|---|---|---|
| `planner` | strongest | specs, designs, plans, architecture and data-model choices | a mistake here is expensive and invisible until late |
| `reviewer` | strongest | design and code reviews, security and permission reviews, migrations, the release go/no-go | its job is to catch what others missed |
| `builder` | standard | builds from a reviewed plan, small well-tested fixes | the plan carries the judgement; tests catch slips |
| `checker` | light | runs tests, reads logs, renames, moves, version bumps, formatting | mechanical; a mistake is cheap and visible |

- **Tiers, not names:** the plugin maps each tier to a current model (strongest = the top model of the day) and is
  updated when Anthropic releases models; briefs and plans never name a model.
- **Visible and overridable:** each helper's tier and reason show when it is used; the user can name another helper
  or model for any job. Advice the user can see, not a hidden rule (principle 12).
- **Soft coupling (principle 7):** works beside superpowers; when superpowers hands a task to a helper, its briefs can
  name these helpers. Checked before building: if superpowers cannot be pointed at them, they stay available by name.
- **Source of the reasons:** the model-choice advice of 5.7, made concrete.
- **Tests:** each helper file declares its tier's model and a description that says when to use it; a lint fails a
  helper without a tier or reason; the tier map has one entry per tier.
- **Estimate:** ~1 day, in v0.2 with 5.11.

---

## 6. Plugin shape and platforms [builder unless marked]

- A Claude Code plugin [owner], not an app or IDE. Works where Claude Code runs (terminal, IDE extensions, desktop);
  hooks and status line behaviour checked per surface before claiming it.
- Components: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/` (resume, handoff, init; later decisions,
  scope-check, security, capacity, dashboard), `scripts/` (Node, no dependencies), `rules/default-blocklist.json`.
  [updated 2026-11-20: v0.5] Also `agents/` (the four helpers, 5.15) and `.mcp.json`: two servers (the code map
  engine, Playwright) started through one launcher, `scripts/mcp/run.js`. The pinned packages are installed once
  with `npm` into `~/.claude/jspark-forge/engines/`, in the background, never inside a hook; an install that was cut
  short is cleaned up and done again at the next start.
- **Install and first start [updated 2026-11-20: v0.5]:** one install command; superpowers comes with it (5.9). On
  first start JSPARK Forge sets up the rest by itself, each once per machine and each with a stated undo: its status
  line when the user has none (5.1), the two servers, the two UI companions (5.14) and auto-update.
- **Auto-update [updated 2026-11-20: v0.5]:** switched on once per machine through one key in `settings.json`
  (`extraKnownMarketplaces["jspark-forge"].autoUpdate`); nothing else in the file changes, and a file that is not
  valid JSON is left alone. Never when the user has already set it either way; never switched on a second time.
  Undo: `/plugin` → Marketplaces → jspark-forge. `JSPARK_FORGE_AUTO_SETUP=off` stops the automatic switch-on.
- `/jspark-forge:doctor` reports auto-update, the code map, Playwright and the two companions, each ok or FIX with
  the fix [updated 2026-11-20: v0.5].
- Runtime: **Node ≥ 18**, exec-form hooks (no shell quoting, same on Git Bash and PowerShell) (Q3). The Playwright
  server needs Node ≥ 20 [updated 2026-11-20: v0.5].
- Project files under `<project>/.jspark-forge/`; machine files under `~/.claude/jspark-forge/`; guest-mode state
  under `~/.claude/jspark-forge/guests/<repo-hash>/` (nothing written in a guest repo, 5.2b).
- The project folder is **hidden**: `.jspark-forge/` [owner, 2026-11-03 review]; its own `.gitignore` ignores
  everything except `rules.md` (and the later committed files `decisions.md`, `launch.md`). The local page copies
  (`artifacts.md`, `artifacts/`) stay local, on this machine only [owner 2026-11-20]; build graph files (`graphs/*.md`) are committed [owner 2026-11-20].
- Windows: path normalisation, atomic rename retries, LF files. v0.1 matches Bash / Git Bash command forms (also
  when Claude Code runs them through the PowerShell tool); PowerShell command forms come in v0.1.1.

---

## 7. Release plan

| Release | Contents | Estimate | Acceptance criteria | Success metric (per user, first month) |
|---|---|---|---|---|
| **0. Design** | This spec + v0.1 design + spikes run, owner approval. Before-code order [owner, 2026-11-03 review]: (1) fix headless guard, hidden folder, PostToolUse matcher + timeouts in the design; (2) cut v0.1 to one week (cut list below); (3) run spikes A–C + D (headless); (4) build | ~½ day + 1 day spikes | Spikes A–D recorded; facts table updated; deviations from review recorded (principle 13) | n/a |
| **v0.1 Resume + hooks** | Handoff + save triggers (no 10-minute trigger) + usage bridge + show-and-wait (instructed only) + notes reminder (`additionalContext`, no extra turn) + action log; grounding rule at SessionStart (5.1a); block list (Bash / Git Bash forms) + typed confirm + rules.md; helper rule injection only if spike C passes; every hook documented; demo GIF; Win/Mac/Linux | **~1 week (real build)** | **Ship gate [owner 2026-11-03]:** ships only when the kill-and-resume test passes on Windows, macOS and Linux (after spikes A–D); grounding rule present after startup/resume/compact; resume < 30 s on ~50k-line repo, measured on a cold machine; no file changed before the user answers; a `claude -p` run with a handoff present is never stalled; every published block has tests; uninstall/undo leaves the status line as before; `claude plugin validate --strict` passes | Back to work **< 2 min** after a cutoff with no re-explaining |
| **v0.1.1** | **Waiting on you** list (5.2a); PowerShell command forms for the block list and write detection; ~~hook-enforced show-and-wait guard~~ (dropped 2026-11-19 after design review: it would release before the turn it guards; show-and-wait stays instructed, design-v0.1.1 section 1) (skipped in non-interactive runs); **guest mode + quarantine, readonly sources** (5.2b) | ~4–5½ days (base ~2–3 + Waiting on you ~1 + external code ~1–1½) | PowerShell forms have the same ≥ 5 positive / ≥ 5 negative tests per entry; guard never fires in a detected headless run; guest mode writes nothing inside the repo (file-tree diff test); `readonly-source` and `guest-quarantine` have ≥ 5 positive / ≥ 5 negative tests | as v0.1 |
| **First user (gate) [owner 2026-11-20, revised]** | The owner is the first user: each release is used on the owner's real work before the next one starts; what the owner hits is fixed first. Build continues to v0.3 (owner: "I am the first user, so I need a complete product"); v0.4 is decided after v0.3 is in use. The outside launch (20–50 users: plugin directory, superpowers community, a short demo) follows v0.3 | Calendar time between releases | Measured without telemetry (principle 3): installs, GitHub issues and stars, direct replies | Users who come back after a cutoff in a second week |
| **v0.2 Decision memory (the "why")** (the centrepiece [owner 2026-11-20]) | One-line decisions, rules and lessons with the files they touch; offered after a commit that may have settled a choice and after a plan; injected just before Claude edits a touched file (PreToolUse `additionalContext`); stale flags; last verified; `/jspark-forge:check` memory check (read-only unless confirmed); superpowers sources; `kind: reference` pointers; long-entry warning; 30-day flag for entries without `touches:`; local counts in `/jspark-forge:decisions`. Not a description of code structure. Plus (5.2b): migration mappings as decisions, licence check | ~4½–5 days | The offer appears after a commit that may have settled a choice and after an accepted plan, never silent, recorded only after the user's yes [updated 2026-11-20: as built]; editing a touched file injects the entry; changed touched files raise one flag/day [owner 2026-11-20], 5.3; `/jspark-forge:check` changes nothing without confirmation; superpowers absence or layout change does not break anything (test); a reference entry injects only its pointer; an entry over ~80 words is accepted with one warning, never blocked; an entry without `touches:` is flagged at 30 days; `/jspark-forge:decisions` shows reference and long-entry counts; a knowledge-base request is logged with a count, not refused | Claude **does not break a past decision** |
| **v0.2 Skill and brief templates (5.11)** | Skill template (trigger description, numbered parts with input → action → output path, skip-if-exists, non-overwriting outputs, verification step with evidence) and brief template (`CAN`/`CANNOT`, `Done`, `Setup` handshake, fixed-schema log, bounded retries, tie-break, `Stop`, declared `Outputs`); lint; plugin + plain instruction file from one source | ~1 week | Lint rejects a skill or brief missing any required field; plugin and plain file carry the same rules (diff test) | Every helper brief in a build is written from the template without re-explaining scope |
| **v0.2.1 Database guard (5.2c)** | Production databases read-only unless CONFIRM db-write; MCP, Bash and PowerShell forms; `database dev:` line in the user's own `rules.md` | ~1–1½ days | ≥ 5 positive / ≥ 5 negative tests per form; a SELECT is never blocked; a dev line relaxes only its own server | No unconfirmed write reaches a production database |
| **v0.3 Map (the "what and where") + scope guard** | **Thin layer on an existing engine (5.4, integrate, don't build [owner 2026-11-20])**: freshness ("as of <commit>"), schema from source files, links to decisions, on top of the engine's index. Codebase map: local index of files, symbols, routes and call relations, plus the schema source, kept fresh by the engine's own watcher as Claude edits and refreshed in the background after commits and when `HEAD` moved, queried instead of re-reading files, answers show "as of <commit>" (engine: codebase-memory-mcp, chosen after a Windows trial) [updated 2026-11-20: as built]; `/jspark-forge:check` extended to the map; `.jspark-forge/launch.md` via `/jspark-forge:launch`; scope facts; history-based range later; map of readonly sources (5.2b, built in v0.4.1). **Caveat:** a stale map is worse than none | ~1 week, **soft until the engine trial is done** (smaller: no engine is built) | File re-index never blocks the next tool call; map refresh < 10 s after commit on ~50k lines (or async with "as of"); answers always show last-refresh time; guard silent until launch.md exists; facts shown before any estimate; estimate only with ≥ 10 history items | **At least one feature shrunk or postponed** because the guard showed its cost |
| **v0.4 Build graph (built at the owner's request [owner 2026-11-19])** | Graph file format + templates (four as built); Claude runs the loop through `/jspark-forge:build`, JSPARK Forge keeps the record; `state/graph-<name>.json`; resume lands on the running node; `human` and `gate` nodes; parallel cap by `max_parallel` and plan usage; minutes per node measured, tokens only when reported [updated 2026-11-20: as built] (5.10) | ~1½–2 weeks (soft: after v0.3 and the engine trial; built only if users ask, since multi-agent runs are the feature most likely to be absorbed by Claude Code) | State survives a killed session; human node blocks; gate stops on a failing command; never more steps handed out than the cap; every template validates and one runs end to end | A build of ≥ 5 tasks completed across ≥ 2 sessions without re-briefing |
| **v0.5 Installs once, runs on its own; resume survives a crash (released 2026-11-20) [owner 2026-11-20]** | Self-setup after the one install command (issue #7): auto-update switched on once; the code map engine and Playwright shipped as pinned plugin servers; frontend-design and Chrome DevTools added once in the background; the doctor reports each (5.4, 5.14, section 6). Resume: saves on every user message and once a minute while Claude works without writing files; the log fills the gap after the last save; history from the log for all sessions; a helper's report never counts as the user's message or grants a `CONFIRM`; step progress from the task tools (5.1, 5.2). The UI skills are used, not only installed (5.14). Published pages kept as local files (principle 9) | not estimated | No manual step after the install command; nothing downloads inside a hook; nothing the user switched off is switched on again; the doctor shows each piece ok, or FIX with the fix (a missing code map is never "ok"); the kill-and-resume test passes against real Claude Code on Windows, macOS and Linux | After the one install command, nothing else to set up by hand |
| **Council mode (with 5.6, later)** | Several helpers answer a high-stakes review; blind shuffled rankings; chair with the label map; quorum; persisted rankings and aggregate (C1–C5) | — (sized with 5.6) | C1–C5 tests pass; 1 of 3 clean rankings stores no verdict; a reload shows the same rankings | — |
| **Git view (with 5.8, later)** | "What was built" from the repo alone: per task label, per day, per model, test-run ids; G1–G5 | — (sized with 5.8) | G1–G5 tests pass; the page renders with the network off; a one-commit repo shows a message | — |
| **Customer edition (5.12, later)** | The kit inside a customer's network on a local model, producing only a product's declared extension artifacts through the product's own gates; after the build graph and the signed-pack work; **only when a product built with the kit asks** | — (not sized) | Output limited to declared pack artifacts (test: any other write is denied); every output goes through the product's gates; no network egress; model licence recorded | — |
| **Later, only if asked** | Security review prompts (incl. council mode), `/capacity`, dashboard (incl. the git view), `/jspark-forge:review`, migration mode (5.8a), customer edition (5.12), secrets by name, limit handover (5.13; the health check shipped in v0.1.1) | — | per section 5 | — |
| **Total to v0.3** | | **~4–4½ weeks of build after v0.1.1, plus ~2 weeks of user feedback (soft: v0.3 depends on the engine trial; 5.11 adds ~1 week to v0.2; v0.4 ~1½–2 weeks more, built at the owner's request)** | | |

**v0.1 cut list [owner, 2026-11-03 review]** (what left v0.1 and where it went):

| Item | Was | Now |
|---|---|---|
| PowerShell command forms (block list, write-redirect detection) | v0.1 | **v0.1.1** |
| Save every 10 minutes of activity | v0.1 trigger (f) | **Dropped** (Stop saves after every reply) |
| Hook-enforced show-and-wait (deny until reply) | v0.1 (Q8) | **v0.1.1, only if spike D passes**; v0.1 is instructed only |
| SubagentStart rule injection | v0.1 | **Stays conditional on spike C** (not shipped if C fails) (since v0.5.1 every helper is given the grounding rule, the guest line and the UI rule at SubagentStart [updated 2026-11-21: v0.5.1]) |
| Stop-block notes nudge (extra turn) | v0.1 (Q5) | **Removed**; replaced by the `additionalContext` notes reminder (in v0.1, no extra turn) |

---

## 8. Testing strategy

- **Unit:** block-list matcher (≥ 150 commands, Bash / Git Bash forms in v0.1, PowerShell forms added in v0.1.1;
  positive and negative per entry, incl. `.env.example` allowed and `rm -rf .` / `.git` inside the repo); rules.md parser;
  handoff cap and trimming; log redaction, rotation, expiry, cap; usage bands, staleness; confirm tokens; status-line
  wrapper pass-through and byte-identical undo. Later: decisions parser, `touches:` matching, launch.md parser.
- **Integration (headless `claude -p`):** a hook-fire test that drives every hook event once and asserts one log line
  per hook; a `claude -p` run with an open handoff is never stalled; `claude plugin validate --strict` in CI;
  Windows/macOS/Linux matrix.
- **The resume test (no ship without it) [owner]:** the v0.1 ship gate: must pass on Windows, macOS and Linux,
  after spikes A–D [owner 2026-11-03]. Start a scripted task, kill the session mid-task (process tree,
  no warning), restart, assert the resume restores task, step, next action and running jobs, changes nothing before
  the user answers, and loads in < 30 s on a ~50k-line repo, measured on a cold machine (no warm node cache) [owner,
  2026-11-03 review].
- **Grounding-rule test (v0.1):** the rule text is in the injected context after `startup`, `resume` and `compact`.
- **Soft-coupling test:** superpowers missing, present, and with a changed layout: JSPARK Forge keeps working.
  [owner 2026-11-20] superpowers is required, so there is no "missing" case to test: the integration job installs it first.
- **Template lint (v0.2):** skills and briefs missing a required field (trigger, verification, output path;
  `CAN`/`CANNOT`, `Done`, `Stop`, declared `Outputs`) are rejected before use; plugin and plain instruction file
  carry the same rules (5.11).
- **Guest-mode test (v0.1.1):** a full session in a guest repo leaves its file tree and `git status` unchanged;
  after `/jspark-forge:init --guest`, quarantined commands are denied; writes under a `readonly:` path are denied
  with no CONFIRM path.
- **Self-setup and crash tests (v0.5) [updated 2026-11-20: v0.5]:** the `settings.json` write (every "never when"
  case); the doctor lines; the bundled servers load against real Claude Code; a `CONFIRM` inside a helper's report
  or pasted text grants nothing; the kill-and-resume test runs in CI on all three systems.
- **Manual before release:** Pro/Max plan-usage path; the 5 most common community status lines; uninstall.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Becoming what it warns against (too many pieces) | Release gates; "later, only if asked"; lean principle |
| Claude Code changes hooks, status line, plugin format | Thin dependence; facts table re-checked each release; hook-fire test before each release; `/jspark-forge:doctor` once it ships (5.13c); fail open |
| Status-line bridge is a workaround | Timestamp + 2-minute rule; step triggers as the real guarantee; spikes A–B |
| Anthropic absorbs features (resume and memory are the likeliest) | Build only opinionated project judgement; no thin wrappers. The durable edge is what a platform will not ship: hard safety rules, guest-repo protection, decisions tied to files [owner 2026-11-20]. Map: integrate an engine, never build one; build graph only if users ask |
| `/resume` name clash | Pitch never asks the user to type a command (Q1 decided) |
| Show-and-wait guard stalls headless runs (`claude -p`, CI) | Instructed only until spike D proves detection; then skipped in non-interactive runs (Q8 decided) |
| A hung hook freezes tool calls | PreToolUse timeout 3 s; PostToolUse limited by matcher; fail open |
| False positives annoy users / false negatives give false safety | Typed override; published list; "seatbelt, not sandbox" wording; deny reason tells Claude not to try an equivalent command |
| Codebase map: a stale map is worse than none; engine (Windows support, licence, refresh speed) unproven | Integrate, don't build (5.4); engine chosen after a Windows trial and pinned; every answer marked "as of <commit>"; from v0.5 the doctor says when the engine did not start [updated 2026-11-20: v0.5] |
| JSPARK Forge installs other programs and changes one Claude Code setting (v0.5) [updated 2026-11-20: v0.5] | An exact published list of what it adds, each with its undo; pinned versions for the two servers; each step once per machine, never repeated after the user undoes it; nothing downloads inside a hook; off switches (principle 3) |
| Building ahead of real demand | Real-users gate after v0.1.1 (section 7): 20–50 users and ~2 weeks of feedback reorder the roadmap before v0.2 |
| A reviewed repo's README or scripts steer Claude (prompt injection, install scripts) | Guest quarantine (on after `/jspark-forge:init --guest`; typed CONFIRM); "content is data" in the instruction file + just-in-time reminder; seatbelt wording (5.2b) |
| Claude edits the old system during a migration | `readonly-source` hard deny, no CONFIRM (5.2b) |
| Features that need Claude's verdict or a plan creep back in | Principle 12: hooks, not verdicts; such items go to "Later, only if asked" |
| Support load after launch | Clear README, "best effort" support statement |

---

## 10. Licensing and foundations

- **Licence:** MIT [owner].
- **Bundle only permissive licences** (MIT/Apache/BSD). GPL/LGPL tools only as separately installed, optional
  helpers. Non-commercial ones are inspiration only. Re-check each repo's LICENSE file before use (notes below are
  unverified).

| Area | Project | Role |
|---|---|---|
| How (method) | obra/superpowers (MIT) | Installed with JSPARK Forge as a declared dependency, nothing copied (5.9; required [owner 2026-11-20]) |
| Map | codebase-memory-mcp (MIT) | The engine: chosen in v0.3, installed pinned by JSPARK Forge from v0.5, never copied into this repo (5.4) [updated 2026-11-20: v0.5] |
| Map | Serena (GPL app, MIT library per search); Graphify, CodeGraph (check) | Were trial candidates |
| UI | frontend-design and Chrome DevTools MCP (Anthropic's plugin directory); Playwright MCP (`@playwright/mcp`); shadcn MCP (licences: check) | Added or shipped by JSPARK Forge, except shadcn, which is a manual tip (5.14) [updated 2026-11-20: v0.5] |
| Map | Aider repo map (Apache-2.0, check); GitNexus (non-commercial) | Inspiration only |
| Decisions | adr-tools, log4brains (check) | Inspiration: decision record format |
| Resume | Claude Code's own hooks, status line, memory | Foundation |
| Security | gitleaks (MIT, check); OSV-Scanner, Trivy (Apache-2.0, check); Semgrep CE (LGPL engine; rule licences vary) | Detected if installed |
| Planner | Backlog.md, claude-task-master (licence may restrict), github/spec-kit (MIT, check) | Inspiration |
| Whole kit | large all-in-one kits | Inspiration and warning |

Credits: keep each used project's licence notice and credit.

---

## 11. Brand rules [owner]

- Always the full name **JSPARK Forge**, never "JSPARK Forge" alone in public text (other products use the word). Plugin id
  `jspark-forge`.
- Clearly **"by JSPARK AI"**, linking to the company site.
- Say **"built for Claude Code"**. Never put "Anthropic" or "Claude" in the product name or logo, and never suggest
  endorsement unless Anthropic agrees in writing.
- No references to any company project (including the founders' own products) in the repo, commits, README or
  examples: the tool must look like it belongs to its users.
- Before launch: secure `jspark-forge` on GitHub and package registries; trademark check.

---

## 12. Open questions

See [`open-questions.md`](open-questions.md). Decided on 2026-11-03: Q1 (pitch), Q5 (notes reminder, no Stop
block), Q8 (show-and-wait instructed only until spike D). Top open: Q2 which accounts run the plan-usage spike; Q3
requiring Node.js; Q4 committing the handoff. New with external code (5.2b): Q15 where hooks write before init; Q16
guest-state retention; Q17 extra commands for guest quarantine. New with the build graph (5.10): Q18 runner on
platforms without a workflow facility; Q19 graph file format (plain headings vs a schema). New with the research of
2026-11-07: Q20 council quorum and tie rules (5.6); Q21 who signs a customer overlay (5.12); Q22 verification
evidence format in the skill template (5.11).

**Owner decisions after the first spec-coverage check [owner 2026-11-20]** (applied in place):
1. **superpowers is required** (principle 7, 5.9, section 8): a declared dependency, installed with JSPARK Forge.
2. **Stale-decision flags: at most once per entry per day** (5.3), with the 14-day grace; the code follows from v0.5.1.
3. **Local copies of published pages stay local** (principle 9, section 6): `.jspark-forge/artifacts.md` and
   `artifacts/` are not committed.
4. **Build graph files are committed** (5.10, section 6): `.jspark-forge/graphs/*.md`; their run state stays local.
5. **Resume may read more than the handoff** (5.1): the action log, Claude's notes and the other files the handoff
   names, whenever they add to it.
6. The v0.5 row's acceptance criteria and success metric (section 7) are accepted as written.
