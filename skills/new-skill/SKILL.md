---
name: new-skill
description: Use when the user runs /jspark-forge:new-skill or asks to create a new skill for this project from the JSPARK Forge skill template.
---
Create a new skill from the template. The name comes from $ARGUMENTS (lower case, hyphens); if it is missing, ask for it.

1. Set the target to `skills/<name>/SKILL.md` in the project. If that file already exists, stop and say so. Never
   overwrite it.
2. Copy `${CLAUDE_PLUGIN_ROOT}/templates/skill.md` to the target (create the folder), then set `name:` to the new name.
3. Ask the user what the skill does and when it should trigger. Replace the example description (it must start with
   "Use when") and the example parts with real ones: each part has Input, Action and Output, and the last part is
   `Verify:` with `Evidence:`.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/forge.js" lint skills/<name>/SKILL.md` and fix what it reports until it
   prints "ok".
