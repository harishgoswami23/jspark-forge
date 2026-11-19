---
name: brand
description: Use when creating or changing anything a user of this product will see (screens, components, emails, documents, copy), so it follows the product's own brand rules.
---
<!--
JSPARK Forge brand skill template (spec 5.14). Copy to skills/brand/SKILL.md in your project and fill in every <...>.
Keep it short: rules Claude can follow and check, not a style guide essay. Record the rules that must never break as
decisions too (/jspark-forge:decide, Touches: your UI folders), so Claude sees them just before it edits those files.
-->
Follow these brand rules for <product name> in everything a user sees. If a request conflicts with them, say so and ask.

1. Colours. Input: the screen or file being changed. Action: use only these colours: <primary #......> for the one
   main action or accent per screen, <text #......>, <background #......>, <muted #......>, status colours
   <success #......> / <warning #......> / <error #......> only for status. Never other shades, never the accent as a
   background wash. Output: the changed file.
2. Typography. Input: the same file. Action: one typeface, <font name>, weights <regular> and <bold> only; sizes from
   this scale only: <e.g. 12, 14, 16, 20, 24, 32, 48>. Output: the changed file.
3. Spacing and layout. Input: the same file. Action: spacing from this scale only: <e.g. 4, 8, 12, 16, 24, 32, 48>;
   <corner radius>; <max content width>; it must work at phone width without sideways scrolling. Output: the changed
   file.
4. Components. Input: the same file. Action: use the project's existing components first (<component library or
   folder>); a new component matches their look and states (hover, focus, disabled, error, empty, loading). Output:
   the changed file.
5. Voice. Input: any text a user reads. Action: <tone in one line, e.g. "direct, specific, no hype">; never use: <words
   to avoid>; numbers as <numerals / units rule>. Output: the changed text.
6. Verify: the Pre-ship check. Input: the finished change. Action: check each rule above against the running screen
   (open it with Playwright MCP and take a screenshot) or the text, and list any rule broken. Evidence: the screenshot
   path or the checked text, and "all rules met" or the rules broken with where.
