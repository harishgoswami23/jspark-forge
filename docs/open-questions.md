# JSPARK Forge: open questions for the owner

Most important first. Each has a recommendation; a "yes" to the recommendation is enough. Q1, Q5 and Q8 were
decided by the owner on 2026-11-03 (external review); numbering is unchanged.

**Status after v0.4.0 (2026-11-20), checked against the code.** The builds settled most of these:
- **Built as recommended:** Q3 (Node.js 18 or newer required, checked by `/jspark-forge:doctor`), Q4 (the handoff
  is not committed: `.jspark-forge/.gitignore` keeps only `rules.md`, `launch.md` and `decisions.md`), Q6 (`CONFIRM`
  then Claude Code's yes/no prompt), Q15 and Q16 (guest state outside the repo, removed after 30 days unused), Q17
  (package runners such as `npx` and `uvx` are quarantined in a guest repo), Q19 (plain Markdown headings with a few
  `- key: value` lines per step), Q22 (`forge.js lint` requires an `Evidence:` line in the Verify part).
- **Built differently:** Q9 (the status line is added automatically, once per machine, only when you have none; your
  own status line is never touched, a one-time tip explains the choice; `/jspark-forge:init --undo-statusline`
  undoes it), Q10 (JSPARK Forge's own hooks plus a catch-up at session start; no git hook is offered), Q12 (handoffs
  older than 30 days are archived).
- **Still open, for the "later, only if asked" pieces or for launch:** Q11 (dashboard), Q13 (usage statistics: none so
  far), Q14 (demo GIF still to record), Q18, Q20, Q21. Q2 and Q7 stand as decided or recommended.

### Q1. [Decided] The `/resume` name clashes with Claude Code's own `/resume`
Claude Code already has a built-in `/resume` (it reopens a past conversation). Plugin commands are namespaced, so
ours is `/jspark-forge:resume`. The pitch "type `/resume`" would open the built-in picker instead.
**Decided (owner, 2026-11-03 review):** the pitch becomes *"Open Claude Code and pick up where you left off in 30
seconds."* (README line one: *"Claude Code forgets. JSPARK Forge doesn't. Open Claude Code and pick up where you left
off in 30 seconds."*). "Type `/resume`" is gone from the pitch and README; JSPARK Forge shows "here's where we were" by
itself when Claude Code opens. `/jspark-forge:resume` stays as the on-demand command.

### Q2. [Decided] Run the plan-limit spikes on which account?
Plan-usage figures exist only on Pro/Max/Ultra. Spike A needs one such account and one API-key account.
**Decided (owner, 2026-11-19):** the owner's Team-plan login (it reports plan usage); an API-key account with a
small spend cap for the other side, still to run. Original recommendation: use your own Max account for the Pro/Max side; a throw-away API key with a small spend cap for
the other.

### Q3. Require Node.js?
Hooks need a script runtime. Node is the most likely to be on a technical founder's machine and is the same command
on all three systems; Python is often missing or a Store stub on Windows.
**Recommendation:** require Node ≥ 18 (no packages). Install output says so; `/jspark-forge:init` checks it.

### Q4. Commit the handoff file to git?
Committed: a co-founder or a second machine sees it. Not committed: no private prompts or paths in the repo history.
**Recommendation:** not committed by default (`.jspark-forge/.gitignore`); one setting in `.jspark-forge/rules.md` to
commit it. `.jspark-forge/rules.md` itself is committed.

### Q5. [Decided] Let JSPARK Forge ask Claude to update its short notes (one extra short turn, about 3 times an hour)?
Without it the handoff has facts only (task list, files, commits); with it, it also has "what we agreed and why".
**Decided (owner, 2026-11-03 review):** no Stop block and no extra turn in v0.1. Instead JSPARK Forge adds the
`additionalContext` line "update your notes now" before a `git commit` (PreToolUse), at compaction, and at the 80 %
usage band (design 5.3). On by default, switchable off in `.jspark-forge/rules.md`.

### Q6. After the user types `CONFIRM <action>`, one more yes/no prompt or none?
The spec says the override is an `ask` (Claude Code's own yes/no prompt). With the typed word first, that is two
steps.
**Recommendation:** keep the `ask` for v0.1 (safest, matches the spec); revisit after first users.

### Q7. Which entries are "never, even with CONFIRM"?
**Recommendation:** only `rm -rf` on the home folder, the root or a whole drive. Everything else on the published
list is typed-confirm. Users add their own "Never" lines in `.jspark-forge/rules.md`.

### Q8. [Decided] Make "show and wait" hook-enforced?
After a cutoff, JSPARK Forge can refuse file changes and commands until the user has replied once (read-only look-ups still
allowed).
**Decided (owner, 2026-11-03 review):** not in v0.1. The guard would fire on SessionStart `startup` in `claude -p`
(CI, scripts) too and stall those runs, and Claude Code documents no hook input field that tells headless from
interactive. v0.1 default = **instructed only** (no hook enforcement). Spike D tests headless detection; if it
passes, v0.1.1 adds the guard and skips it in non-interactive runs.

### Q9. Install the status-line wrapper by default?
It is needed only for usage-limit saves; it changes a user setting.
**Recommendation:** `/jspark-forge:init` asks, default yes, shows exactly what changes and how to undo.

### Q10. Codebase-map refresh (v0.3): git hook or JSPARK Forge's own hooks?
A real git post-commit hook also catches commits made outside Claude but writes into the user's `.git/hooks` (and
clashes with tools like husky).
**Recommendation:** refresh after commits Claude makes, plus a catch-up at session start when `HEAD` moved; offer the
git hook as an opt-in.

### Q11. Dashboard data path (later release)
An Artifact cannot read a file on the user's disk; Claude has to publish the data to it.
**Recommendation:** `/jspark-forge:dashboard` publishes a summary of `.jspark-forge/state.json` with "as of <time>";
a local HTML file is rewritten at each save as the fallback. `.jspark-forge/state.json` is committed only if the user
opts in.

### Q12. Old handoffs: how long to show them?
**Recommendation:** show the "where we were" prompt only if the handoff is under 14 days old; older ones are
mentioned in one line ("an old handoff from 3 Oct exists").

### Q13. Usage statistics
**Recommendation:** none, not even opt-in, for v0.1–v0.3. "Nothing leaves the machine" is part of the pitch; use
GitHub stars, installs and issues to measure adoption.

### Q14. Test fixture and demo
**Recommendation:** a pinned, permissively licensed public repo of ~50k lines for the 30-second test (builder picks
and records it); a 20-second GIF at the top of the README showing a killed session and the "where we were" prompt.

### Q15. Before `/jspark-forge:init` runs, where do hooks write? (v0.1.1)
Opening a cloned repo fires hooks before anyone answers "your project or one you're reviewing?". Writing
`.jspark-forge/` then would break guest mode's "nothing inside the repo".
**Recommendation:** in a repo with no `.jspark-forge/`, write nothing inside it; keep state in the guest folder
(`~/.claude/jspark-forge/guests/<repo-hash>/`) and ask the init question once at session start.

### Q16. How long to keep guest state? (v0.1.1)
**Recommendation:** keep 30 days after the last session, then delete it, mentioned in one line at the next session
start.

### Q17. Add more commands to guest quarantine? (v0.1.1)
The owner's list covers installs, `make`, the repo's scripts, `docker run`, `curl … | sh`. Package runners execute
code too.
**Recommendation:** also quarantine `npm ci`, `npm run`/`npx`, `uvx`/`pipx run`, `docker compose up`, `go run`,
`cargo run` when the target is the guest repo.

### Q18. Build graph runner where the platform has no workflow facility (v0.4)
Claude Code has a workflow facility that runs agents in parallel and in pipelines. The IDE and web forms may not
expose it, and other platforms certainly do not. **Recommendation:** the runner always works node by node through
ordinary helpers; the platform facility is an optimisation used only when detected (same graph file, same state
file, same tests). Decide after the v0.3 engine trial.

### Q19. Graph file format (v0.4)
Plain Markdown headings (readable by anyone, diffable, matches the handoff) or a strict schema (YAML/JSON, validated
before a run). **Recommendation:** Markdown headings with a small front-matter block per node (`kind`, `model`,
`inputs`, `outputs`, `after`); validated before the run; a schema can be derived from it later. Owner leaning: plain
text first (principle: readable by non-coders).

### Q20. Council quorum and tie rules (5.6 council mode)
C4 says a verdict needs a quorum of complete rankings; C5 aggregates by mean position. Open: the quorum for councils
larger than three, and what the chair does when two answers tie on mean position.
**Recommendation:** minimum three evaluators (a two-evaluator council is refused); quorum = a majority of evaluators
with complete rankings, never fewer than two; a tie on mean position is reported to the chair as a tie (no coin flip,
no "first wins") and the chair's verdict names it; below quorum the run ends with "no verdict" shown to the user and
nothing stored as a verdict (the rankings that did parse are kept).

### Q21. Customer edition: who signs a customer overlay? (5.12)
Core and vendor packs are signed by the vendor. A customer overlay produced inside the customer's network has to be
signed by someone before the product installs it.
**Recommendation:** the customer's own release key signs the customer overlay; the vendor key signs core and vendor
layers; the product refuses an overlay that touches a layer its signer does not own; the customer's two-person
approval stays the product's gate; the kit never holds a signing key, it only hands the pack to the signing step.

### Q22. Skill template: what counts as verification evidence? (5.11)
The verification step must carry evidence, not a claim. Open: a fixed form, or free text.
**Recommendation:** a fixed two-field form per run: `check` (the command or test that ran) and `evidence` (its exit
code plus up to five quoted output lines, or a `path:line`); written to the action log (5.1) and to the brief log;
free prose alone is not accepted; the lint flags a skill whose verification step lacks either field.
