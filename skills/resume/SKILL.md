---
name: resume
description: Use when the user runs /jspark-forge:resume or asks where they left off, what they were working on, or to pick up the last task.
---
Show the user where the work stands, then wait.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" show` and read what it prints: that is the handoff.
   Do not read the log or any other file for this, unless the user says the handoff is behind what they remember:
   then read the end of the log file it names and say what it adds. If it prints "No handoff saved yet in this project.", say that and
   stop.
2. Reply in plain words, at most 8 lines, short sentences, no jargon:
   - what the task was and the step ("We were adding Save as chart. Step 4 of 10.");
   - the next action;
   - anything still running at the cutoff (it may have stopped) and anything waiting on the user;
   - if the handoff's branch differs from the current branch, say so in one line.
   End with: "Continue?"
3. Offer "show details" in one line. If the user asks for details, list: branch and HEAD, files touched, recent
   actions, and the path of the log file named in the handoff (do not open it unless asked).
4. Wait for the user's answer. Do not change files or run commands for the old task until they reply.
