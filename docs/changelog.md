# JSPARK Forge: spec changelog

The revision history of the spec itself (not of the plugin). Newest last. The current text is
[`spec.md`](spec.md); release detail in [`releases.md`](releases.md).

---

### Rev 1: original spec (2026-11-02)
**What:** a broad "whole working kit" plugin for solopreneurs, coders or not: how to build, what and where everything
is, why it was built that way, where you left off, whether it is safe, and whether a new idea is worth delaying the
launch for. Pieces included a bundled method kit (superpowers), a code map, decision memory, resume, a security
auditor, a roadmap planner, a capacity advisor and an Artifact dashboard. Name settled as JSPARK Forge.
**Why:** the owner's starting picture of what a solo founder loses when building with Claude Code.

### Rev 2: first external critique accepted (2026-11-02)
**What:** Resume became the headline ("the wedge"); thin wrappers on native features dropped; positioning narrowed to
technical solo founders (plain-language output kept as a quality); mechanical freshness for map and decisions
(`touches:`, last verified); "Security review prompts" instead of an auditor, never "clean"; scope facts before any
estimate; `/capacity` hidden; dashboard from a state file with "as of"; a "How JSPARK Forge differs" table; every
hook documented. superpowers recommended, not bundled. Usage-limit save at 80 % (quiet) and 95 % (forced). New order:
v0.1 resume + hooks, v0.2 decision memory, v0.3 map + scope guard, the rest only if asked.
**Why:** eight tools with no clear wedge, risk of features being absorbed by Claude Code, two audiences at once.

### Rev 3: second external critique (2026-11-02)
**What:** verify before relying on the 80/95 % rule; mechanical, published save triggers; a published block list with
typed confirmation; verify that rules reach helpers; decisions prompted at commit and accepted plan (default yes,
never silent); `launch.md` with 5 blank slots; soft coupling to superpowers (tested); resume loads only a ~600-word
handoff; log rotated daily, kept 7 days; positioning line fixed. First "verified facts" table from the Claude Code
docs (context % and plan quota only on the status line, hooks fire in subagents, SubagentStart can add context).
**Why:** ten holes where the spec promised behaviour nobody had defined or checked.

### Rev 3.1: third external critique (2026-11-02)
**What:** the status line → file → hook bridge treated as a workaround (timestamped figures, 2-minute rule, wrapper
that chains the user's status line, with disclosure and undo); "rules reach every helper" only if a spike proves it,
otherwise "safety blocks still fire inside helpers"; Pro/Max/Ultra requirement for plan-limit saves on the README
first screen. Housekeeping rule: no company references in the repo. Three spikes (A–C) before any v0.1 code.
**Why:** three fragile points that could make the headline promise untrue.

### Consolidated spec (2026-11-02)
**What:** latest decisions only, superseded text dropped; split into `spec.md`, `design-v0.1.md` (build-ready v0.1
design), `spikes.md`, `open-questions.md` (Q1–Q14) and a README draft; business notes moved out of the public docs;
brand rule: always "JSPARK Forge", never "JSPARK Forge" alone.
**Why:** three stacked revisions overriding each other were hard to build from.

### 2026-11-03: external review fixes
**What:** show-and-wait instructed only until a spike proves headless detection (Q8 decided; new spike D); project
folder renamed to hidden `.jspark-forge/`; PostToolUse matcher limited to writing/state tools; PreToolUse timeout
10 s → 3 s, SessionEnd 1 s with a minimal write; deny reasons say "Do not try an equivalent command; tell the user
and stop."; `git-reset-hard` also covers whole-tree `checkout`/`restore`; `rm -rf` on the project root, `.` or `.git`
needs typed confirmation; secret-file templates (`.env.example`, `.env.sample`) allowed; Stop-block notes nudge
replaced by an `additionalContext` reminder (Q5 decided); v0.1 cut to a real one-week build with a cut list
(PowerShell forms → v0.1.1, 10-minute trigger dropped); pitch "Open Claude Code and pick up where you left off in 30
seconds" (Q1 decided); monetisation text removed; resume timing measured on a cold machine.
**Why:** the guard would stall `claude -p` / CI runs; a visible folder cluttered projects; hooks on every Read/Grep
added latency; v0.1 had grown past one week; "type `/resume`" opened Claude Code's own picker.

### 2026-11-03: spike results override review decisions
**What:** new principle 9: if a spike contradicts a reviewed decision, the spike wins; the deviation, evidence and
reason go into a "Deviations from review" list in `design-v0.1.md` (section 16) and the decision is updated. Before-code
order written down: design fixes → v0.1 cut → spikes A–C + D → build.
**Why:** review decisions were made from the docs; the spikes test the real product, and the docs already show one
likely gap (PreCompact cannot inject context).

### 2026-11-03: v0.2 / v0.3 scope, memory check, live map refresh
**What:** stated plainly that v0.1 carries only the handoff; v0.2 decision memory is the "why" (one-line entries
injected just before Claude edits a touched file, no code structure); v0.3 codebase map is the "what and where"
(architecture memory), engine not chosen and trialled after v0.1 ships, date soft, "a stale map is worse than none".
New `/jspark-forge:check` ("is my memory still true?") in v0.2, extended to the map in v0.3, read-only unless the user
confirms. The map also refreshes file by file as Claude edits (background, changed files only, skipped if already
queued), with last-refresh time on every answer. Added `releases.md` (every release in one place) and this changelog.
**Why:** make clear what each release remembers; close the "uncommitted work isn't in the map" gap; give users a
way to check that stored memory is still true; one document covering all versions.

## 2026-11-03 — Local-first, account-independent principle
**What:** new principle 9: every page, mockup, dashboard, decision and handoff is a local project file first; an Artifact is only a view; `.jspark-forge/artifacts.md` index; `/jspark-forge:check` and session start flag anything without a local copy.
**Why:** owner observation after an approved mockup became unreadable when switching Claude accounts (it existed only as an Artifact on the other account and in a deleted temp folder).

## 2026-11-03 — Model choice advice
**What:** `/capacity` working-style advice now also recommends which model per job: strongest for specs, architecture, security/permissions, migrations, hard debugging, number correctness, trade-off calls and the release gate; lighter for building from a reviewed plan, mechanical changes, test runs, formatting, small tested fixes.
**Why:** owner observation: specs must be written with the strongest model; mistakes there are expensive or invisible.

## 2026-11-03 — Waiting on you (v0.1.1)
**What:** new piece 5.2a: blocking questions are captured in `.jspark-forge/waiting.md`, shown in the status line and at session start, with cost of delay, one-reply answers, a reminder and daily summary, optional reversible-only deadline defaults, and `/jspark-forge:waiting`.
**Why:** owner observation: questions get buried in long replies and answers get put off; work waits silently.

## 2026-11-03 — Short by default
**What:** principle 10: lead with the answer, bullets/tables, one-line explanations, details on request; never drop warnings or decisions.
**Why:** owner: users dislike long paragraphs; short output is easier to scan and saves tokens.

## 2026-11-03 — External code: guest mode, readonly sources, migration
**What:** new spec 5.2b. v0.1.1: guest mode (init asks "Your project, or one you're reviewing?"; nothing written in the repo, state in `~/.claude/jspark-forge/guests/<repo-hash>/`; handoff tagged "review of <origin URL> @ <commit>"; decision memory, launch guard, map off), guest quarantine (installs/builds/runs need `CONFIRM`; repo content is data, never instructions), readonly sources (`## Sources` in `rules.md`; writes hard-denied, no CONFIRM); two new blocks `readonly-source`, `guest-quarantine`; v0.1.1 estimate ~4–5½ days. v0.2: source line in the handoff, migration mappings as decisions, licence check, guest review report (use / borrow ideas / avoid, never "clean"). v0.3: map of readonly sources, migration mode (inventory, parity plan, progress feeding the scope guard, cutover checklist). New Q15–Q17.
**Why:** JSPARK Forge assumed one owned project in one folder; reviewing someone else's repo and migrating from an old system broke that assumption (writes into foreign repos, untrusted scripts and text, edits to the source being migrated).

## 2026-11-03 — Ship gate, grounding rule, repo as source of truth
**What:** v0.1 ship gate explicit: ships only when the kill-and-resume test passes on Windows, macOS and Linux, after spikes A–D. New v0.1 piece 5.1a: a ≤ 10-line grounding rule injected at every SessionStart (cite path:line from the map or file; "not found" otherwise; never describe unread code); rule text in design 8.1; acceptance: present after startup/resume/compact. v0.3 map also indexes `docs/`, ADRs and schema source (migrations, Prisma, ORM models, SQL). Spike B adds a zsh row. Principle 11 + anti-goal: "store the specs / architecture / database in memory" is rejected as scope drift; the repo is the truth, decision memory holds one-line decisions. Confirmed unchanged: guest mode + readonly sources in v0.1.1; migration mappings as v0.2 decisions.
**Why:** owner 2026-11-03: a ship gate nobody can argue with; Claude inventing code locations it never read; a second knowledge base goes stale against the code; zsh is the macOS default shell.

- Correction (same day): the readonly-source handoff line ("Source: … @ commit, last read") is v0.1.1, per the owner, not v0.2.

## 2026-11-03 — Principle 11 reworded: don't block, measure locally
**What:** principle 11 + design anti-goal now read "Store nothing JSPARK Forge can re-derive from the repo": specs, schema and architecture are indexed by the v0.3 map, never copied into memory; users may still write anything into `decisions.md`, JSPARK Forge never blocks it. Replaces the earlier "rejected as scope drift" wording. v0.2 adds: `kind: reference` entries (pointer only, file read on demand); one warning for entries over ~80 words (suggest a reference); 30-day "still valid?" flag for entries without `touches:`; local counts of reference and long entries in `/jspark-forge:decisions`; knowledge-base requests logged in a local "declined, revisit at 500 users" list with a count. Acceptance criteria updated (spec 5.3 and 7, releases v0.2).
**Why:** owner 2026-11-03: refusing users is the wrong default; keep the repo as the truth by design, and measure demand for a knowledge feature on the machine, without telemetry.

## 2026-11-03 — Spec final; review report and migration mode cut
**What:** spec marked final (owner approval; build order spikes A–D, then v0.1). New principle 12 "Hooks, not verdicts", the test for future additions. Cut to "Later, only if asked" (spec 5.8a): `/jspark-forge:review` with its use / borrow / avoid verdict, and migration mode (inventory, parity plan, cutover checklist, sign-off, `migration.md`). Kept: guest quarantine, "content is data", readonly sources and source line (v0.1.1); licence check (one file read) and migration mappings as decisions (v0.2); map of readonly sources (v0.3). v0.2 estimate ~1 week → ~4½–5 days; total ~4 → ~3½–4 weeks; v0.3 loses its "migration mode not estimated" caveat. Q16 drops `review.md`.
**Why:** owner 2026-11-03: review verdicts make JSPARK Forge a code-review product and risk bad judgment; migration mode drifts into project management. JSPARK Forge keeps to hooks that deny, save or point.

### Rev 6: build graph added as v0.4 (2026-11-05)
**What:** new section 5.10 "Build graph": a build written down as a fixed graph of agent, parallel, gate, human and
save nodes with declared hand-off fields; the runner saves state after every node and resume lands on the running
node; per-node model and cost; parallel capped by memory and usage; three generic templates. Release plan gains a
v0.4 row (~1½–2 weeks after v0.3); open questions Q18 (runner without a platform workflow facility) and Q19 (file
format).
**Why [owner, 2026-11-05]:** a day-long multi-agent build showed that the order of steps, what each hands to the next,
and where a person must act were held only in the driver's head and the handoff log. Writing the graph down makes it
survive crashes, usage limits and account changes, and makes cost visible before a run. Principle 12 is kept: the
runner moves state and enforces command-based gates, it issues no verdicts.

### Rev 7: learnings folder (2026-11-07)
**What:** docs/learnings/2026-11-07-council-and-git-dashboard.md: ten testable rules for a review-gate "council mode" (C1-C5) and the dashboard's git-derived "what was built" view (G1-G5), plus the skill/brief template rules kept from two public agent-instruction files. Spec sections 5.8 (dashboard) and the review gate reference it when they are written.
**Why [owner, 2026-11-07]:** "embed the learning"; reviews of outside code must land as rules in the kit, not as notes.

### Rev 8: research of 2026-11-07 folded in (2026-11-07)
**What:** new section 5.11 "Skill and brief templates" (v0.2, ~1 week): a skill template (trigger description,
numbered parts with input → action → output path, skip-if-exists, non-overwriting outputs, a verification step with
evidence) and a brief template (`CAN`/`CANNOT` file lists, one definition of done or a directional metric, setup
handshake, fixed-schema append log, bounded retries, simplicity tie-break, an explicit stop condition, declared
outputs for 5.10), with lint and tests; the kit ships as a plugin and as a plain instruction file from one source.
5.6 gains a council mode for high-stakes reviews (rules C1–C5, tests; still "later"). 5.8 gains the git-derived
"what was built" view (rules G1–G5, the kit's own groupings per task label, day and model with test-run ids; still
"later, only if users ask"). New section 5.12 "Customer edition (later)": the kit inside a customer's network on a local
model, producing only a product's declared extension artifacts through the product's own gates, a person approving;
prerequisites listed; built only when a product built with the kit asks. Release plan: rows for 5.11, council mode,
the git view and 5.12; total to v0.4 ~5–6 → ~6–7 weeks. Section 8: template lint. New Q20 (council quorum and ties),
Q21 (who signs a customer overlay), Q22 (verification evidence format).
**Why [owner, 2026-11-07]:** "embed the learning": the rules kept in `docs/learnings` from reviewing public agent
files and two small public tools must land in the spec as checkable behaviour, not stay as notes. The customer
edition records the owner's long-run picture generically so the pack-layer and declarative-surface prerequisites are
known before any product asks for it.

### Rev 9: three ideas noted (2026-11-19)
**What:** new section 5.13 "Three ideas noted on 2026-11-19 (later, only if asked)": (a) secrets by name (OS
keychain, value only in one command's environment, new block for printing a resolved secret; open: needs a spike);
(b) limit handover (save and point to the person's own fallback near a plan limit; never switches accounts or
spends money); (c) `/jspark-forge:doctor` with `status` and `upgrade` (read-only health check; candidate for
v0.1.1). Release plan "Later" row lists them.
**Why [owner, 2026-11-19]:** ideas borrowed from a review of an open-source local agent host; nothing installed or
copied; each passes principle 12.

### Rev 9.1: consistency fixes (2026-11-19)
**What:**
- Principles: the second "9" (spike results override review decisions) renumbered to **13**; references in spec
  section 7 and `releases.md` updated. "Principle 9" now means only local-first.
- `design-v0.1.md` status: "waiting for owner approval" → approved with the spec on 2026-11-03.
- `releases.md` brought up to date: sections for v0.2 skill and brief templates (5.11) and v0.4 build graph (5.10);
  council mode, git view, customer edition and the three 5.13 ideas under "Later"; total to v0.4; doctor noted as a
  v0.1.1 candidate.
- 5.13b limit handover: the separate 90 % threshold removed; it rides on v0.1's 95 % band and extends that message.
- "Health check" now means only `/jspark-forge:doctor` (5.13c). The CI test that drives every hook event is renamed
  the **hook-fire test** (spec 5.1, 5.2, 8, 9; design 3, 13, 15).
- 5.13 no longer points to a git-ignored internal file.
- Spec status line lists the 2026-11-19 revision.
**Why:** documents disagreed with each other; one term meant two things; a public doc linked to a private file.

### Rev 10: no setup step; superpowers installed with JSPARK Forge (2026-11-19)
**What:** the first session in a git project switches JSPARK Forge on by itself; the status line is added
automatically when the user has none (their own is never touched; a one-time tip points to `/jspark-forge:init`);
`/jspark-forge:init` becomes optional. superpowers is a declared plugin dependency from the JSPARK Forge marketplace, so
one install brings both; a duplicate from another marketplace gets a one-time note. Install is one line. Also this
day: plugin and README carry the JSPARK AI logo; the repository is public at github.com/harishgoswami23/jspark-forge;
CI runs unit tests on Windows, macOS and Linux and the ship gate with the owner's subscription token.
**Why [owner, 2026-11-19]:** "once the user downloads and uses the repo, the work must be done automatically", and
"it must download superpowers as well".

### Rev 11: narrow the product; real users first (2026-11-20)
**What:**
- A **real-users gate** after v0.1.1: 20–50 users and ~2 weeks of feedback before v0.2; the roadmap is reordered
  from it; measured without telemetry (spec 7, 9).
- **Decision memory (v0.2) is the centrepiece**: the "why" at the moment Claude edits a file.
- **Map (v0.3): integrate, don't build.** No own engine; an installed MCP map engine is used, and JSPARK Forge adds
  freshness, schema from source files and links to decisions (spec 5.4). Estimate ~1 week instead of ~1–1½.
- **Database guard (new, v0.2.1, spec 5.2c):** production databases read-only unless `CONFIRM db-write`; MCP, Bash
  and PowerShell forms; `database dev:` line to relax. JSPARK Forge never reads or connects to a database.
- **Build graph (v0.4): only if users ask.**
- Risks: "Anthropic absorbs features" names resume and memory and states the durable edge (hard safety rules,
  guest-repo protection, decisions tied to files); new row "building ahead of real demand".
**Why [owner, 2026-11-20]:** a global product review: win by doing a few things nobody else does; code maps and
multi-agent runs are crowded or likely to be absorbed by the platform; zero users so far.

### Rev 12: UI/UX companions in v0.2 (2026-11-20)
**What:** new spec 5.14. JSPARK Forge builds no UI tooling; it recommends the best existing pieces: Anthropic's
frontend-design skill (listed in the JSPARK Forge marketplace as a recommended companion, not a dependency), Playwright
MCP (Claude checks its own UI in the running app), shadcn/ui with its MCP server, and a brand skill per product. A
one-time tip in projects with a front end; nothing installed automatically. Each companion's licence, activity and
Windows support checked before listing. Release table: v0.2, ~½ day.
**Why [owner, 2026-11-20]:** "I want the UI UX build through JSPARK Forge top notch for any product."

### Rev 13: the owner is the first user; build continues to v0.3 (2026-11-20)
**What:** the real-users gate of Rev 11 becomes a first-user gate: the owner uses each release on real work before the
next one starts. Scope "complete" = through v0.3 (decision memory, templates, UI/UX companions, database guard, code
map, launch-scope guard); v0.4 is decided after v0.3 is in use. The outside launch (20–50 users) follows v0.3.
v0.1.1 released the same day.
**Why [owner, 2026-11-20]:** "I am the first user, so I need a complete product."

### Rev 14: model map in v0.2 (2026-11-20)
**What:** new spec 5.15. JSPARK Forge ships four helper agents pinned to model tiers with a visible reason: planner and
reviewer on the strongest model, builder on a standard one, checker on a light one. Tiers, not model names; built with
the 5.11 templates; works beside superpowers. The model-choice advice of 5.7 made concrete. ~1 day.
**Why [owner, 2026-11-20]:** "do we have built the decision tree which model will do what and why?" (it was advice
only, in a later section).

### Rev 15: v0.2, v0.3 and v0.4 built in one day; the UI path from research (2026-11-20)
**What:** the owner asked to keep building past "complete" and to defer every manual check to the end of the roadmap.
- **v0.2** built and reviewed: decision memory, database guard, model map, templates and lint, licence check, UI tip.
- **v0.3** built and reviewed: the code map on codebase-memory-mcp (Windows trial; spikes F and G), the SQL schema
  reader, the launch-scope guard.
- **v0.4** built and reviewed: the build graph (spikes I, J, K); enforcement stated honestly as enforced / evidence /
  guarded / instructed after the code review showed what a shell-controlling AI can reach around.
- **UI path completed** after open-source research (`ui-research.md`): brand-skill template, `ui` build graph with
  screenshot, accessibility and Lighthouse gates, Chrome DevTools MCP in the tip.
- Every release went through a Fable 5.2 design review and code review before its fixes; CI on macOS and Linux caught
  two more (git's index lock, a test that misread zombie processes).
**Why [owner, 2026-11-20]:** "I am the first user, so I need a complete product"; "keep building, all the checks will
be done at the end of our roadmap"; "at least do some research for best in class open-source git repo for UI UX".

### Rev 16: v0.5.0, installs once and runs on its own; resume survives a crash (2026-11-20)
**What:** after the one install command, JSPARK Forge switches on auto-update, ships the code map and Playwright as plugin servers (pinned, started through a launcher with npx), adds frontend-design and Chrome DevTools once in the background, and the doctor reports each. Resume fixed for crashes: saves on every user message and once a minute, the log fills the gap after the last save, and a helper report can no longer grant a CONFIRM. Not released yet. No minimum Claude Code version (tested on 2.1.329).
**Why [owner]:** issue #7 (the manual steps after install), and resume failed in two projects.
