---
name: usage
description: Use when the user runs /jspark-forge:usage or asks where the tokens or the usage went in this session, why limits are hit so often, or what would save usage.
---
Show where this session's tokens went.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" usage` and show what it prints as it is. It only reads this
   session's own record; it changes nothing.
2. If it lists something under "What would save most", say which one you would do first, in one line. Do not start a
   new session, change settings or re-run anything unless the user asks.
