---
name: doctor
description: Use when the user runs /jspark-forge:doctor or asks whether JSPARK Forge is working, installed correctly, or why its saves, blocks or status line do not seem to work.
---
Check that JSPARK Forge works on this machine. This changes nothing.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" doctor` and read what it prints.
2. Reply with the summary line, then only the FIX lines, each with its fix in one line. If there are none, say
   "Everything works." in one line. Offer "show all checks" in one line.
3. Do not apply any fix yourself. If the user asks you to, do only that step and run the doctor again.
