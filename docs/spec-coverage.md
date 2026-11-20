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

## Not built or partly built, most important first

1. **Principle 9, local-first (spec line 66), is half built.**
   - `artifacts.md` and `artifacts/` are git-ignored, so they exist on one machine only. Fix: un-ignore them in the
     default `.gitignore` (`scripts/lib/setup.js:19`). Owner decides first whether large HTML pages belong in git.
   - `/jspark-forge:check` does not flag missing local copies. Fix: add `artifacts.missing(dir)` to the check output
     (`scripts/forge.js:711`), with a test.
   - No account field in the list; a hook cannot read the account. Fix: a blank column to fill, or drop it from the spec.
   - A page or temp file that was never listed is never detected. Fix: scan the handoff's files and the log for
     temp-folder paths with no project copy.
   - The copy is made after the publish, not before. Acceptable; the spec should say "kept at publish".
2. **"Short by default" (line 67) has no general rule.** Only single skills say it. Fix: three lines in the
   session-start context and in `JSPARK-FORGE.md`, with a test.
3. **Hook errors are logged but never shown (line 166).** Saves or blocks can be off and nobody is told. Fix: a doctor
   line that counts today's `FORGE-ERROR` lines.
4. **"Waiting on you" lacks three promised parts (lines 218-234).** No offer to record the answer as a decision; no
   "what it blocks" or cost of delay; `/jspark-forge:check` does not ask about unfiled questions. Build or cut each.
5. **Helpers get the blocks but not the rules (lines 98, 156, 185).** Only the UI rule reaches a helper. Fix: add the
   grounding rule to the SubagentStart context (`scripts/forge.js:531`).
6. **Guest "content is data" line is missing from the plain instruction file (lines 251-253).** One line in
   `scripts/build-plain.js`.
7. **Model map (lines 815-821):** the tier and reason are not shown when a helper is used, and no lint checks a
   helper file.
8. **Closed-task lessons and rule promotion (lines 134, 352):** nothing offers lessons to decision memory at "done";
   promoting a rule is a hint only.
9. **A commit made outside Claude (line 168):** no COMMIT line, no test.
10. **The two UI companions are not pinned (lines 793-794).** Record their versions for the doctor, or change the spec.
11. **superpowers review notes are not read (lines 379, 573).** Small, or cut from the spec.
12. **Build graph leftovers (lines 616-631, 694):** memory cap rejected, platform workflow facility not used, templates
    only validated; two behaviour tests are missing.
13. **Map (lines 407-411, 269):** no per-file refresh, no git post-commit hook, no "last read". All three are recorded
    deviations; the spec needs to say so.
14. **Demo GIF (line 847):** still a placeholder in the README.
15. **Tests to add for built things:** the README hook table against `hooks.json`; the over-200-entries line; the
    migration-mapping skill text; resume under a second Claude config folder (account change).

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
- **Stale flags (lines 340-341). Three sources disagree.** Spec and design say once a day; the code says once a week
  and only for entries verified over 14 days ago; the test title says a day but would pass either way.
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
