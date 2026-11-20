# JSPARK Forge rules for this project

Lines under "Confirm" need a typed CONFIRM before they run. Lines under "Never" are always refused.
Write each rule as: - `text to match` : why it is dangerous
Text in backticks is matched as written (any case). Start it with re: for a regular expression.

Examples (copy one under a heading and remove "Example:" to switch it on):
Example: - `terraform destroy` : destroys cloud infrastructure
Example: - `re:kubectl\s+delete\s+(ns|namespace)` : deletes a whole namespace
Example: - `drop database production` : production database

## Confirm

## Never

## Settings
Every switch is on unless a line here, or in your own ~/.claude/jspark-forge/rules.md (for all your projects), says
off. Copy a line below and remove "Example:" to set it for this project:
Example: - notes: off
Example: - statusline-segment: off
Example: - code-map: off
Example: - ui-skills: off
Example: - playwright: off
Example: - brand-skill: my-brand
