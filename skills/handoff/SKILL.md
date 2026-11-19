---
name: handoff
description: Use when the user runs /jspark-forge:handoff, asks to save where they are now, or says the current task is done and should be closed.
---
Save the handoff now. Arguments: $ARGUMENTS

1. Update `.jspark-forge/state/notes.md` (max 120 words), replacing what is there:
   - first the lines `Task: <the task>`, `Step: <n> of <m>: <current step>` and `Next: <next action>` when you know them;
   - then what you are doing, anything agreed with the user, and what is next, in plain words.
2. Run this command (the arguments decide the form):
   - if the arguments contain "done": `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" save --done`
   - otherwise: `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" save`
3. Reply with the one line the command printed, and nothing else.
