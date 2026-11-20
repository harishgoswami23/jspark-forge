# JSPARK Forge v0.4: design

Status: draft for review, 2026-11-20. Scope: spec 5.10 (build graph). The owner asked to keep building past v0.3
(2026-11-20). Earlier designs: [`design-v0.3.md`](design-v0.3.md) and before.

---

## 1. The idea in one paragraph

A build is written down once as a graph file: its steps, what each hands to the next, which run side by side, and
where a person must act. **Claude runs it** (a plugin cannot start helpers by itself): the `/jspark-forge:build` skill
asks JSPARK Forge for the next step, dispatches the named helper (v0.2 model map), and reports the result back.
**JSPARK Forge holds the state and enforces the rules mechanically** (principle 12): it validates the graph before the
run, saves after every step, runs gates as commands with exit codes, refuses outputs that were not declared, caps
parallel steps, and completes a person's step only on the person's own typed `DONE <step>`. After a crash, a usage
limit or a new session, the handoff and `/jspark-forge:resume` land on the running step.

## 2. The graph file

`.jspark-forge/graphs/<name>.md`, committed (versioned and reviewed like code; spec 5.10 named `forge/graphs/`, see
section 8). One step per heading; fields as list items:

```markdown
# Graph: ship-feature
- max_parallel: 2
- min_free_memory_mb: 1500

## spec (agent)
- helper: planner
- brief: .jspark-forge/briefs/spec.md
- gives: spec_path

## plan (agent)
- helper: planner
- needs: spec_path
- gives: plan_path

## build-api (agent)
- helper: builder
- needs: plan_path
- gives: commit, test_totals
- estimate: 40k tokens, 15 min

## build-ui (agent)
- helper: builder
- needs: plan_path
- gives: ui_commit

## build (parallel)
- steps: build-api, build-ui

## checks (gate)
- after: build
- run: npm test
- run: npm run lint

## merge (human)
- after: checks
- say: Review the branch and merge it into main.
```

- **Kinds:** `agent` (one helper: `helper` is one of the four v0.2 helpers or another named agent; optional `model`
  overrides the helper's tier for this step; optional `brief`), `parallel` (`steps:` run side by side), `gate`
  (`run:` lines, each a command; all must exit 0), `human` (`say:` one plain instruction). `save` is not a kind: the
  runner saves after every step (spec 5.10).
- **Order:** a step runs after the steps named in `after:` and after every step that gives a field it `needs:`. Steps
  inside a `parallel` run after the `parallel`'s own `after:`. No cycles.
- **Fields:** `gives:` and `needs:` are comma lists of names (`[a-z][a-z0-9_]*`). Every `needs` field must be given by
  a step that runs before it; a field given twice is an error. Outputs are values (short strings, paths, numbers), at
  most 500 characters each; free-text reports stay in the helper's reply and the handoff, never parsed (spec 5.10).
- **Validation before any run** (`forge.js graph check <name>`, also part of `forge.js lint`): unknown kind, unknown
  helper, a `needs` nobody gives, a cycle, a `parallel` naming a missing step, a `gate` without `run:`, a `human`
  without `say:`. Errors name the file and line. A graph that fails never starts.
- **Trust:** a graph file arrives with git like `decisions.md`. Its `run:` lines are commands that JSPARK Forge would
  execute, so: graphs are off in guest repos; a graph that arrived with git (not written on this machine, tracked like
  decisions' "arrived with git") is shown to the user and **does not run until the user types `TRUST GRAPH <name>`**
  once; gate commands still pass through the block list (a gate cannot run `rm -rf ~`). Step text reaching Claude is
  cleaned and framed as data.

## 3. Running

- **`forge.js graph start <name>`** validates, records the run in `state/graph-<name>.json` (`{ run, steps: { id:
  { state: waiting|running|done|failed|skipped, outputs, startedAt, doneAt, tokens, retries } }, asOf }`), and prints
  the first steps.
- **`forge.js graph next <name>`** prints the steps that can start now, each with everything the helper needs: the
  helper name, the model, the brief path, the input values (from earlier outputs), the fields it must return, and the
  line to report back. **Parallel cap:** at most `max_parallel` at once, fewer when free memory is under
  `min_free_memory_mb` or plan usage is at 80 % or more (the usage bridge); never more (spec 5.10). A `human` step is
  printed as an instruction to show the user and stop.
- **`forge.js graph done <name> <step> --from <file.json>`** records an agent step's outputs: only declared fields,
  all of them, each within its limit; anything else is refused and the step stays running. A step is done on its first
  report; a second report is logged, not re-run (spec 5.10).
- **`forge.js graph fail <name> <step> "<reason>"`**: a failed step is retried once (spec: "retry a failed node once,
  then stop and show"), then the run stops and shows the step and reason.
- **Gates run in JSPARK Forge**, not in Claude: `forge.js graph next` runs a ready gate's commands itself (through the
  block list; each with a time limit, default 10 minutes), records exit codes and the last 20 lines of output, and
  either marks it done or stops the run naming the failing command. No judgement involved.
- **Human steps** complete only through the person: UserPromptSubmit sees the user's own message `DONE <step>` (the
  whole message, like CONFIRM) and marks it done. Claude, helpers and `forge.js` cannot mark a human step done.
- **Saves:** every state change writes the graph state and the handoff (spec 5.1); the handoff's Task/Step line becomes
  "Build graph ship-feature: step 4 of 7 (build-api, running)".
- **Resume:** session start shows the running graph (`build-api running; build-ui done; next: checks`) and the
  show-and-wait rule applies; `/jspark-forge:resume` shows the graph with the current step marked.
- **Cost:** before the run, `graph start` prints per step the estimate (the graph's `estimate:` or the actuals of the
  last run of the same step), always marked "estimate"; after each agent step the actual tokens and minutes, taken
  from the helper's hand-back (PostToolUse on the Agent tool reports usage when Claude Code gives it), else "not
  reported".

## 4. The skill: `/jspark-forge:build <name>`

The loop Claude follows: `graph start` (or continue) → `graph next` → for each agent step, dispatch the named helper
with its brief and inputs (up to the cap, in parallel) → write the helper's declared outputs to a file → `graph done`
→ repeat; for a human step, show the instruction and stop; when a gate fails, show the command and stop. It never adds
steps, never skips a human step, never marks one done.

## 5. Templates (spec 5.10)

`templates/graphs/`: `software.md` (spec, plan, tasks, gate, release), `documents.md` (research, draft, review,
publish), `spike.md` (measure, decide, build). Generic, no company words; each passes `graph check`.
`/jspark-forge:new-graph <template> <name>` copies one into `.jspark-forge/graphs/` without overwriting.

## 6. Limits

One graph runs at a time per repo (spec 5.10). No conditional edges beyond a gate's pass or fail. The parallel cap
counts steps JSPARK Forge handed out; it cannot see helpers Claude starts on its own. Usage per step is reported only
when Claude Code includes it in the hand-back.

## 7. Tests

- Parser and validation: every error kind with file and line; the three templates pass.
- Running: order from `after` and fields; outputs refused when undeclared, missing or too long; a repeated report
  ignored; retry once then stop; one graph at a time.
- Parallel: never more than `max_parallel`; fewer under low memory or 80 % usage (both faked in tests).
- Gates: commands run with exit codes, the failing one named, output tail kept; a blocked command refused; a time limit.
- Human steps: only the user's own `DONE <step>` completes them (not a tool call, not text inside a longer message).
- Trust: guest repos off; a graph from git waits for `TRUST GRAPH <name>`.
- Kill and resume: a killed session resumes on the running step (state on disk, handoff line, session-start summary).
- Integration (real Claude): the `spike` template runs end to end on a tiny repo with the checker helper and a gate.

## 8. Deviations from spec 5.10

| Spec | This design | Why |
|---|---|---|
| `forge/graphs/<name>.md`, `forge/graph-state.json` | `.jspark-forge/graphs/<name>.md`, `.jspark-forge/state/graph-<name>.json` | One JSPARK Forge folder per project |
| "A runner that uses the platform's own workflow facility when present" | Claude runs the loop through the skill; JSPARK Forge holds state | Claude Code's workflow tool needs the user's opt-in each time; the graph file stays the same either way, so a workflow runner can be added later |
| `save` as a node kind | Automatic after every step | The spec says it is automatic anyway |
| Added | `TRUST GRAPH <name>`, `DONE <step>`, gates run by JSPARK Forge | A graph's commands are code that runs on the user's machine |
