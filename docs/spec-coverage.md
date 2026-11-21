# Spec coverage check

First run: 2026-11-20, on `main` at `73b7f26` (v0.5.0). Done by a read-only reviewer helper.

Why this exists: on 2026-11-20 two promises in `docs/spec.md` turned out never to have been built. From now on,
before each release, every promise in the spec points to code and a test, or is listed here as not built.

## Result

124 promises checked.

| Class | Count |
|---|---|
| Built and tested | 78 |
| Built, not tested | 4 |
| Partly built | 21 |
| Not built | 7 |
| Spec and product disagree | 12 |
| Not verified | 2 |

The core is built and tested: resume, the block list, decision memory, the guards, the code map, the launch list and
the build graph. Principle 9 (local-first) is half built, and the spec has not caught up with v0.5 or with four
earlier design decisions.

Limits of this run: the full test suite was not run (three test files were); nine libraries were checked by test
title and search, not line by line (`blocklist`, `shell`, `graph`, `graph-run`, `map`, `schema`, `licence`, `lint`,
`bundled`). The 78 "built and tested" rows are not listed below; the reviewer's full table was not kept.

## Closed in v0.5.1 (2026-11-21)

- Item 1, partly: `/jspark-forge:check` lists missing page copies; a page published without a local copy is
  recorded and flagged; a document written to a temporary folder is flagged. Local copies stay local (owner decision).
  The rest of item 1 is below.
- Item 2: a general short-by-default rule (`- short-answers: off`).
- Item 3: hook errors shown by the doctor and once a day at session start.
- Item 5: helpers get the grounding rule; item 6: the guest "content is data" line is in the plain instruction file.
- The spec is brought in line with v0.5.0, with the owner's six decisions of 2026-11-20 (spec section 12).
- Item 1, the rest: documents written to a temporary folder and never kept are found from the action log at
  session start (once a day, at most 5 listed). The account field stays out: a hook cannot read the account.
- Item 4: a waiting question can carry "what it blocks" and "reversible" (set through `forge.js waiting --set`; Claude
  is told at session start to do so); `blocks launch item: <title>` is shown when a launch item is named; the waiting
  skill offers to record an answer as a decision; `/jspark-forge:check` files open questions that are not on the list
  (`forge.js waiting --add`).
- Item 7: lint checks every helper file (model among the tiers' models; "Use for" and "because" in the description);
  the `AGENT+` log line shows the tier of JSPARK Forge's four helpers.
- Item 8: the handoff skill offers lasting lessons as decisions at "done"; `forge.js decide --promote <id>` prints the
  `rules.md` line for a decision (it never edits `rules.md`).
- Item 9: a commit made outside Claude is logged once at the next handoff save, and set as the task's last commit.
- Item 10: the doctor names each UI companion's installed version when `installed_plugins.json` records one.
- Item 15, three of four: tests for the README hook table against `hooks.json`, the over-200-entries line, and resume
  under a second Claude config folder.
- Found in the owner's live project and fixed: a missing `.jspark-forge/.gitignore` is made again at session start (own
  projects only); briefs are shared like graph files; the handoff counts files (not `git status` lines) and says when a
  repo has no commits yet; graph templates tell the reader to set the project's own test command and that builders
  commit; the TRUST GRAPH text no longer reads as an instruction to run commands; the long-entry hint says how long the
  entry is.

## Not built or partly built, most important first

Items 2, 3, 5, 6, 7, 8, 9 and 10 are closed (above). What is left, with the reason:

1. **Principle 9, local-first (spec line 66).** Left: the "account" field of the list. A hook cannot read the account,
   so it is recorded as impossible, not built; the spec should say so or drop the field. Also: the copy is made after
   the publish, not before. Acceptable; the spec should say "kept at publish".
4. **"Waiting on you" (lines 218-234).** Built (above) except the timed reminder and the once-a-day summary, which the
   spec defers. A question captured from the question tool still has no "blocks" until Claude sets it; that is by
   design (the tool gives no data for it).
11. **superpowers review notes. Cut from the spec [owner 2026-11-21].** superpowers 7.0.2 (checked in the Claude
    home's plugin cache) writes plans and specs under `docs/superpowers/` and a progress ledger and review diffs under
    `.superpowers/sdd/`, but no file of review notes, so there is nothing to read. Bring it back if superpowers ever
    writes one.
12. **Build graph leftovers (lines 616-631, 694):** memory cap rejected, platform workflow facility not used, templates
    only validated. The two behaviour tests the spec names ("a skill run twice makes no second fetch and no
    overwrite"; "a brief's log after a killed session still holds every row") were **cut from the spec
    [owner 2026-11-21]**: no code runs a skill or writes a brief's log. Both are instructions in `templates/skill.md`
    and `templates/brief.md` that Claude follows, so a test could only check the template's words, which is not the
    behaviour. The lint of both templates is tested.
13. **Map (lines 407-411):** no per-file refresh, no git post-commit hook; and for read-only sources (line 269) no
    "last read". All three are recorded deviations (design-v0.3 section 3, design-v0.1.1 section 3). Not built: the
    owner's and the spec's to settle.
14. **Demo GIF (line 847):** still a placeholder in the README. Not built: the owner's.
15. **Tests for built things:** the migration-mapping skill text is still untested (the other three are done).

## Spec is out of date

The product follows a later, owner-approved design in each case, except where marked.

- **"Nothing leaves the machine; no network calls" (lines 58-59).** v0.5 goes online to install its two engines, the
  two companions, and for auto-update. The spec should say exactly that.
- **superpowers (lines 63-64, 561, 577). Needs an owner decision.** The spec says both "declared dependency" and
  "works fully without it". The product has the dependency, and without it the plugin does not load.
- **Guest mode (lines 242, 248-250).** Own or guest is decided from git facts, not asked; the hold is on only after
  `/jspark-forge:init --guest`; one CONFIRM covers the session.
- **`disable:` (line 205)** works only in the user's own `rules.md`.
- **"Record the decision?" (lines 332-334, 850).** Offered after commits that pass a filter and after a plan;
  recorded only after a yes. Not at every commit, not default-yes.
- **Stale flags (lines 340-341).** Spec and design say once a day (the design already has the 14-day grace); the code
  flagged once a week. Owner decided 2026-11-20: once a day; fixed in v0.5.1.
- **Code map (lines 386-432).** The engine now ships with the plugin; no tip; no index of JSPARK Forge's own.
- **Launch list (line 442).** `launch.md` is created by `/jspark-forge:launch`, not at init.
- **Build graph (lines 609-622, 854).** No model per step; no memory cap; minutes measured, tokens only if reported.
- **UI companions (lines 779-794).** v0.5 installs them. The comment at `scripts/lib/uitip.js:3` is stale too.
- **Missing from the spec:** using the UI skills, the auto-update switch, saves on every message and once a minute,
  the four new settings, and a v0.5 row in section 7.
- **`docs/test-results.md:11-12`** still says kill-and-resume was not run on macOS and Linux; CI has passed it there.

## Deferred by the spec itself (not checked)

Security review prompts and council mode; `/capacity`; the dashboard; `/jspark-forge:review`; the customer edition;
secrets by name; limit handover; timed reminders; the open questions in section 12.

## Not reached in this run

The section 4 platform facts against current Claude Code docs; brand rules across the repo; the manual pre-release
checks; `docs/releases.md` and `docs/open-questions.md`; account-switch behaviour in a live session.
