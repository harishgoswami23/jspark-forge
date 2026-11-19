# JSPARK Forge: spikes before v0.1 code

Run all four before writing v0.1 code. Each is throw-away code in a scratch folder, not in the plugin. Record the
results at the bottom of each spike and update `design-v0.1.md` and `spec.md` ("Verified facts").

**Before-code order [owner, 2026-11-03 review]:**
1. Fix in the design: headless guard, hidden `.jspark-forge/` folder, PostToolUse matcher and hook timeouts (done in
   `design-v0.1.md`, 2026-11-03 revision).
2. Cut v0.1 to a real one-week build; the cut list is in the spec's release table (spec section 7).
3. Run spikes A–C + D (headless detection).
4. Build.

**Spike results override review decisions [owner, 2026-11-03 review]:** if a spike contradicts a reviewed decision
(e.g. headless detection is impossible from hook input, or the PostToolUse matcher misses a write path we need), the
spike wins: record the deviation, the evidence and the reason in "Deviations from review" (`design-v0.1.md`
section 16), and update the affected decision.

You need: Claude Code (latest), Node ≥ 18, git; one machine each for Windows (with and without Git Bash), macOS,
Linux (a VM is fine); a **Pro or Max** account and an **API-key** account (or Team/Enterprise without a personal
plan) for spike A; a CI runner (e.g. GitHub Actions) for spike D.

---

## Spike A: when usage figures appear and how fresh they are

**Question:** can hooks rely on a file written by the status line for context % and plan quota?

**Setup**
- [ ] Write `probe-statusline.js`: reads stdin JSON; appends one line to `~/forge-spike/statusline.jsonl`:
      `{ts, session_id, context_pct, five_hour_pct, seven_day_pct, five_resets_at, seven_resets_at, has_rate_limits}`;
      prints `probe`.
- [ ] Write `probe-hook.js`: on every hook event appends `{ts, event, session_id}` to `~/forge-spike/hooks.jsonl`.
- [ ] Register the status line in user settings and the hook on `PostToolUse`, `UserPromptSubmit`, `Stop`,
      `PreCompact`, `SessionStart`.

**Steps** (once on the Pro/Max account, once on the API-key account)
- [ ] Start a session; note the time; do **not** type for 60 s. Record whether the status line ran and with which
      fields.
- [ ] Send the first prompt. Record when `rate_limits` and `context_window.used_percentage` first become non-null.
- [ ] Run a 15-minute working task with many tool calls (edits + tests).
- [ ] Run one long single command (e.g. `sleep 180` / a 3-minute test run) and see whether the status line runs
      during it.
- [ ] Run `/compact`; record the fields right after and after the next reply.
- [ ] Have the `PreCompact` probe also return `additionalContext` with a canary; record whether Claude ever sees it
      (the docs say PreCompact cannot inject; this confirms the route in design 5.3).
- [ ] Repeat the working task with `refreshInterval: 30` set.
- [ ] If possible, cross a 5-hour reset (or note `resets_at` behaviour from the docs).

**Measure:** for each hook call, the age of the newest status-line line for the same session.

**Pass**
- [ ] During active work, age < 2 min for ≥ 95 % of hook calls (without `refreshInterval`, or with it: record which).
- [ ] On Pro/Max, `five_hour` and `seven_day` present after the first reply.
- [ ] On the API-key account, `rate_limits` absent and nothing breaks.
- [ ] `context_pct` present after the first reply, `null` right after `/compact`, back after the next reply.

**Fail →** if freshness < 95 % even with `refreshInterval: 30`, keep the 80/95 % rule only as a "best effort" extra,
and README says saves rely on the step triggers. If `rate_limits` never appears for Pro/Max, the plan-limit save is
dropped from v0.1 and README says "context limit only, use `/jspark-forge:handoff` for plan limits". If the PreCompact
canary is never seen, record the notes-reminder route (design 5.3) in "Deviations from review".

**Results:** _fill in: dates, Claude Code version, numbers, decision._

---

## Spike B: status-line wrapper with an existing user command

**Question:** can Forge wrap any existing status line without the user seeing a difference, and undo cleanly?

**Setup**
- [ ] Write `wrapper.js` (reads stdin; writes the usage file; runs the original command with the same stdin;
      prints its output then ` · Forge ok`) and `install.js` / `--undo` (back up `~/.claude/settings.json`, save the
      original `statusLine` object, set the wrapper, restore on undo).
- [ ] Copy the wrapper to `~/.claude/jspark-forge/statusline.js`.

**Test matrix** (each row on Windows+Git Bash, Windows without Git Bash, macOS, Linux)
- [ ] No existing status line.
- [ ] A Bash script `~/.claude/statusline.sh` using `jq`.
- [ ] An inline command with quotes and `//` jq fallbacks.
- [ ] A PowerShell script (`powershell -NoProfile -File C:/…/statusline.ps1`).
- [ ] The wrapper under zsh (macOS default shell; a zsh status-line script) [owner 2026-11-03].
- [ ] An `npx`-based community status line (slow first run).
- [ ] Multi-line output with ANSI colours and an OSC 8 link.
- [ ] Original settings with `padding: 2` and `refreshInterval: 10`.
- [ ] A project-level `.claude/settings.json` that sets its own status line.

**Steps per row**
- [ ] Screenshot/record status line output before install.
- [ ] Install; compare output (must be identical + Forge's suffix).
- [ ] Measure added time per run (100 runs, median and p95).
- [ ] Make the original command fail / hang 5 s: the wrapper still prints Forge's part within 2 s.
- [ ] Undo: `diff` settings.json with the backup.
- [ ] Re-install, then delete the plugin folder (simulate uninstall): status line still shows the original output.

**Pass**
- [ ] Output identical (byte-for-byte before the suffix) in every row.
- [ ] Added time p95 < 50 ms (excluding the original command's own time).
- [ ] Undo is byte-identical (or key removed when there was none).
- [ ] Pass-through works after uninstall.
- [ ] Project-level status line row: behaviour recorded and the installer message is accurate.

**Fail →** if a shell form can't be reproduced faithfully on some platform, the installer refuses to wrap that kind
of command, explains why, and the user keeps their status line (plan-limit saves off for them).

**Results so far (2026-11-19, Windows 11 + Git Bash, Node 24; offline harness `spikes/statusline/test-spike-b.js`, 100 runs per row; never touches the real settings):**
- Output byte-identical + suffix: no status line, Bash script, inline command with quotes and `//`, PowerShell
  `-File` script, multi-line ANSI + OSC 8, `padding`/`refreshInterval` kept: **pass**.
- Original fails → suffix only (157 ms); original hangs 5 s → suffix at 2.1 s (after fixing the wrapper to kill the
  process tree and exit on flush): **pass**.
- Undo byte-identical in every row; settings edited after install → only `statusLine` restored, other edit kept:
  **pass**. Wrapper copy works with the plugin folder gone: **pass**.
- **Added time: fail on Windows.** Median ~95–108 ms, p95 ~115–240 ms vs the < 50 ms target. Cause: one extra Node
  start plus one extra shell spawn per refresh on Windows. Options for the owner: accept ~100 ms on Windows (the
  status line is debounced and off the tool path), or ship the wrapper as a shell script on Windows. Decide before
  step 6 of the build.
- Test note: a PowerShell `-File` status line needs `-ExecutionPolicy Bypass` on default Windows (it fails without
  the wrapper too).
- Still to run: live session (the shell Claude Code really uses; project-level status line; npx line), Windows without
  Git Bash, macOS (zsh), Linux.

---

## Spike C: SubagentStart context reaching helpers

**Question:** does text returned by a `SubagentStart` hook land in the helper's context, for every kind of helper?
Do PreToolUse blocks fire inside them?

**Setup**
- [ ] Hook `SubagentStart` (no matcher) returns
      `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": "FORGE-CANARY-7731: always end your final report with the line CANARY-7731-SEEN."}}`.
- [ ] Hook `PreToolUse` (Bash|PowerShell) denies any command containing `FORGE_BLOCK_TEST`.
- [ ] A custom project agent `.claude/agents/tester.md`, and a tiny test plugin with one agent `canary-plugin:helper`.

**Steps** (each helper type, 3 runs each)
- [ ] `general-purpose`: "Use a helper to list the files here."
- [ ] `Explore` (starts without CLAUDE.md).
- [ ] `Plan`.
- [ ] Custom agent `tester`.
- [ ] Plugin agent `canary-plugin:helper`.
- [ ] A forked helper, if the version supports forks.
- [ ] In each, ask the helper to run `echo FORGE_BLOCK_TEST`.

**Check:** the helper's final report ends with `CANARY-7731-SEEN`, and/or the helper transcript
(`agent_transcript_path` / subagent transcript file) contains the canary text; the echo was denied.

**Pass**
- [ ] Canary seen in 3/3 runs for every built-in type and the custom and plugin agents → v0.1 may claim "rules reach
      every helper".
- [ ] Block fired in every helper → "safety blocks still fire inside helpers" (expected from the docs).

**Partial →** claim only the helper types that passed, by name. **Fail →** do not ship SubagentStart rule
injection; README says only "safety blocks still fire inside helpers".

**Results (2026-11-19, Windows 11, Claude Code 2.1.328, `claude -p`, model haiku, probe plugin `spikes/probe-plugin` loaded with `--plugin-dir`; runner `spikes/run-spike-c.sh`, analyzer `spikes/analyze-spike-c.js`):**
- 6 helper types × 3 runs = 18/18: SubagentStart fired with the right `agent_type`; the canary was in every helper
  transcript; every helper ended its report with `CANARY-7731-SEEN`; `echo FORGE_BLOCK_TEST` was denied inside every
  helper (1/1 each). Types: `general-purpose`, `Explore`, `Plan`, custom project agent `tester`, plugin agent
  `forge-probe:helper`, `fork`.
- **Windows: pass.** macOS and Linux rows and an interactive-session row still to run before the claim ships.

---

## Spike D: headless detection [owner, 2026-11-03 review]

**Question:** can a Forge hook tell, reliably and from what Claude Code gives it, that the session is
**non-interactive** (`claude -p` in a script or CI, or the Agent SDK), so a show-and-wait guard can skip itself
there? Result is **pass/fail**.

**Why:** SessionStart `startup` fires for `claude -p` too. A PreToolUse deny-until-reply guard would then deny the
run's own work and stall CI. Until this spike passes, show-and-wait is instructed only (Q8, design section 8).

**What the docs say (hooks.md, checked 2026-11-03):** common hook input is `session_id`, `prompt_id`,
`transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode` (`default`, `plan`, `acceptEdits`, `auto`, `dontAsk`,
`bypassPermissions`; not on every event), `effort`, `hook_event_name`; SessionStart adds `source`, `model`,
`agent_type`, `session_title`. **No field marks interactive vs headless**, and `permission_mode` takes the same values
in both. `-p` appears only as a condition on behaviour (`defer` is honoured only with `-p`; `initialUserMessage` only
with `-p`). `$CLAUDE_CODE_REMOTE` is `"true"` only in remote web sessions. So detection has to come from something
the docs do not promise; this spike measures whether any candidate is reliable.

**Candidates to record (all undocumented unless noted)**
- [ ] Every field of the SessionStart and PreToolUse input JSON (diff interactive vs `-p`).
- [ ] Environment variables the hook process receives (full dump, secrets masked), especially any entrypoint
      variable such as `CLAUDE_CODE_ENTRYPOINT`, and `CI`.
- [ ] The parent process command line (does it contain `-p` / `--print`?), via `/proc/<ppid>/cmdline` on Linux,
      `ps -o args= -p <ppid>` on macOS, a WMI/CIM process query on Windows.
- [ ] Whether the hook's stdout/stderr or the Claude Code process has a TTY (expected: unhelpful, the hook's stdin is
      the JSON pipe).

**Matrix** (each on Windows, macOS, Linux; 3 runs each)
- [ ] Interactive terminal session.
- [ ] VS Code / JetBrains extension session.
- [ ] Desktop app session, if available.
- [ ] `claude -p "<prompt>"` from a local script.
- [ ] `claude -p` with `--continue` / `--resume`.
- [ ] `claude -p` in a CI runner (GitHub Actions).
- [ ] Agent SDK session.

**Pass** (all must hold)
- [ ] One signal (or a simple rule over several) classifies every row correctly in 3/3 runs on all 3 platforms.
- [ ] The rule's default when the signal is missing is "non-interactive" (skip the guard: never block when unsure).
- [ ] If the signal is undocumented, the owner accepts the risk in writing, and the facts table marks it "re-check
      each release".

**Pass →** v0.1.1 adds the hook-enforced guard (PreToolUse denies Edit/Write/Bash/PowerShell for the old task until
the user's first reply), skipped in non-interactive runs. **Fail →** show-and-wait stays instructed only; README
claims only that JSPARK Forge "asks before continuing"; record the evidence in "Deviations from review" if it
contradicts a reviewed decision.

**Results so far (2026-11-19, Windows 11, Claude Code 2.1.328):**
- `claude -p` (hook env): `CLAUDE_CODE_ENTRYPOINT=sdk-cli`, `CLAUDE_CODE_SESSION_ATTENDED=0`; parent process command
  line contains `-p`. The hook stdin/stdout are not TTYs (as expected). SessionStart input in `-p` had only
  `session_id, transcript_path, cwd, hook_event_name, source` (no `model`, `agent_type`, `permission_mode`).
- Interactive CLI session (this session's own Bash env, not yet a hook env): `CLAUDE_CODE_ENTRYPOINT=cli`,
  `CLAUDE_CODE_SESSION_ATTENDED=1`. The `-p` child did not inherit the parent's values.
- **Candidate rule:** interactive only if `CLAUDE_CODE_SESSION_ATTENDED=1`; anything else (0, missing) = skip the guard.
  Both variables are **undocumented** → owner sign-off and "re-check each release" needed.
- Still to run: a hook inside an interactive session (owner runs one), IDE, desktop, CI, Agent SDK, macOS, Linux.

---

## Builder checks (small, during the build)

- [ ] **B1** Plugin skill `resume`: is it reachable as `/resume`, or only as `/jspark-forge:resume`? Does the
      built-in `/resume` win? (Q1 is decided; this only confirms the README wording.)
- [ ] **B2** Is a `systemMessage` returned from `SessionStart` shown to the user at startup? Does
      `initialUserMessage` exist and make Claude reply first?
- [ ] **B3** Which todo/task tools and events exist in the current version (`TodoWrite`, `TaskCreate`/`TaskUpdate`,
      `TaskCreated`/`TaskCompleted`), and what their inputs look like.
- [ ] **B4** UserPromptSubmit does not fire for prompts given to helpers (so a helper can't create a CONFIRM token).
- [ ] **B5** What `permissionDecision: "ask"` does in auto mode, in `-p` mode and inside a helper.
- [ ] **B6** Dropped: no Stop block in v0.1 (Q5 decided), so `stop_hook_active` handling is not needed.
- [ ] **B7** The PostToolUse matcher (`Edit|Write|NotebookEdit|Bash|PowerShell|TodoWrite|TaskCreate|TaskUpdate|Agent|mcp__.*`)
      sees every write path the handoff needs (incl. the todo/task tool names from B3). A missed path is a deviation
      (design section 16).
- **Found 2026-11-19:** `claude plugin validate --strict` fails without a plugin icon (square PNG, 512–2048 px) → the
  real plugin needs one for the ship gate. Stop input carries `background_tasks` (candidate source for "Still running").
