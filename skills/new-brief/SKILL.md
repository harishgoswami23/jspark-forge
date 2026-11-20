---
name: new-brief
description: Use when the user runs /jspark-forge:new-brief or asks to write a brief (one job for one helper) from the JSPARK Forge brief template.
---
Create a new brief from the template. The name comes from $ARGUMENTS (lower case, hyphens); if it is missing, ask for it.

1. Set the target to `.jspark-forge/briefs/<name>.md` in the project. If that file already exists, stop and say so.
   Never overwrite it.
2. Copy `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` to the target (create the folder).
3. Ask the user for the job. Replace the example fields with real ones: Goal, CAN change, CANNOT change, Done and Stop
   are required; Retries is a number; Outputs is a comma list of names; Stop is never "never stop".
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" lint .jspark-forge/briefs/<name>.md` and fix what it reports
   until it prints "ok".
