# JSPARK Forge v0.7: better gates

Status: built (owner's yes, 2026-11-22). Builds on design-v0.4 (build graphs) and v0.5.2 (`graph gate`).

## Why

A Claude session that ran a build graph in another of the owner's projects named where the hours went: the full
end-to-end run. It died late for reasons that could have been checked first (memory, a container), its results had to
be read out of long logs, one failing test meant the whole suite again, a test that failed once and passed the next
time looked the same as a broken one, and nobody could say how far a background run had got.

## What changes, in one table

| # | Need | What v0.7 does |
|---|---|---|
| 1 | Do not fail 20 minutes in | `before:` lines on a gate, checked before it starts |
| 2 | Compare runs without reading logs | Every run of a gate command is recorded: counts and failing test names |
| 3 | Do not repeat the whole suite for one failure | `retry:` line: only what failed runs again, then one full clean run |
| 4 | Flaky is not broken, and not fixed either | A test that failed, then passed with no change to the code, is listed as flaky |
| 5 | "How far is it?" | `graph status` reads the run's log: "31 of 63 tests done, 0 failed" |
| 6 | See an expensive step in time | `graph next` prints time and tokens so far, each time |

## 1. The graph file: two new lines, on gate steps only

```
## e2e (gate)
- before: free memory 4 GB
- before: port 5432 open
- before: port 3000 free
- before: container app-db running
- run: npx playwright test
- retry: npx playwright test --last-failed
```

- **`before:`** (any number). Fixed forms only: `free memory <n> GB|MB`, `port <n> open|free`,
  `container <name> running`. No commands: nothing from the file is run. A line in another form is an error at
  `graph check`. (v0.4 cut a graph-wide `min_free_memory_mb`; this is the same need, placed where it bites: on the
  step that needs the memory. The graph-wide line stays unsupported.)
- **`retry:`** (at most one). A command of the project's own test runner that runs again only what failed last time.
  Same rules as `run:` (one simple command). Allowed only on a gate with exactly one `run:` line, so "what failed"
  has one meaning. It is a command, so it is part of what `TRUST GRAPH` shows and covers.
- A graph without these lines behaves exactly as before.

## 2. Pre-flight

- Checked when `graph next` is about to hand the gate out, and again when `graph gate` starts.
- Not met: the gate is **not started** and nothing fails. The output says what is missing in plain words
  ("free memory is 2.1 GB, needs 4 GB") and to run `graph next` again when it is fixed.
- A check that cannot be made (Docker does not answer) counts as not met, and says so.
- The checks run before the run's record is locked: they can take seconds.
- Not checked for a command Claude runs by hand with the Bash tool after the gate was handed out (the hand-out
  itself was checked).

## 3. Runs are recorded

- `graph gate` sends each command's output to a log file, `.jspark-forge/state/gatelog-<graph>-<step>-<n>.log`,
  instead of the screen, and prints a summary and the last lines when the command ends. The last 5 logs of a step
  are kept.
- After each command the log is read by `gate-results.js`, which knows the output of node:test, TAP, jest, vitest,
  pytest, Playwright, mocha and go test. Recorded per run: which command, full or retry, when, how long, exit code,
  passed / failed / skipped / not run, and up to 50 failing test names. An unknown format records the exit code only.
- A gate command Claude runs with the Bash tool is recorded too, from the output the tool reports (it may be cut
  short by the tool; the exit code is still the truth).
- The exit code decides pass or fail. Counts and names are for people; they never turn a failure into a pass.
- `graph status` lists a gate's runs, so run 3 and run 4 can be compared.

## 4. Retry only what failed, then one full clean run

For a gate with a `retry:` line:

1. The full command fails → the gate is not failed yet. It now needs the retry command.
2. The retry command fails → the gate fails (broken). The run stops, as today.
3. The retry command passes → the gate now needs the **full command once more**.
4. That full run passes → the gate is done. It fails → the gate fails.

One retry round per hand-out. `graph rerun` gives a new round. Without a `retry:` line a failing command fails the
gate at once, as today.

## 5. Flaky versus broken

- When a full run passes after an earlier full run of the same hand-out or an earlier hand-out failed, and the
  code did not change in between (same commit, same uncommitted changes, same untracked files that git does not
  ignore, by size and time written; JSPARK Forge's own folder left out), the tests that failed earlier are recorded
  as **flaky**. Files git ignores are not seen. A run without an exit code (a timeout) is not a test failure.
- If the code changed in between, they are not called flaky: they may have been fixed.
- Flaky tests are named every time: in the "passed" message, in `graph status`, and when the graph finishes. The
  message says a flaky test is not a fixed test.
- A gate is never done on a retry alone: only a full run that passes completes it (section 4).
- When the failing names could not be read, the message says the command failed and then passed unchanged, without
  names.

## 6. Progress and cost

- `graph status` on a gate that `graph gate` is running reads the log so far: "31 of 63 tests done, 0 failed"
  (or "31 tests done" when the runner does not announce a total).
- `graph next` ends with one line each time: steps done, minutes and tokens so far, and the last finished step's
  own figures. Gates now record their minutes too. Tokens are known for helper steps only (as before).

## 7. What is enforced, and what is not

- Enforced by the program: the pre-flight before a hand-out; the order full → retry → full; that only a passing
  full run completes a gate; that flaky names are stored and printed.
- Not enforced: that a `retry:` command really runs only the failed tests (it is the project's command; the final
  full run is what makes the result safe either way).
- Counts depend on recognising the runner's output; an unrecognised runner loses the counts, never the verdict.

## 8. Review (2026-11-22)

An independent review found no path to a gate that is done without a passing full run. It found, and these were
fixed with tests: the pre-flight was skipped for a gate that waits for a parallel step; a fix in an untracked file was
called flaky; two patterns in the output reader were slow on hostile lines and ran while the record was locked (the
output is now read before the lock); a timeout was counted as a test failure for the flaky list; free memory on
macOS and older Linux left out memory the system gives back on demand; a port open only on `::1` read as free; an
older log could be read as the result of a run that wrote none.

## 9. Tests

`tests/gate-results.test.js` (each format: green, failures, cut off), `tests/preflight.test.js` (forms, wordings,
hostile names, real port probe), `tests/v07.test.js` (graph file lines; pre-flight holds a gate back; runs recorded
and compared; retry order; flaky only when unchanged; progress; cost line; old graphs unchanged).
