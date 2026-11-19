# JSPARK Forge v0.1.1: design

Status: draft for review, 2026-11-19. Scope: the v0.1.1 pieces still to build. Already built on `dev/v0.1.1`:
PowerShell / cmd forms of the block list and save triggers; the Node-missing warning. Whole-product spec:
[`spec.md`](spec.md); v0.1 design: [`design-v0.1.md`](design-v0.1.md).

---

## 1. Hard "wait for your reply" guard (show and wait, enforced)

> **Decision 2026-11-19 [owner]: not built.** An independent design review (Fable 5.2, read-only, against the code)
> found that the guard releases before the turn it is meant to guard: in an interactive session Claude takes no turn
> until the user submits a prompt, and that prompt is the release (1.3.3). It would only hold turns that start without a
> prompt, and none is known to occur. Secondary findings: a read-modify-write race on the session state could leave it
> stuck; a slash-command first input might not release it; the `wait-guard` setting was not wired into `rules.js`; and
> spike D's own gate (IDE, desktop, SDK, macOS and Linux rows) was not yet met.
> **What stays:** show and wait is *instructed* (design-v0.1 section 8). Claude followed it in every live test (the
> kill-and-resume ship gate, the owner's manual check, the headless test).
> **Fallback if a user reports Claude acting before answering:** "first reply is look-only": after a cutoff, the whole
> first turn may only read and talk, whatever the first prompt says; the arm is released at Stop of that turn, so
> changes start with the user's second message. Cost: one extra message when the user opens with a new task. Keep the
> review's build notes: guard state in its own file (`state/await-<sid>.json`), check it before the CONFIRM token is
> consumed, arm only when `CLAUDE_CODE_ENTRYPOINT=cli` and `CLAUDE_CODE_SESSION_ATTENDED=1` until the other surfaces are
> measured, and wire the off switch into the settings whitelist.
>
> The rest of this section is the reviewed draft, kept for the record.

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
