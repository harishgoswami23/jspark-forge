# JSPARK Forge v0.1: design (resume + hooks)

Status: build-ready, approved with the spec on 2026-11-03 (spec status line; changelog "Spec final"); revised
2026-11-03 after an external review the owner accepted. Spike results may still change it (section 16). Scope: **v0.1 only**. The whole-product spec is [`spec.md`](spec.md); spikes are in
[`spikes.md`](spikes.md); owner decisions still open are in [`open-questions.md`](open-questions.md).

**Before-code order [owner, 2026-11-03 review]:**
1. Fix in this design: the headless guard (section 8), the hidden `.jspark-forge/` folder (3.1), the PostToolUse
   matcher and the hook timeouts (section 3). Done in this revision.
2. Cut v0.1 to a real one-week build, with the cut list in the spec's release table (spec section 7). Done.
3. Run spikes A–C + D (headless detection) (section 14, `spikes.md`).
4. Build (section 15).

**Spike results override review decisions [owner, 2026-11-03 review]:** if a spike contradicts a reviewed decision
(e.g. headless detection is impossible from hook input, or the PostToolUse matcher misses a write path we need), the
spike wins: record the deviation, the evidence and the reason in section 16 ("Deviations from review"), and update
the affected decision here and in the spec.

Every decision is tagged:
- **[owner]**: taken by the owner in the product spec. Change it only with the owner.
- **[owner, 2026-11-03 review]**: owner decision from the accepted external review. Change it only with the owner,
  or through a recorded spike deviation (section 16).
- **[builder]**: builder's call. Change it freely and record the reason in the commit.
- **[spike]**: depends on a spike result (see `spikes.md`).

Claude Code facts are cited to the official docs (checked 2026-11-02; hook input fields, PreCompact output and
timeouts re-checked 2026-11-03):
hooks `code.claude.com/docs/en/hooks.md`, status line `.../statusline.md`, subagents `.../sub-agents.md`,
plugin manifest `.../plugins/manifest-reference.md`, plugin components `.../plugins/components.md`.

---

## 1. Goals, non-goals, anti-goals

**Goals (v0.1)**
1. After a crash, logout, context limit or plan limit, the user is back at work in **under 30 seconds** with no
   re-explaining. [owner]
2. Saves happen on **mechanical, published triggers**, never on Claude's judgement alone. [owner]
3. A **published list of dangerous actions** is blocked by hooks, with a typed confirmation to override. [owner]
4. Each hook is documented: what it listens to, what it writes, what it blocks. [owner]
5. Runs on Windows, macOS and Linux. [owner]
6. Claude stays grounded: a ≤ 10-line grounding rule is injected at every SessionStart (8.1). [owner 2026-11-03]

**Ship gate [owner 2026-11-03]:** v0.1 ships only when the kill-and-resume test (section 13) passes on Windows, macOS
and Linux, after spikes A–D.

**What v0.1 carries across sessions [owner, 2026-11-03]:** only the handoff (task, step, files touched, branch,
Claude's own notes). That is enough to resume the work; it is not a map of the system. The "why" (decision memory)
comes in v0.2 and the "what and where" (codebase map) in v0.3.

**Non-goals (v0.1)**: decision memory (v0.2), codebase map and launch-scope guard (v0.3), security review prompts,
`/capacity`, dashboard (later, only if asked). No reading of superpowers files yet (v0.1 only suggests it once). [owner]
Moved out of v0.1 by the one-week cut [owner, 2026-11-03 review]: PowerShell command forms (→ v0.1.1); the
10-minute activity save (dropped, Stop covers it); hook-enforced show-and-wait (→ v0.1.1 if spike D passes); the
Stop-block notes nudge (replaced by an `additionalContext` reminder, 5.3). SubagentStart rule injection stays
conditional on spike C. Full cut list: spec section 7. Not in v0.1 [owner 2026-11-03]: guest mode, guest quarantine
and readonly sources (v0.1.1, spec 5.2b); v0.1 assumes one owned project in one folder.

**Anti-goals**: no thin wrappers on native features (plan mode, basic memory); no extra service, daemon or network
call; nothing leaves the machine; no auto-continue after a cutoff (show and wait); no feature that needs Claude to
remember to use it. If v0.1 needs more than ~1 week to build, it is too big. [owner 2026-11-03] Store
nothing Forge can re-derive from the repo: specs, schema and architecture are indexed from their source files by
the v0.3 map, never copied into memory; users may still write whatever they want into `decisions.md`, and Forge
never blocks it (spec principle 11).

---

## 2. Verified platform facts this design rests on

| Fact | Source | Used for |
|---|---|---|
| Context % (`context_window.used_percentage`) is given **only to the status line**; may be `null` early and right after `/compact` | statusline.md | usage bridge |
| Plan quota (`rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`, `resets_at`) is **status line only**, present **only for Pro/Max/Ultra** (or a gateway spend limit), only after the first reply; each window may be absent | statusline.md | usage bridge, README caveat |
| Status line runs at session start, on each new assistant message, after `/compact`, on permission-mode change, and on an optional `refreshInterval` timer (min 1 s); debounced 300 ms; an in-flight run is cancelled by a newer one | statusline.md | freshness rule |
| Only **one** `statusLine` command; a plugin's `settings.json` can set only `agent` and `subagentStatusLine`, **not** `statusLine` | plugins/components.md "Default settings" | installer must edit user settings |
| On Windows, status line and shell-form hooks run through Git Bash if installed, else PowerShell | statusline.md, hooks.md | runtime choice |
| Exec-form hooks (`command` + `args`) spawn directly with no shell | hooks.md | all Forge hooks use exec form |
| `PreToolUse` can return `permissionDecision` `allow` / `deny` / `ask` / `defer` with a reason; precedence deny > defer > ask > allow; `defer` only in `-p` | hooks.md | block list |
| `PreToolUse`/`PostToolUse` hooks from plugins **fire inside subagents**, with `agent_id`/`agent_type` | hooks.md | blocks reach helpers |
| `SubagentStart` accepts `hookSpecificOutput.additionalContext` (context only, no blocking) | hooks.md | rule injection [spike] |
| `SessionStart` sources: `startup`, `resume`, `clear`, `compact`, `fork`; accepts `additionalContext` | hooks.md | resume flow, re-load after compaction |
| `PreCompact` (trigger `manual`/`auto`), `Stop` (has `last_assistant_message`), `SessionEnd` (reasons `clear`, `resume`, `logout`, `prompt_input_exit`, `other`) exist | hooks.md | save triggers |
| `PreCompact` can only block compaction (exit 2 or `decision: "block"`); its `systemMessage` and `continue` are discarded; it is not an `additionalContext` event | hooks.md "PreCompact" | notes reminder at compaction needs another route (5.3) |
| `SessionEnd` hooks share a **1.5 s budget**, raised to the largest per-hook `timeout` up to 60 s | hooks.md | SessionEnd save must be fast |
| Default `command` hook timeout is **600 s** (30 s on UserPromptSubmit) | hooks.md "Common fields" | every Forge hook sets a short `timeout` |
| Common hook input: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode` (`default`/`plan`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`; not on every event), `effort`, `hook_event_name`; SessionStart adds `source`, `model`, `agent_type`, `session_title` (+ resume cost fields) | hooks.md "Common input fields", "SessionStart input" | **no documented interactive/headless field**; `permission_mode` does not tell `-p` apart |
| `-p` appears only as a behaviour condition: `defer` is honoured only with `-p`; `initialUserMessage` only with `-p`; `$CLAUDE_CODE_REMOTE` marks remote web only | hooks.md | headless detection is unproven → spike D; Q8 instructed only |
| Plugin commands/skills are namespaced: `/jspark-forge:resume` | plugins/components.md | command names |
| `${CLAUDE_PLUGIN_ROOT}` changes on every plugin update; `${CLAUDE_PLUGIN_DATA}` survives updates but is **deleted on uninstall** | plugins/manifest-reference.md | where the status-line wrapper lives |
| Claude Code has a **built-in `/resume`** (pick a past session) | product behaviour | pitch never says "type `/resume`" (Q1 decided) |

---

## 3. Plugin layout [builder]

```
jspark-forge/
├── .claude-plugin/plugin.json
├── hooks/hooks.json                 # every hook, exec form, node
├── skills/
│   ├── resume/SKILL.md              # /jspark-forge:resume
│   ├── handoff/SKILL.md             # /jspark-forge:handoff
│   └── init/SKILL.md                # /jspark-forge:init  (disable-model-invocation: true)
├── scripts/
│   ├── forge.js                     # single dispatcher: node forge.js <event>
│   ├── lib/blocklist.js  lib/handoff.js  lib/log.js  lib/usage.js  lib/confirm.js  lib/git.js
│   └── statusline/install.js  statusline/wrapper.js
├── rules/default-blocklist.json     # the published list, data not code
├── templates/rules.md  templates/gitignore
├── tests/                           # unit + headless integration (section 13)
├── docs/   README.md   LICENSE (MIT)
```

Skills, not `commands/`: the docs call commands "the older format" and recommend skills for new plugins.

**plugin.json**
```json
{
  "name": "jspark-forge",
  "displayName": "JSPARK Forge",
  "version": "0.1.0",
  "description": "Resume after a crash, logout or limit. Rules enforced by hooks.",
  "author": { "name": "JSPARK AI", "url": "https://<jspark-site>" },
  "homepage": "https://github.com/<org>/jspark-forge",
  "repository": "https://github.com/<org>/jspark-forge",
  "license": "MIT",
  "keywords": ["resume", "handoff", "hooks", "safety", "solo-founder"]
}
```
The name passes the reserved-name check (no "claude"/"anthropic"). [owner: brand rules]

**hooks/hooks.json** (shape; every entry is exec form so paths with spaces and Windows shells don't matter):
```json
{ "hooks": {
  "SessionStart":   [{ "matcher": "startup|resume|clear|compact",
                       "hooks": [{ "type": "command", "command": "node",
                                   "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/forge.js", "session-start"], "timeout": 10 }]}],
  "UserPromptSubmit":[{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "prompt"], "timeout": 10 }]}],
  "PreToolUse":     [{ "matcher": "Bash|PowerShell|Edit|Write|NotebookEdit|mcp__.*",
                       "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "pre-tool"], "timeout": 3 }]}],
  "PostToolUse":    [{ "matcher": "Edit|Write|NotebookEdit|Bash|PowerShell|TodoWrite|TaskCreate|TaskUpdate|Agent|mcp__.*",
                       "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "post-tool"], "timeout": 10 }]}],
  "PostToolUseFailure":[{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "post-tool-fail"], "timeout": 10 }]}],
  "Stop":           [{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "stop"], "timeout": 10 }]}],
  "PreCompact":     [{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "pre-compact"], "timeout": 10 }]}],
  "SessionEnd":     [{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "session-end"], "timeout": 1 }]}],
  "SubagentStart":  [{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "subagent-start"], "timeout": 10 }]}],
  "SubagentStop":   [{ "hooks": [{ "type": "command", "command": "node", "args": ["…/forge.js", "subagent-stop"], "timeout": 10 }]}]
}}
```
`SubagentStart` rule injection ships only if spike C passes (section 10); without it the hook only records helper
start for job tracking. [spike]

**Matchers and timeouts [owner, 2026-11-03 review]:**
- **PostToolUse has a matcher**: `Edit|Write|NotebookEdit|Bash|PowerShell|TodoWrite|TaskCreate|TaskUpdate|Agent|mcp__.*`.
  These are the tools that write files, run commands, change the todo list, start helpers or reach outside
  (MCP). Read, Grep and Glob are excluded: they change nothing, and they are the most frequent calls, so a `node`
  start (≈ 40–80 ms) after each would add seconds of delay to every long search for no saved state. If a spike
  shows a write path the matcher misses, the spike wins (section 16).
- **PreToolUse timeout 3 s** (was 10 s): PreToolUse sits in front of every matching tool call, so a hung hook
  freezes the call until the timeout. 3 s is ~20× the 150 ms budget below; past it, Claude Code cancels the hook and
  the call goes ahead (fail open).
- **SessionEnd timeout 1 s** with a minimal write (5.1 trigger e): Stop has already saved after the last reply, so
  SessionEnd only stamps the end reason and time; it stays inside the shared 1.5 s budget.
- Other hooks keep 10 s: they run after the action, not in front of it.

**Hook rules [builder]:** never raise; any internal error → no output, exit 0 (fail open, so a broken Forge never
stops work) and one `FORGE-ERROR` line in the log; the hook-fire test (section 13) catches silent breakage before each release. (The
user-facing health check is `/jspark-forge:doctor`, spec 5.13c, not in v0.1.) Each run
must finish in < 150 ms on a normal laptop (one `node` start ≈ 40–80 ms).

### 3.1 Files Forge creates in the user's project [builder unless marked]

```
<project>/.jspark-forge/
├── handoff.md            # ≤ ~600 words, rewritten in place            [owner: cap]
├── rules.md              # user's own block entries (committed)        [owner: file name]
├── .gitignore            # "*" then "!.gitignore" and "!rules.md": ignores everything except these two
├── state/session-<id>.json   # last save times, threshold bands, todo snapshot, background jobs
├── state/notes.md        # Claude's own short notes for the handoff (≤ 120 words)
├── state/confirm.json    # one-shot typed-confirmation tokens
├── usage/<session-id>.json   # written by the status line                [owner: one usage file; per-session file is builder's refinement]
├── log/YYYY-MM-DD.log    # action log, 7 days                            [owner: retention]
├── log/summary.md        # one short block per expired day
└── archive/handoff-<timestamp>.md   # previous handoffs when a task is closed
```
**Hidden folder [owner, 2026-11-03 review]:** the project folder is `.jspark-forge/` (leading dot), not a visible
`forge/`, so it stays out of the user's file tree and does not look like project source. The rules file lives at
`.jspark-forge/rules.md`. The folder carries its own `.gitignore` (above), so the user's root `.gitignore` needs no
change; `/jspark-forge:init` never edits the root `.gitignore`.

Per-session usage files (not one `usage.json`) because two sessions in one project would overwrite each other's
figures. Recommendation on whether `handoff.md` is committed: open question Q4 (default: not committed).

Machine-level files (outside any project): `~/.claude/jspark-forge/statusline.js` (wrapper copy),
`~/.claude/jspark-forge/statusline.json` (the user's original status-line config), `settings.backup-<ts>.json`.

---

## 4. Save triggers (published list) [owner]

A **save** = rewrite `.jspark-forge/handoff.md` from the current state (section 5) + one `SAVE <reason>` log line.

| # | Trigger | Hook | Detection |
|---|---|---|---|
| a | After any tool call that writes or edits a file | PostToolUse | tool is `Edit`, `Write`, `NotebookEdit`; or a Bash command (Bash or PowerShell tool) with a Bash-form write redirect (`>`, `>>`, `tee`) to a path in the project. PowerShell forms (`Set-Content`, `Out-File`) in v0.1.1 |
| b | After any commit | PostToolUse | command containing `git … commit` (any `-C`, env prefix, or chained position) and exit success; the save records the new HEAD |
| c | When Claude finishes a reply | Stop | always |
| d | Before the conversation is compacted | PreCompact | `manual` or `auto` |
| e | When the session ends | SessionEnd | any reason; **minimal write** (end reason + time stamped into the handoff; Stop already saved the content); timeout 1 s, inside the 1.5 s budget [owner, 2026-11-03 review] |
| f | Context or plan limit | any Forge hook | 80 %: quiet save + notes reminder (5.3); 95 %: forced save + message (section 7) |

The former "every 10 minutes of activity" trigger is **dropped** [owner, 2026-11-03 review]: Stop saves after every
reply, so a timer adds nothing in v0.1.

**Debounce [builder]:** trigger a within 5 s of the previous save is merged (the next trigger saves). Triggers b, c,
d, e, f always save. A save takes < 50 ms (reads small JSON + git, writes one file atomically: temp file + rename).

**Commit detection limits (documented):** commits made outside Claude (the user's own terminal) are seen at the next
Forge hook through `git rev-parse HEAD` changing; the next save records them.

---

## 5. Handoff file

### 5.1 Sources [builder]
Hooks are programs, not Claude, so most fields are **mechanical facts**; one block is **Claude's own words**.

| Field | Source |
|---|---|
| Task, Step "4 of 10", Done | the session's todo list, captured on PostToolUse of the todo/task tools (`TodoWrite`, or `TaskCreate`/`TaskUpdate` and the `TaskCreated`/`TaskCompleted` events, whichever the running Claude Code version has: builder check B3) |
| Next action | first open todo item; else Claude's notes; else "not recorded" |
| Still running at cutoff | background shells started with `run_in_background` (PostToolUse) and helpers between SubagentStart and SubagentStop; marked "may have stopped" |
| Waiting on you | set when Claude's last message ends in a question (Stop: `last_assistant_message` ends with `?`) or a permission prompt was pending (PermissionRequest seen without a following tool result) |
| Your last request | last UserPromptSubmit `prompt`, first 200 chars, redacted |
| Branch, HEAD, uncommitted files | `git` (skipped if not a repo) |
| Recent actions | last 8 log lines of this session, condensed |
| Claude's notes | `.jspark-forge/state/notes.md`, written by Claude when asked (5.3) |

### 5.2 Format and example (hard cap ~600 words) [owner: cap; builder: layout]

```markdown
# Where we were
As of 2026-11-02 14:32 · saved because: commit · branch feature/save-as-chart @ 3f2e1d0 · 2 files not committed

**Task:** Add "Save as chart" to the report page
**Step:** 4 of 10: write tests for the save route
**Done:** steps 1–3 (last commit 3f2e1d0 "add chart model")
**Next action:** write tests in tests/save_chart.test.ts, then run them
**Still running at cutoff:** `npm run dev` (started 14:05, may have stopped)
**Waiting on you:** nothing
**Your last request:** "carry on with the plan, stop before deploy"

**Claude's notes (14:28):** The save route reuses the existing export permission check. Chart titles are
limited to 80 characters (agreed with you at 14:10). Tests for empty reports still to write.

**Recent actions:** 14:20 edited src/routes/save.ts · 14:24 ran tests (2 failed) · 14:27 fixed
src/routes/save.ts · 14:31 commit 3f2e1d0
**Files touched in this task:** src/routes/save.ts, src/models/chart.ts, tests/chart.test.ts
**More detail:** .jspark-forge/log/2026-11-02.log · older handoffs: .jspark-forge/archive/
```

Over the cap: drop "Recent actions", then trim "Files touched" to 5, then trim notes to 60 words. Never trim the
seven bold top fields. If several sessions are active in one project, the file holds one block per session, newest
first, at most 3, still within the cap. [builder]

### 5.3 Claude's notes: how they stay current [owner, 2026-11-03 review; Q5 decided]
**No Stop block in v0.1.** Instead of forcing an extra turn, Forge adds one line of `additionalContext`,
*"JSPARK Forge: update your notes now in .jspark-forge/state/notes.md (max 120 words: what you are doing, anything
agreed with the user, what is next)."*, at the moments the notes matter:
- **PreToolUse of a `git commit`** (Bash command matched as in trigger b): Claude reads it alongside the commit and
  updates the notes in the same turn.
- **PreCompact**: compaction is where context is lost. *Documented limit:* PreCompact cannot return
  `additionalContext` (section 2), so the PreCompact hook sets `notes_due` in `state/session-<id>.json` and the
  reminder rides on the next hook that can inject: the SessionStart `compact` re-injection right after compaction
  (section 8). For auto compaction the 80 % band below normally fires first. Spike A checks this; if it confirms the
  limit, the route above is recorded as a deviation in section 16.
- **The 80 % usage band** (once per band per window, with the quiet save in trigger f).

No extra turn, no `decision: "block"`, no `stop_hook_active` handling. At most one reminder per commit or band.
Users can switch it off in `.jspark-forge/rules.md` (`notes: off`); the handoff then has facts only.

### 5.4 Lifecycle
Rewritten in place on every save. When the user says the task is finished (`/jspark-forge:handoff done`), the file is
moved to `.jspark-forge/archive/` and a fresh empty handoff starts. Archives older than 30 days are deleted. [builder]
(v0.2 adds: lasting lessons move into decision memory before archiving.)

---

## 6. Action log

**Format** (one line per event, UTF-8, LF): [builder, from a proven prototype]
```
14:24:07 [a1b2c3d4]          BASH  run unit tests :: npm test -- save_chart
14:24:31 [a1b2c3d4/9f8e7d6c] EDIT  src/routes/save.ts
14:31:02 [a1b2c3d4]          COMMIT 3f2e1d0 add chart model
14:31:02 [a1b2c3d4]          SAVE  commit
14:40:15 [a1b2c3d4]          BLOCK git-reset-hard :: git reset --hard HEAD~2
```
Kinds: `USER`, `EDIT`, `WRITE`, `READ` (off by default), `BASH`, `PS`, `MCP`, `AGENT+`, `AGENT-`, `COMMIT`, `SAVE`,
`BLOCK`, `CONFIRM`, `STOP`, `COMPACT`, `END`, `FAIL`, `FORGE-ERROR`. Detail ≤ 300 chars, whitespace collapsed.
`[session/agent]` = first 8 characters of each id.

**Redaction [builder]:** before writing, replace likely secrets with `‹redacted›`: `sk-…`, `ghp_…`/`github_pat_…`,
`AKIA…`, `xox[bp]-…`, `Bearer <token>`, `password=…`/`pwd=…`/`token=…`, `-p<password>` on mysql/psql lines, and
any value read from `.env*` files. Imperfect by nature; the log never leaves the machine and is git-ignored.

**Lifecycle [owner: daily rotation, 7 days, summary, size cap; builder: numbers]:**
- One file per local day: `.jspark-forge/log/YYYY-MM-DD.log`.
- **Size cap 2 MB per day**: at the cap, write `LOG CAPPED` once, then only `SAVE`, `BLOCK`, `CONFIRM`, `COMMIT`.
- At SessionStart (lazy, no scheduler): files older than **7 days** are summarised into `.jspark-forge/log/summary.md` and
  deleted. Summary per day, mechanical (no model call): counts per kind, top 10 files edited, commit subjects,
  blocks fired, sessions. Keep the latest 60 day-summaries.
- `/jspark-forge:resume` never reads the log (only the handoff); the log is the safety net for "what happened inside
  the lost step".

---

## 7. Usage bridge (status line → file → hooks)

Treat it as a workaround, because it is one. [owner]

### 7.1 Status-line wrapper
- Claude Code allows **one** status-line command, and a plugin cannot set it. So `/jspark-forge:init` offers to
  install a **wrapper** into the user's `~/.claude/settings.json`. [owner]
- The wrapper is copied to `~/.claude/jspark-forge/statusline.js`, **not** run from the plugin folder, because
  `${CLAUDE_PLUGIN_ROOT}` changes on every update and `${CLAUDE_PLUGIN_DATA}` is deleted on uninstall. If the plugin
  is later removed, the wrapper keeps working as a pure pass-through. [builder]
- New setting: `"statusLine": {"type": "command", "command": "node ~/.claude/jspark-forge/statusline.js"}` (forward
  slashes; `~` works on Windows per the docs). The user's original `padding` and `refreshInterval` are kept.
- On each run, the wrapper:
  1. reads stdin JSON;
  2. if `workspace.project_dir/.jspark-forge/` exists, writes `.jspark-forge/usage/<session_id>.json` atomically:
     `{"ts": <epoch ms>, "context_pct": n|null, "five_hour_pct": n|null, "seven_day_pct": n|null,
       "five_hour_resets_at": n|null, "seven_day_resets_at": n|null}`;
  3. runs the user's **original** command (saved in `statusline.json`) with the same stdin, through the same shell
     Claude Code would use (Git Bash if present on Windows, else PowerShell; `sh -c` elsewhere), timeout 2 s;
  4. prints the original output unchanged, then Forge's short part (`· Forge saved 3m ago`), which the user can
     switch off. If the original command fails or times out, prints Forge's part only.
- Spike B decides the exact shell call and whether a `refreshInterval` is needed. [spike]
- **`refreshInterval` [owner 2026-11-19, spike A]:** when the user's status line has none, the installer sets
  `refreshInterval: 30` (disclosed in 7.4, removed on undo); a user's own value is kept. Re-test passed 2026-11-19 (7/7 fresh).
- **Added time [owner 2026-11-19, spike B]:** ~100 ms median per refresh on Windows is accepted (status line is off
  the tool path); the 50 ms target stays for macOS/Linux; revisit only if users notice.

### 7.2 Hooks reading the figures [owner: thresholds and 2-minute rule]
- Every Forge hook reads `.jspark-forge/usage/<session_id>.json`. Figures with `ts` older than **2 minutes** are ignored.
- Highest of the available figures decides the band:
  - **≥ 80 %**: quiet save, once per band per window. No message.
  - **≥ 95 %**: forced save at once + the user sees (hook `systemMessage`):
    *"Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were."* Claude also gets
    `additionalContext` asking it to finish the current small step, update its notes, and not start new work.
    Repeats at most once per window.
  - The 80 % band also carries the notes reminder (5.3).
- Bands re-arm when the figure drops (after compaction or a window reset).
- **Fallback:** no wrapper, figures absent (non-Pro/Max/Ultra plan, before the first reply) or stale → triggers a–e
  still keep the handoff no more than one step behind, plus the manual `/jspark-forge:handoff`.

### 7.3 Caveats shown on the README first screen and in install output [owner]
- **Plan-limit saves need a Pro, Max or Ultra plan** (Claude Code only shares plan usage with those plans).
  Context-limit saves work on every plan.
- Forge touches your status line (wrapper); how to undo it is printed at install.

### 7.4 Installer disclosure and undo [owner: disclosure; builder: wording]
`/jspark-forge:init` shows, before changing anything:
> JSPARK Forge wants to wrap your status line so it can see context and plan usage (only shown to the status line).
> Your current status line: `<command or "none">`. It will still show exactly as now; Forge adds a short "saved"
> note after it. A backup of your settings goes to `~/.claude/jspark-forge/`.
> Undo any time: `/jspark-forge:init --undo-statusline` (or run `node ~/.claude/jspark-forge/statusline.js --undo`).
> Go ahead? (yes / no)

Undo restores the saved `statusLine` object byte-for-byte (or removes the key if there was none). If a **project**
`settings.json` sets its own status line, it wins over the user one in that project; `/jspark-forge:init` says so
and that plan-limit saves will not work there.

---

## 8. Resume flow (show and wait) [owner: show-and-wait; builder: mechanics]

**On SessionStart `startup` / `resume` / `clear`**, if `.jspark-forge/handoff.md` exists, is not closed and is < 14 days old:
1. `systemMessage` (the user sees it at once, no tokens spent):
   *"JSPARK Forge: last time you were on "Add Save as chart", step 4 of 10. Next: tests for the save route. Say
   'continue' or tell me what to do instead."*
2. `additionalContext` for Claude: the full handoff + *"Before doing anything else, in your first reply show this in
   plain words (≤ 8 lines, ending with 'Continue?') and wait for the user's answer. Do not change files or run
   commands for the old task until they reply. If their first message is a new task, say in one line what was in
   progress (parked) and then do the new task."* The last sentence keeps `claude -p` and CI runs working: their
   prompt is the user's instruction, so the run is never stalled.
3. If the current branch differs from the handoff's branch, both say so.

**On SessionStart `compact`:** re-inject the handoff + active rules with *"carry on; no need to ask"* (compaction is
not a cutoff). If `notes_due` is set (PreCompact, 5.3), add the "update your notes now" line.

**`/jspark-forge:resume`** (skill): reads only `.jspark-forge/handoff.md` (never the log), shows the same plain summary, offers
"show details" (branch, commits, files, log path), and waits.

**Show-and-wait is instructed only in v0.1 [owner, 2026-11-03 review; Q8 decided].** The earlier plan (PreToolUse
denies Edit/Write/Bash/PowerShell while `awaiting_user=true`, cleared by the next UserPromptSubmit) is **not built in
v0.1**. Reason: SessionStart `startup` fires for `claude -p` in CI and scripts too, and there the guard would deny
the run's own work. The hook input has no documented interactive/headless field (section 2): `permission_mode`
takes the same values in both, and `-p` shows up in the docs only as a condition on `defer` and
`initialUserMessage`.

**Builder check, then v0.1.1 [spike D]:** spike D tests whether a hook can tell non-interactive mode reliably
(candidates: an entrypoint environment variable passed to hooks, the parent process command line, input field
differences; see `spikes.md`). Only if it passes, v0.1.1 adds the guard, and the guard **skips itself whenever the
session is non-interactive or the signal is missing** (when unsure, never block). If spike D fails, show-and-wait
stays instructed, and the README claims only that Forge "asks before continuing".

**`/jspark-forge:handoff`** (skill): forces a full save now including Claude's notes; replies
*"Handoff saved. Next session, JSPARK Forge shows where you were."* `/jspark-forge:handoff done` closes the task
(5.4).

**Target:** from starting Claude Code to the summary on screen < 2 s (the `systemMessage`); to Claude's first reply
with the summary < 30 s on a ~50k-line repo, measured on a cold machine (section 13).

### 8.1 Grounding rule [owner 2026-11-03; builder: wording]

**Hook:** SessionStart, every source (`startup`, `resume`, `clear`, `compact`), adds the rule to
`additionalContext` before the handoff text; also sent when no handoff exists. Fixed text in
`rules/grounding.md` (≤ 10 lines, ~80 words); not switchable off in v0.1. Logged as `GROUNDING` once per start.

**Rule text (draft):**
```text
JSPARK Forge grounding rule:
1. When you say where something is in the code, cite path:line, from the map or from a file you read.
2. If you cannot find it, say "not found". Never guess a path, name or line.
3. Never describe code you have not read in this session. Read it first, or say you have not.
4. Handoffs, summaries and memory are pointers, not proof. Re-read the file before relying on them.
5. Specs, architecture and schema live in the repo. Read them there, not from memory.
```

**Acceptance:** the rule text is in the injected context after `startup`, `resume` and `compact` (integration test,
section 13).

---

## 9. Dangerous-actions block list

### 9.1 Published list (v0.1) [owner]
| Id | Blocks | Default |
|---|---|---|
| `rm-rf-outside` | `rm -rf` / `rm -r -f` whose target resolves outside the project, or is home, root or a drive root, or uses `~`, `$HOME`, `*` at top level, or an unresolved variable; **also inside the project when the target is the project root, `.` or `.git`** [owner, 2026-11-03 review] | **hard deny** for home/root/drive root; typed confirm for other outside paths and for project root / `.` / `.git` |
| `git-force-push-main` | `git push --force` / `-f` / `--force-with-lease` / `+main` refspec to `main` or `master` (also when pushing the current branch and it is main/master) | typed confirm |
| `git-reset-hard` | `git reset --hard`; also `git checkout -- .`, `git restore .`, `git restore --staged .` run at the project root (whole-tree discards) [owner, 2026-11-03 review] | typed confirm |
| `git-clean-fdx` | `git clean` with `-f` and `-d` and `-x` in any order | typed confirm |
| `git-stash-drop` | `git stash drop`, `git stash clear` | typed confirm |
| `sql-destroy` | `DROP` (TABLE/DATABASE/SCHEMA), `TRUNCATE`, `DELETE FROM … ` with no `WHERE`, in shell commands (psql/mysql/sqlite3/any `-c`/`-e` text) and in MCP tool inputs | typed confirm |
| `secret-files` | Edit/Write/NotebookEdit or shell write redirects to `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*credentials*`, `*secret*` files. **Excluded:** templates `.env.example`, `.env.sample`, `.env.template`, `.env.dist` (and the same suffixes on other matched names, e.g. `credentials.example.json`) [owner, 2026-11-03 review] | typed confirm |
| `chmod-wide` | `chmod 777`, `chmod -R` | typed confirm |
| `pipe-to-shell` | `curl … \| sh/bash`, `wget … \| sh` | typed confirm |

**Command forms [owner, 2026-11-03 review]:** v0.1 matches **Bash / Git Bash forms only**, whichever tool (Bash or
PowerShell) runs them; for git and `curl` commands the text is the same in both shells. PowerShell forms
(`Remove-Item -Recurse -Force`, `rmdir /s`, `iwr … | iex`, `Set-Content .env`, `icacls … /grant Everyone:F`) move to
v0.1.1.

Matching is case-insensitive, on each sub-command (split on `;`, `&&`, `\|\|`, `\|`, newlines), command words only at
command position (text inside quotes does not match). [builder]

**Honest limit, stated in the README:** this is a seatbelt, not a sandbox. A determined or obfuscated command
(`eval`, base64, a script file) can get past pattern matching. [builder]

### 9.2 Typed confirmation [owner: typed; builder: mechanism]
`PreToolUse` cannot read what the user types, and `ask` gives only a yes/no prompt. So:
1. A matching action → `permissionDecision: "deny"` with the reason:
   *"JSPARK Forge blocked: `git reset --hard` throws away uncommitted work. Do not try an equivalent command; tell
   the user and stop. To allow it once, the user types: CONFIRM git-reset-hard"*.
   Every deny reason (built-in, user "Confirm" and "Never" lines, hard deny) carries the sentence *"Do not try an
   equivalent command; tell the user and stop."* [owner, 2026-11-03 review], so Claude does not route around a block
   with `git checkout -- .` or a script.
2. The user types `CONFIRM git-reset-hard`. The **UserPromptSubmit** hook (which sees only the user's own prompts)
   writes a one-shot token to `.jspark-forge/state/confirm.json`: `{id, session, expires: now+5 min}`.
3. Claude retries; PreToolUse finds the token, consumes it and returns `permissionDecision: "ask"` (the normal
   Claude Code prompt, with the reason shown). One confirmation, one action. [builder: `ask` keeps a final native
   check; owner may prefer `allow`, see Q6]
4. Hard-deny entries ignore tokens and always return `deny`.
Claude cannot forge the token: it does not pass through UserPromptSubmit (builder check B4 confirms subagent prompts
don't either).

### 9.3 User-extensible `.jspark-forge/rules.md` [owner: file; builder: syntax]
```markdown
# JSPARK Forge rules for this project
Lines under "Confirm" need a typed CONFIRM. Lines under "Never" are always refused.
Text in backticks is matched as written; start it with re: for a regular expression.

## Confirm
- `terraform destroy` : destroys cloud infrastructure
- `re:kubectl\s+delete\s+(ns|namespace)` : deletes a whole namespace

## Never
- `drop database production` : production database

## Settings
- notes: on
- statusline-segment: on
- disable: chmod-wide
```
Parsed on each PreToolUse (cached by file mtime). A malformed line is skipped and reported once at SessionStart.
`disable:` turns off a built-in entry (logged at SessionStart: "you switched off chmod-wide").

---

## 10. Rules reaching helper agents [owner: conditional on spike C]
- **Always true (documented):** plugin PreToolUse hooks fire inside subagents, so **every block also applies to
  helpers.** v0.1 claims at least this.
- **If spike C passes:** `SubagentStart` returns `additionalContext` with ≤ 120 words: the block-list ids, the user's
  "Never" lines, and "the main session's handoff is at .jspark-forge/handoff.md". README may then say "rules reach every
  helper". If it passes only for some agent types, the claim names only those.
- **If spike C fails:** the hook is not shipped; README says only *"safety blocks still fire inside helpers."*

---

## 11. Windows, macOS, Linux

**Runtime: Node.js (≥ 18), zero npm dependencies. [builder, recommended]**

| | Node | Python |
|---|---|---|
| On target users' machines | Very likely (technical founders shipping web apps; npm-installed Claude Code needs it) | Missing by default on Windows; `python` may be the Microsoft Store stub that opens the Store; macOS ships none without developer tools |
| Same command everywhere | `node` on all three | `python` vs `python3` vs `py` differs by platform |
| Claude Code docs examples | plugin hook, MCP and status-line examples use `node` | status-line examples only |
| JSON, files, child processes, `os.freemem` (for later `/capacity`) | built in | built in |
| Startup cost | ~40–80 ms | ~30–60 ms |

Decision: Node, exec form (`"command": "node", "args": [...]`), so neither Git Bash nor PowerShell parses the
command, and paths with spaces are one argument. `/jspark-forge:init` checks `node --version` and says plainly if it
is missing (hooks would fail open, so protection would be off). Single-file bundling to a binary is out of scope.

**Other platform points [builder]**
- Paths: normalise to forward slashes and lower-case on Windows before comparing (project containment for
  `rm-rf-outside`); treat `/c/…` (Git Bash) and `C:\…` as the same.
- Shell commands to match come from **both** `Bash` and `PowerShell` tools. v0.1 matches Bash / Git Bash forms in
  both; PowerShell forms (`Remove-Item -Recurse -Force`, `iwr | iex`, `Set-Content .env`) come in v0.1.1 [owner,
  2026-11-03 review].
- Files written with LF and UTF-8 (no BOM). Atomic writes via temp file + rename (on Windows, retry rename up to 3
  times if the file is locked by an editor or antivirus).
- Killing on test: `taskkill /T /F` on Windows, `kill -9` on the process group elsewhere.
- Time: local time in files, epoch ms in JSON.

---

## 12. Privacy [owner]
- Nothing leaves the machine. No network calls, no telemetry, no update checks by Forge.
- Everything lives in `<project>/.jspark-forge/` (git-ignored except `rules.md`) and `~/.claude/jspark-forge/`.
- The log redacts likely secrets (section 6). The handoff holds no file contents, only paths and short text.
- Uninstall leaves the user's files; README says how to delete them.

---

## 13. Testing strategy

**Unit (node:test, no dependencies) [builder]**
- Block list: a table of ≥ 150 commands (should block / should not), in Bash / Git Bash forms (PowerShell forms
  added in v0.1.1), incl. quoted text, chained commands, `git -C`, env prefixes, Windows paths, `git checkout -- .` /
  `git restore .` at the root vs on one file, `rm -rf .` / `.git` / a subfolder inside the project, `.env` vs
  `.env.example`. Every published entry has ≥ 5 positive and ≥ 5 negative cases. Every deny reason contains "Do not
  try an equivalent command; tell the user and stop."
- Hook config: PostToolUse matcher does not match Read/Grep/Glob; PreToolUse timeout is 3 s; SessionEnd 1 s.
- `rules.md` parser: valid, malformed, regex, disable.
- Handoff: 600-word cap with oversized inputs; trimming order; multi-session blocks.
- Log: redaction cases; daily rotation; 7-day expiry with summary; 2 MB cap.
- Usage: stale (> 2 min) ignored; bands 80/95; re-arm; missing fields.
- Typed confirmation: token one-shot, expiry, session-bound, hard-deny ignores tokens.
- Status-line wrapper: pass-through byte-identical; original command failure; undo restores byte-identical settings.

**Integration, headless (`claude -p`, real Claude Code, API key) [builder]**
- Each hook fires once per event (hook-fire test: a scripted session that triggers every event and asserts one log
  line per hook).
- Headless safety: with an open handoff present, `claude -p "<small task>"` completes its task (not stalled waiting
  for a reply), and the reply mentions the parked task in one line.
- Grounding rule: the rule text appears in SessionStart `additionalContext` for `startup`, `resume` and `compact`.
- Notes reminder: a commit in a scripted session produces the "update your notes now" context and no extra turn.
- `claude plugin validate --strict` in CI.

**The resume test (no ship without it) [owner]**: the v0.1 ship gate; must pass on all three platforms after
spikes A–D [owner 2026-11-03].
1. Fixture: a pinned public open-source repo of ~50k lines (builder picks one with a permissive licence; recorded in
   `tests/fixtures.md`), copied to a temp folder, `.jspark-forge/` initialised.
2. Start `claude -p "<a scripted 10-step task with a todo list>"` in the background.
3. Watch `.jspark-forge/log/`; after ≥ 3 EDIT lines and ≥ 1 COMMIT, **kill the whole process tree** (no warning).
4. Assert: `.jspark-forge/handoff.md` exists; its HEAD = the repo HEAD; Step is ≥ the last completed todo; Next action is
   not empty; "Still running" lists the background job the task started.
5. Start a new session with the resume command; measure wall time from launch to the first reply, **on a cold
   machine** (fresh boot or fresh CI runner, no warm node or file cache from steps 1–4) [owner, 2026-11-03 review].
6. Assert: the reply names the task, the step, the next action and the running job; **no file changed** after the
   resume (git status identical) because it must wait; time < 30 s.
7. Run on Windows, macOS, Linux (CI matrix with an API-key secret; manual run before each release if CI is not
   possible).

**Manual checks before release:** Pro/Max plan quota path (needs a subscriber account; CI cannot do it); status-line
wrapper with the 5 most common community status lines; uninstall leaves a working status line.

---

## 14. Spikes before code [owner: must run first]
Full checklists in `spikes.md`. Summary:
- **A. Usage figures:** when `context_window` / `rate_limits` first appear and how fresh the status line is.
  Pass: fresh (< 2 min) at ≥ 95 % of hook calls during active work; figures present on Pro/Max after reply 1.
- **B. Status-line wrapper:** chaining a user's existing command on all 3 platforms. Pass: identical output,
  < 50 ms added, byte-identical undo, pass-through after uninstall.
- **C. SubagentStart context:** a canary rule reaches built-in, custom and plugin helpers. Pass decides the claim in
  section 10.
- **D. Headless detection [owner, 2026-11-03 review]:** can a hook tell interactive from non-interactive
  (`claude -p`, CI, Agent SDK) reliably? Pass/fail. Pass → v0.1.1 may add the show-and-wait guard, skipped in
  non-interactive runs; fail → show-and-wait stays instructed (section 8).

Order [owner, 2026-11-03 review]: design fixes (headless guard, hidden folder, PostToolUse matcher + timeouts) →
v0.1 cut with the cut list → spikes A–C + D → build. Any spike result that contradicts a reviewed decision goes into
section 16 and wins.

Builder checks (small, during build): B1 does a plugin skill named `resume` clash with the built-in `/resume`; B2 is
`systemMessage` shown on SessionStart; B3 todo/task tool names in the current version; B4 UserPromptSubmit does not
fire for subagent prompts; B5 `ask` behaviour in auto mode and `-p`; B7 the PostToolUse matcher sees every write
path the handoff needs (B6 dropped: no Stop block in v0.1).

---

## 15. Build order (~1 week, real build) [builder]
1. Spikes A–C + D and builder checks (1 day); update this doc and section 16.
2. README block list + trigger list final (they are the contract).
3. `forge.js` dispatcher, log, redaction, rotation (1 day).
4. Block list (Bash / Git Bash forms) + rules.md + typed confirmation (1 day).
5. Handoff + save triggers + resume flow (instructed) + notes reminder + grounding rule + skills (1½ days).
6. Status-line wrapper + installer + usage bands (1 day).
7. Resume test on 3 platforms (cold machine), headless test, hook-fire test, demo GIF (1 day).

Not in this week (cut list, spec section 7): PowerShell forms and the hook-enforced guard (v0.1.1), the 10-minute
trigger (dropped), the Stop-block notes nudge (removed). SubagentStart rule injection only if spike C passes.

---

## 16. Deviations from review

Spike results override review decisions [owner, 2026-11-03 review]. Each entry: the reviewed decision, what the spike
(or verified docs) showed, the evidence, the reason, and which decision text was updated.

| # | Reviewed decision | Spike result and evidence | Reason | Decision updated |
|---|---|---|---|---|
| 1 | Notes reminder at compaction (5.3): route via `notes_due` → SessionStart `compact` if spike A confirms PreCompact cannot inject | Spike A, 2026-11-19: PreCompact `hookSpecificOutput.additionalContext` fails validation with a **visible error** at `/compact`, and the rejected JSON leaks into the conversation; SessionStart `compact` fired and its context reached Claude | Docs confirmed; any PreCompact stdout is harmful | 5.3: route confirmed. New rule: **the PreCompact hook prints nothing** (state file only) |
| 2 | Usage figures < 2 min old at ≥ 95 % of hook calls (spike A pass bar) | Spike A, 2026-11-19, Windows, no `refreshInterval`: 14/17 = 82 %; all stale calls were the first hook after an idle gap | Owner 2026-11-19: add a 30 s timer. **Re-test passed** (7/7 fresh, oldest 26 s) | 7.1: installer sets `refreshInterval: 30` when none |
| 3 | Wrapper adds < 50 ms p95 (spike B pass bar) | Spike B, 2026-11-19, Windows: median ~95–108 ms, p95 ~115–240 ms (one Node start + one shell spawn) | Owner 2026-11-19: accept on Windows; off the tool path | 7.1: accepted on Windows |
| 4 | Context % may be null right after `/compact` (section 2) | Spike A: it was **0**, not null | Treat 0 and null alike right after compaction (both below every band) | 7.2: bands unaffected; note only |
| 5 | Headless detection undocumented (spike D) | Spike D, Windows CLI: `CLAUDE_CODE_SESSION_ATTENDED` = 1 in an interactive hook, 0 under `claude -p` | Owner 2026-11-19 accepts the undocumented signal, re-checked each release; missing or ≠ 1 → no guard | Section 8: v0.1.1 guard may use it once IDE/desktop/CI/SDK/macOS/Linux rows pass |
| 6 | Job tracking pairs SubagentStart/SubagentStop (5.1) | Live session: SubagentStop fired 3× with no SubagentStart (internal helpers) | Unpaired stops would corrupt "Still running" | 5.1: ignore a SubagentStop with no matching start; take shells from Stop `background_tasks` |
