---
name: decisions
description: Use when the user runs /jspark-forge:decisions or asks which decisions, rules or lessons are on file for this project, or asks to store a large document or a knowledge base in decision memory.
---
Show the decisions on file. This changes nothing.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" decisions` (add `--all` if the user asks for retired ones too)
   and show what it prints as it is.
2. If the user asks to keep a large document or "a knowledge base" in decision memory, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" decisions --kb-request "<one line saying what they wanted>"`, show its
   answer, and suggest a reference entry instead (one line pointing to the document, via /jspark-forge:decide).
