---
name: init
description: Use when the user runs /jspark-forge:init to set up JSPARK Forge in this project, or /jspark-forge:init --undo-statusline to restore their status line.
disable-model-invocation: true
---
Set up JSPARK Forge in this project. Arguments: $ARGUMENTS

If the arguments contain "--undo-statusline":
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline/install.js" --undo` and reply with the line it printed. Stop.

If the arguments contain "--guest" (a repo the user is reviewing: write nothing into it, hold its install, build,
test and run commands) or "--mine" (the repo is the user's own):
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js" --guest` (or `--mine`) and reply with the line it printed. Stop.

Otherwise:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"`.
   If `node` is not found, reply: "JSPARK Forge needs Node.js 18 or newer. Install it from nodejs.org, then run
   /jspark-forge:init again. Until then its hooks stay off and nothing is protected." Stop.
2. Show the lines it printed, as a short list.
3. If it printed "Status line: wrapped by JSPARK Forge", you are done.
4. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline/install.js" --status` and show this, filling in the
   current status line, then wait for the answer:

   > JSPARK Forge wants to wrap your status line so it can see context and plan usage (only shown to the status line).
   > Your current status line: `<command or "none">`. It will still show exactly as now; JSPARK Forge adds a short
   > "saved" note after it and refreshes it every 30 seconds. A backup of your settings goes to `~/.claude/jspark-forge/`.
   > Undo any time: `/jspark-forge:init --undo-statusline`.
   > Go ahead? (yes / no)

5. On yes: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline/install.js"` and reply with the line it printed.
   On no: reply "OK, your status line is unchanged. Everything else works; only the 80 % / 95 % usage saves are off."
