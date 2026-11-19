# JSPARK Forge v0.4: design

Status: **revision 2, 2026-11-20**, after the Fable 5.2 design review (findings cited [R-H1] and so on). Scope: spec
5.10 (build graph). The owner asked to keep building past v0.3 (2026-11-20). Earlier designs:
[`design-v0.3.md`](design-v0.3.md) and before. **Build order:** spikes I, J, K first (section 0).

---

## 0. Spikes before code

- **Spike I [R-H2]:** does a Bash / PowerShell command that exits non-zero reach PostToolUseFailure (and a zero exit
  PostToolUse) with the exact command text, on Windows (here) and in CI? Decides whether gates run through Claude's
  own tools (preferred) or not at all in v0.4.
- **Spike J [R-M4]:** what PostToolUse on the Agent tool and SubagentStart / SubagentStop carry: the helper type, a
  marker from the call's `description`, duration, usage, foreground vs background. Decides what evidence ties a report
  to a helper and whether token actuals exist.
- **Spike K:** is `CLAUDE_CODE_SESSION_ID` set for commands Claude runs through Bash, so `forge.js graph …` knows the
  session.

**Results (Windows, real `claude -p` with the probe plugin, 2026-11-20): all three pass.**
- **I:** `node -e "process.exit(3)"` arrived at PostToolUseFailure with the exact command and `error: "Exit code 3"`;
  `echo gate-ok` arrived at PostToolUse with its stdout. Gates run through Claude's own tools.
- **J:** PreToolUse on Agent carries the call's `description` ("STEPMARK-42 tiny check"), so the build skill puts
  `[graph <name>/<step>]` there; SubagentStart / SubagentStop carry `agent_id` and `agent_type`; PostToolUse on Agent
  (foreground) carries `agentType`, `resolvedModel`, `totalDurationMs`, `totalTokens` and `usage`. **So token actuals
  per step are available** for foreground helpers; background helpers are reported "not reported" until checked.
- **K:** commands run through Bash see `CLAUDE_CODE_SESSION_ID` (the session's id).

## 1. The idea, and what is actually enforced [R-H1]

A build is written once as a graph file. **Claude runs it** through `/jspark-forge:build` (a plugin cannot start
helpers itself): it asks JSPARK Forge for the next step, dispatches the named helper, and reports back. **JSPARK Forge
keeps the record and checks what it can check.** It cannot control which tools Claude uses, so the honest split is:

| Rule | How |
|---|---|
| The graph is valid before it runs (fields, order, no cycles) | **Enforced** (`graph check`, refuses to start) |
| State and trust files cannot be written by Claude or a helper | **Enforced** (block-list hard deny on `.jspark-forge/state/graph-*` for Edit / Write / shell writes) |
| A step is reported done only while it is running, of kind agent, with exactly its declared outputs | **Enforced** (`graph done` refuses otherwise) |
| Outputs are real: a `*_path` exists, a `commit` resolves | **Enforced** (checked on `done`) |
| A helper of the named type actually ran for that step | **Evidence** (SubagentStart of that type since the step was handed out; spike J) |
| A gate passed | **Enforced from evidence** (the exact command's real exit code, recorded by the hooks; spike I) |
| A human step is done | **Enforced** (only the user's own typed message completes it) |
| Steps run in order; no more helpers than the cap; no work outside the graph | **Instructed** (the skill; JSPARK Forge hands out steps in order and never more than the cap, but cannot stop Claude doing other work) |

## 2. The graph file

`.jspark-forge/graphs/<name>.md`, committed. One step per heading; fields as list items (built: `scripts/lib/graph.js`,
`templates/graphs/`).

- **Kinds:** `agent` (`helper:` one of planner, reviewer, builder, checker: its model is its tier, so one model per
  step as the spec asks; `brief:`; `needs:` / `gives:`), `parallel` (`steps:`), `gate` (`run:` lines), `human`
  (`say:`). `after:` orders steps. Validation before any run, with file and line.
- **Names [R-M2]:** graph names and step ids `[a-z][a-z0-9-]{0,39}`, checked by `graph check` and every CLI command.
- **Gate commands:** one simple command per `run:` line, no shell operators (`;`, `&&`, `|`, `>`, backticks, `$( )`),
  checked by `graph check`; each also passes the block list.
- **Trust [R-H3]:** every graph with a gate needs the user's `TRUST GRAPH <name>` before its first run, and again
  whenever its `run:` lines change (trust is kept per hash of those lines, in a protected state file). JSPARK Forge
  shows the commands when it asks. "Arrived with git" plays no part: a graph Claude wrote is trusted the same way.
  The README says plainly that `npm test` runs whatever the repo's scripts say.
- Off in guest repos; text reaching Claude cleaned and framed as data.

## 3. Running

State: `.jspark-forge/state/graph-<name>.json` (protected), written under a lock [R-H5]:
`{ run, hash (of the graph file), owner (session), startedAt, steps: { id: { state: waiting|running|done|failed|interrupted,
outputs, handedAt, doneAt, retries } } }`.

- **`graph start <name>`:** validates, checks trust, records the graph's hash and the owner session. Only one graph
  runs per repo; a second live start is refused.
- **`graph next <name>`:** prints the steps that can start, each with helper, brief, input values, the fields to
  return and the exact report line. **No side effects beyond marking them handed out.** Cap: at most `max_parallel`;
  nothing at the 95 % plan-usage band; plan windows only (not context), and "usage unknown" is printed and treated as
  under the limit [R-M3]. A gate is printed as the commands Claude must run with its Bash or PowerShell tool, one at a
  time; a human step as the instruction to show, then stop.
- **Gates through Claude's tools [R-H2, spike I]:** PostToolUse / PostToolUseFailure in the main session see the exact
  gate command and its exit status and record pass or fail. Claude Code's permissions, sandbox and other hooks apply as
  for any command; there is no time-limit or process-tree problem of JSPARK Forge's own.
- **`graph done <name> <step> --from <file.json>`** (outputs) and **`graph fail <name> <step> "<reason>"`** (retry once,
  then stop and show). A second report with the same values is ignored; with different values it is refused loudly.
- **The graph file changed mid-run** (hash differs): the run stops and says so; the user restarts it.
- **Interrupted:** a different session finds steps `running` from the owner session → they become `interrupted` and the
  user chooses (rerun, which does not use up the retry, or stop). A second live session on the same run is refused.
- **`graph stop <name>`:** ends the run (state kept for the record).
- **Human steps [R-M1]:** completed only by the user's own message, the whole message being `DONE <step>`, or just
  `done` when exactly one human step waits; only for a step that is waiting now; only in attended sessions
  (`CLAUDE_CODE_SESSION_ATTENDED=1`); answered with a system message; never stored as the handoff's last request.
  `TRUST GRAPH <name>` follows the same rules. A DONE typed in another session completes the step; the looping session
  sees it at its next `graph next`.
- **Saves:** every change saves the handoff; a running graph ranks first for the Task / Step line ("Build graph
  ship-feature: step 4 of 7, build-api running") [R-M5].
- **Resume:** session start shows the run (done / running / interrupted / next); `/jspark-forge:resume` shows it and
  waits.
- **Cost [R-M4]:** minutes per step from `handedAt` to `doneAt` (mechanical); tokens only if spike J shows Claude Code
  reports them, else "not reported". Estimates only from the graph's `estimate:` lines, marked "estimate".

## 4. The skill: `/jspark-forge:build <name>`

Start or continue, take the next steps, dispatch each named helper (up to the cap) with its brief and inputs, write
its declared outputs to a file and report them, run gate commands exactly as printed, show human steps and stop. It
never adds steps, never skips a human step, never writes the state.

## 5. Templates

`templates/graphs/software.md`, `documents.md`, `spike.md` (built; each validates). The build skill copies one into
`.jspark-forge/graphs/` without overwriting (no separate command [R-cut]).

## 6. Cut from this version [R-cut]

Per-step `model` override and "any other named agent" (the four helpers carry the model map); `min_free_memory_mb`
(the plan-usage cap and `max_parallel` remain); token actuals and last-run estimates unless spike J allows; a separate
`new-graph` command; JSPARK Forge running gate commands itself.

## 7. Tests

Validation (built); names; the protected state files (Edit, Write, shell redirect all denied); `done` refused when not
running / wrong kind / missing, extra or too-long fields / a path that does not exist / a commit that does not resolve
/ no helper evidence; locking under parallel reports; interrupted steps on a new session; `stop`; the hash check;
trust per run-line hash; DONE / TRUST rules (whole message, waiting only, attended only, not stored); the cap (95 %,
unknown usage); gate pass / fail from hook events; resume line and handoff rank. Integration (real Claude): the spike
template end to end on a tiny repo (checker helper, a human step completed by a scripted user message, a gate).

## 8. Deviations from spec 5.10 [R-M6]

| Spec | This design | Why |
|---|---|---|
| `forge/graphs/`, `forge/graph-state.json` | `.jspark-forge/graphs/`, `.jspark-forge/state/graph-<name>.json` | One JSPARK Forge folder |
| Runner uses the platform's workflow facility when present | Claude runs the loop through the skill | The workflow tool needs the user's opt-in each time; the graph file is the same either way |
| "Parallel never exceeds the cap" | JSPARK Forge never hands out more than the cap | It cannot see helpers Claude starts itself (stated in section 1) |
| "A helper may choose a path the graph offers" | Not in v0.4 | No conditional edges beyond gate pass / fail (also a spec limit) |
| Estimated tokens and time before, actuals after | Minutes measured; tokens only if reported; estimates from the graph | Token usage per helper is not reliably available (spike J) |
| Three templates run end to end | One runs end to end in integration; all three validate | The other two need real briefs to mean anything |
| A graph view in the dashboard | Not in v0.4 | The dashboard (5.8) is "later, only if asked" |
| `save` as a node kind | Automatic after every change | The spec calls it automatic anyway |
| Added | `TRUST GRAPH`, `DONE <step>`, protected state, `graph stop` | A graph's commands run on the user's machine; runs must be stoppable |

## 9. UI path (spec 5.14 completed, owner 2026-11-20)

The owner asked whether JSPARK Forge delivers world-class UI. Spec 5.14's brand-skill template was missing; added with
a fifth graph template:
- `templates/brand-skill.md`: a fill-in brand skill (colours, typography, spacing, components, voice, and a pre-ship
  check against the running screen); passes the skill lint.
- `templates/graphs/ui.md`: design direction (planner) → the user approves the look (human) → build (builder) → a
  Playwright screenshot gate (`npx playwright test tests/ui`) → design review (reviewer) → final approval (human).
Honest limit, said in the README: this makes a checked path the default; the look is only as good as the approved
direction.
