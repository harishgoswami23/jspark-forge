---
name: build
description: Use when the user runs /jspark-forge:build or asks to run, continue or check a build graph (a build written as steps in .jspark-forge/graphs/<name>.md), or to start one from a template.
---
Run a build graph step by step. JSPARK Forge keeps the record and checks it; you do the work it hands out.

1. If the user named no graph, list `.jspark-forge/graphs/*.md`. To start from a template, copy one of
   `${CLAUDE_PLUGIN_ROOT}/templates/graphs/` (software, documents, spike, ui) to `.jspark-forge/graphs/<name>.md` with the
   Write tool, never over an existing file, change its first line to `# Graph: <name>` (the title must match the file
   name), and help the user fill in its briefs. Then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph check <name>` and fix what it reports.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph start <name>` (or `graph status <name>` to see a run in
   progress). If it asks for `TRUST GRAPH <name>`, show the user the commands it lists and stop: only the user types
   that.
3. Loop: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" graph next <name>` and do exactly what it prints:
   - **agent step:** use the Agent tool with the subagent_type and the description it gives (keep the
     `[graph <name>/<step>]` marker); pass the brief and the inputs. Several agent steps printed together run side by
     side (dispatch them in one message). Write each helper's declared fields as JSON to the report file it names, then
     run the `graph done` command it prints. If a step fails, run `graph fail` with the reason.
   - **gate step:** run each command with the Bash tool exactly as written, one per call. JSPARK Forge records the
     exit codes; if one fails, the run stops: show the user the command and its output.
   - **human step:** show the user the instruction and stop. Only the user's own message `DONE <step>` completes it.
   - **interrupted / stopped / finished:** show the user and wait.
4. Never add steps, skip a human step, edit `.jspark-forge/state/graph-*` files, or report outputs a helper did not
   give. After the run, show what each step returned and the time and tokens per step from `graph status <name>`.
