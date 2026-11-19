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
- notes: on
- statusline-segment: on
