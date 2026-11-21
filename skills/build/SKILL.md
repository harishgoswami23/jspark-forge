---
name: build
description: Use when the user runs /jspark-forge:build or asks to run, continue or check a build graph (a build written as steps in .jspark-forge/graphs/<name>.md), or to start one from a template.
---
Run a build graph step by step. JSPARK Forge keeps the record and checks it; you do the work it hands out.

1. If the user named no graph, list `.jspark-forge/graphs/*.md`. To start from a template, copy one of
   `${CLAUDE_PLUGIN_ROOT}/templates/graphs/` (software, documents, spike, ui, or planned when the spec and plan are already written) to `.jspark-forge/graphs/<name>.md` with the
   Write tool, never over an existing file, change its first line to `# Graph: <name>` (the title must match the file
   name), and help the user fill in its briefs. After copying a template: (a) set every `run:` line to the project's
   real commands (the template says `npm test` only as a placeholder): look at the `scripts` in package.json and at the
   lock file (package-lock.json, pnpm-lock.yaml, yarn.lock) to pick npm, pnpm or yarn, or use the project's own runner
   (pytest, go test ./..., and so on), and remove the template's comment lines about it once done; (b) say in each build
   brief that the builder commits its work on the current branch (no merge, no push), because the review step needs
   those commits. Then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph check <name>` and fix what it reports.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph start <name>` (or `graph status <name>` to see a run in
   progress). If it asks for `TRUST GRAPH <name>`, show the user the commands it lists and stop: only the user types
   that.
3. Loop: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph next <name>` and do exactly what it prints:
   - **agent step:** use the Agent tool with the subagent_type and the description it gives (keep the
     `[graph <name>/<step>]` marker); pass the brief and the inputs. Several agent steps printed together run side by
     side (dispatch them in one message). Write each helper's declared fields as JSON to the report file it names with the
     Write tool (never through the shell), then run the `graph done` command it prints as a command of its own. If a step fails, run `graph fail` with the reason.
   - **gate step:** run each command with the Bash tool exactly as written, one per call. JSPARK Forge records the
     exit codes; if one fails, the run stops: show the user the command and its output. If a command can take longer
     than 9 minutes (a long end-to-end suite), do not run it directly: one tool call waits 10 minutes at most, and a
     command moved to the background is not recorded. Run
     `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph gate <name> <step>` with the Bash tool in the background
     instead: it runs the gate's commands itself and records their exit codes. When it ends, run `graph next` again.
     A gate can have `before:` lines (free memory, a port, a container). If `graph next` or `graph gate` says the gate
     is "not started" or "was not run" and what is missing, tell the user in plain words and wait: nothing failed, and
     you do not work around it. A gate can have a `retry:` line: when the full command fails, the gate is not failed
     yet: the retry command (only what failed) is next, then the full command once more; `graph gate` does all three
     by itself, and `graph next` names the command when you run them by hand. Never call a gate passed on a retry.
     `graph gate` keeps the output in a log file and prints the counts, the failing tests and, on a failure, the last
     lines: read the log only when those are not enough. When the user asks how far a background gate has got, run
     `graph status <name>` (it says "31 of 63 tests done, 0 failed"); do not read the log for that. When a message
     names flaky tests, tell the user their names: a flaky test is not a fixed test.
   - **human step:** show the user the instruction and stop. Only the user's own message `DONE <step>` completes it.
   - **interrupted / stopped / finished:** show the user and wait.
4. Never add steps, skip a human step, edit `.jspark-forge/state/graph-*` files, or report outputs a helper did not
   give. After the run, show what each step returned and the time and tokens per step from `graph status <name>`.
