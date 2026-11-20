---
name: handoff
description: Use when the user runs /jspark-forge:handoff, asks to save where they are now, or says the current task is done and should be closed.
---
Save the handoff now. Arguments: $ARGUMENTS

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" where`; it prints the path of the notes file. Write that file
   (max 120 words), replacing what is there:
   - first the lines `Task: <the task>`, `Step: <n> of <m>: <current step>` and `Next: <next action>` when you know them;
   - then what you are doing, anything agreed with the user, and what is next, in plain words.
2. If the arguments contain "done", before closing the task offer once to record its lasting lessons as decisions: at
   most 3, one line each (`Record the lesson? "<draft, 15 words at most>" (touches: <paths>)`), only things that will
   still be true next month (a rule found, a trap, a choice and its reason), not a summary of the work. Stop and wait
   for the answer. Record only after the user says yes (or gives an edit), the way /jspark-forge:decide does, with
   `kind: lesson`; if they skip or say nothing more, record nothing. Never offer it twice for the same task.
3. Run this command (the arguments decide the form):
   - if the arguments contain "done": `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" save --done`
   - otherwise: `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" save`
4. Reply with the one line the command printed, and nothing else.
