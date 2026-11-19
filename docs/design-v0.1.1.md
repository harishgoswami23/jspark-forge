# JSPARK Forge v0.1.1: design

Status: draft for review, 2026-11-19. Scope: the v0.1.1 pieces still to build. Already built on `dev/v0.1.1`:
PowerShell / cmd forms of the block list and save triggers; the Node-missing warning. Whole-product spec:
[`spec.md`](spec.md); v0.1 design: [`design-v0.1.md`](design-v0.1.md).

---

## 1. Hard "wait for your reply" guard (show and wait, enforced)

### 1.1 Why

v0.1 shows the handoff at session start and *instructs* Claude to wait for the user's "Continue?" (design-v0.1
section 8). Instructions can be ignored; spec principle 5 says "Never act after a cutoff without the user". v0.1.1 makes
it a hook rule, as planned in design-v0.1 section 8 and spike D, now that spike D found a signal.

### 1.2 The signal (spike D, docs/spikes.md)

Hook processes see `CLAUDE_CODE_SESSION_ATTENDED`: `1` in an interactive terminal session, `0` under `claude -p`
(scripts, CI). Undocumented; owner accepted the risk on 2026-11-19, re-checked each release. Rule: **the guard arms only
when the value is exactly `1`**. Missing, `0`, or anything else: no guard (fail open). IDE, desktop and Agent SDK rows of
spike D are not measured yet; until they are, those surfaces get the guard only if they also report `1`.

### 1.3 Behaviour

1. **Arm.** SessionStart with source `startup`, `resume` or `clear`, when `resumeContext` shows an open handoff
   younger than 14 days (the same condition that sends the "last time you were on …" message), and the session is
   attended: set `awaitingUser = { since: <epoch ms> }` in `state/session-<id>.json`. Log `GUARD armed`.
   Not on `compact` (compaction is not a cutoff), not when no handoff is shown, not for an old (>= 14 days) handoff.
2. **Hold.** PreToolUse, for this session (helpers included: they share the session id), while `awaitingUser` is set:
   deny `Edit`, `Write`, `NotebookEdit`, `Bash`, `PowerShell` and `mcp__*` calls with:
   *"JSPARK Forge: the user has not answered "Continue?" yet. Show the summary of where the work was and wait for
   their reply. Do not change files or run commands until they answer."* No CONFIRM offer. Log `GUARD hold <tool>`.
   Read, Grep and Glob are not in the PreToolUse matcher, so look-ups stay possible.
3. **Release.** The next UserPromptSubmit in that session, whatever it says ("continue", a new task, a question), clears
   `awaitingUser`. Log `GUARD released`. A user's first prompt given on the command line (`claude "do X"`) arrives as a
   UserPromptSubmit too, so it releases at once.
4. **Safety valve.** The guard also releases by itself after 30 minutes, so a missed UserPromptSubmit can never freeze a
   session for good. (Open question Q-G2.)
5. **Off switch.** `.jspark-forge/rules.md` `## Settings` line `- wait-guard: off`.

### 1.4 What stays as in v0.1

The systemMessage and the additionalContext instruction ("in your first reply show this … ending with 'Continue?' …
If their first message is a new task, say in one line what was in progress (parked) and then do the new task") are
unchanged; the guard only makes the "do not change files or run commands" part hard.

### 1.5 Tests (planned)

- Arms only with `CLAUDE_CODE_SESSION_ATTENDED=1`, an open handoff < 14 days, and source startup/resume/clear.
- Not armed: attended `0` or missing; `compact`; no handoff; old handoff; `wait-guard: off`.
- While armed: Edit, Write, NotebookEdit, Bash, PowerShell, an MCP tool are denied, also from a helper (`agent_id`);
  the deny reason has no CONFIRM offer. After one UserPromptSubmit, the same calls pass.
- Another session's guard does not affect this session.
- Expiry: a guard older than 30 minutes no longer denies.
- Headless (integration): `claude -p` with an open handoff still completes its task (the v0.1 headless test).
- Interactive (manual): reopen after a cutoff, ask Claude to edit a file before answering: denied; answer: allowed.

### 1.6 Open questions for review

- **Q-G1** Should read-only shell commands (`git status`, `git log`, `git diff`, `ls`, `cat`) be allowed while the guard
  holds, so Claude can check the repo before summarising? The handoff already holds branch, HEAD and uncommitted count.
- **Q-G2** Is a 30-minute self-release right, or should the guard hold until the user speaks, however long?
- **Q-G3** Anything in Claude Code's behaviour that would make the guard fire when it should not, or never release?
