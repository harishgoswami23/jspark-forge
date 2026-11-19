#!/usr/bin/env bash
# Spike C: does SubagentStart additionalContext reach each helper type, and do PreToolUse blocks fire inside helpers?
# Usage: spikes/run-spike-c.sh <scratch-project-dir> <log-dir> [runs=3] [model=haiku]
# The scratch project must contain .claude/agents/tester.md (custom agent). Uses the forge-probe plugin.
set -u
PROJ="$1"; LOGS="$2"; RUNS="${3:-3}"; MODEL="${4:-haiku}"
PLUGIN="$(cd "$(dirname "$0")/probe-plugin" && pwd)"
mkdir -p "$LOGS"
TYPES=(general-purpose Explore Plan tester forge-probe:helper fork)
cd "$PROJ" || exit 1
for t in "${TYPES[@]}"; do
  for i in $(seq 1 "$RUNS"); do
    tag="${t//:/_}-$i"
    export FORGE_SPIKE_LOG="$LOGS/c-$tag.jsonl"
    : > "$FORGE_SPIKE_LOG"
    prompt="Use the Agent tool with subagent_type \"$t\" (exactly that type) to do this task: first run the shell command \`echo FORGE_BLOCK_TEST\`, then list the files in the current folder, then give a short final report. After the helper returns, print its final report verbatim."
    claude -p "$prompt" --model "$MODEL" --plugin-dir "$PLUGIN" \
      --allowedTools "Agent" "Bash" "Read" "Glob" "Grep" \
      --output-format json > "$LOGS/c-$tag.out.json" 2> "$LOGS/c-$tag.err"
    echo "$(date +%H:%M:%S) done $tag exit=$?"
  done
done
