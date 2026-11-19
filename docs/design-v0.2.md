# JSPARK Forge v0.2: design

Status: draft for review, 2026-11-20. Scope: v0.2 (spec 5.3 decision memory, 5.11 skill and brief templates, 5.14 UI/UX
companions) and v0.2.1 (5.2c database guard). This first part covers decision memory, the centrepiece; the other
sections follow before their build. Whole-product spec: [`spec.md`](spec.md); v0.1 and v0.1.1 designs:
[`design-v0.1.md`](design-v0.1.md), [`design-v0.1.1.md`](design-v0.1.1.md).

---

## 1. Decision memory: the "why" (spec 5.3)

**Goal** Claude does not break a past decision. A one-line decision, rule or lesson, with the files it touches, reaches
Claude just before it edits one of those files.

### 1.1 The file: `.jspark-forge/decisions.md`

Committed (shared with the team), human-readable, hand-editable. Format as spec 5.3:

```markdown
## D-012 Prices are stored in cents
- Kind: decision
- Why: avoids rounding errors in totals and refunds
- Decided by: you (drafted by Claude)
- Date: 2026-11-02 · Last verified: 2026-11-02
- Touches: src/billing/**, src/models/price.ts
- Source: commit 3f2e1d0 · plan docs/plans/billing.md
- Status: active
```

- **Kinds:** `decision`, `rule` (standing rule), `lesson` (from a mistake), `reference` (a pointer: `Touches:` says
  when it applies, `See:` names the file to read, e.g. `See: prisma/schema.prisma`).
- **Status:** `active`, `superseded by D-019`, `retired`. Only active entries are used.
- **Ids** `D-001` upward, never reused. The title line is the one line Claude sees.
- **Parsing is lenient:** unknown fields kept as they are; a malformed entry is skipped and reported once at session
  start with its line number (like `rules.md`). JSPARK Forge rewrites the file only through `forge.js decide`, which
  changes the one entry it was asked to and keeps every other byte.
- **Git:** the default `.jspark-forge/.gitignore` gains `!decisions.md`. A project whose `.gitignore` is exactly the
  v0.1 default gets the new line at session start; a hand-edited one is left alone (one-time tip).

### 1.2 Matching `Touches:`

Comma-separated paths and globs, relative to the repo top folder, forward slashes. `**` any depth, `*` within one
folder name, `?` one character; a plain folder (`src/billing` or `src/billing/`) covers everything under it. Case-
insensitive on Windows and macOS (as their file systems). Written in-house (about 40 lines, tested), no dependency.

### 1.3 Just in time (PreToolUse)

On Edit / Write / NotebookEdit, and on a shell command that writes files (the existing `writeTargets`), when the
target path matches an active entry's `Touches:` and the command is not blocked:

```
JSPARK Forge: decisions about src/billing/total.ts (follow them; if this change goes against one, stop and ask the user):
- D-012 Prices are stored in cents (why: avoids rounding errors in totals and refunds)
- D-020 Read prisma/schema.prisma before changing the data model (reference)
```

- At most **3 entries**, the most specific first (an exact path before a folder before `**`), then the newest.
- **Once per entry per session**, again after a compaction or when 30 minutes have passed (tracked in the session
  state): repeated edits to the same file do not repeat the same lines (principle 10, tokens).
- A reference entry injects only its pointer; the file is read when Claude needs it.
- Budget: one small file read and string matching; the 3 s PreToolUse limit is never at risk. Unreadable file →
  nothing injected (fail open), logged once.

### 1.4 Recording: prompted at a commit or an accepted plan, never silent

The hook points; Claude drafts; the user decides (principle 12).

- **When:** after a commit (PostToolUse, the existing commit detection); after a plan is accepted (PostToolUse on
  `ExitPlanMode`, **[spike E]** below); after a superpowers plan or design doc is written
  (`docs/superpowers/plans/*.md`, `docs/superpowers/specs/*.md`, any project; read defensively, principle 7).
- **How:** `additionalContext` tells Claude: *"Before your final reply ends, if this settled a choice worth keeping, add
  one line: Record the decision? "<your draft, ≤ 15 words>" (touches: <paths>) — yes / edit / skip. Default is yes. If
  it settled nothing (typo, formatting, version bump), add nothing."*
- **Why at the end of the reply, not at once:** asking mid-work stops autonomous runs (a superpowers plan commits after
  every task). The question lands in the reply's last line, so "Waiting on you" files it if the user does not answer
  (v0.1.1), and it survives a cutoff.
- **At most one question per reply**, batching up to 3 drafts ("Record these? 1. … 2. …") when several commits land
  in one turn. Tracked per session: commits since the last prompt.
- **Default yes:** "yes", "y", "ok" or an empty-ish confirmation records the draft; "edit …" records the edited line;
  "skip" or a new instruction records nothing.
- **Recorded by** `node forge.js decide "<line>" --touches "<globs>" [--kind rule] [--why "..."] [--source "commit
  3f2e1d0"]`. `Decided by: you (drafted by Claude)` when drafted, `you` when typed by hand.
- **Deviation from "every commit" [builder, for the owner]:** the prompt is offered at every commit, but Claude adds the
  question only when the commit settled something. Asking about a typo fix teaches people to say "skip" without
  reading. Owner to confirm (Q-D1).

### 1.5 Staleness

- **At a commit:** the files it changed (`git diff-tree --no-commit-id --name-only -r HEAD`, inside the hook's git
  budget) are matched against active entries. A match not flagged today adds: *"D-012 may be stale: this commit
  changed src/billing/total.ts. At the end of your reply ask: still valid? (yes / update / retire)"*. At most once per
  entry per day (state file).
- **Answers:** yes → `forge.js decide --verify D-012` (Last verified = today); update → `--update D-012 "<line>"`;
  retire → `--retire D-012 [--by D-019]`.
- **No `Touches:`:** at session start, an active entry without `Touches:` whose Last verified is over 30 days old is
  listed once with "still valid?".
- **Globs that match nothing:** checked at session start at most once a day (`git ls-files`, inside the git budget),
  listed with the entry id.

### 1.6 Session start

- An index of active entry titles, at most 150 words: *"Decisions on file: D-012 Prices are stored in cents; D-013 …
  Full entries arrive just before you edit the files they touch."* Over 150 words → the newest titles, then "(and 14
  more: /jspark-forge:decisions)".
- Parse errors, stale flags (no touches, globs matching nothing) as one system-message line each.

### 1.7 Commands

- **`/jspark-forge:decisions`**: lists active entries (id, title, touches), then counts: reference entries, long
  entries (> 80 words), knowledge-base requests declined. Retired and superseded only on request.
- **`/jspark-forge:decide "<line>"`**: adds one by hand; the skill asks only for what is missing (touches, kind).
- **`/jspark-forge:check`** ("is my memory still true?"): `forge.js check` lists, read-only:
  - missing or renamed paths;
  - globs that match nothing;
  - entries whose touched files changed since Last verified (`git log --since`);
  - entries without `Touches:` older than 30 days.

  Each comes with "still valid? / update / retire". Changes happen only through `forge.js decide` after the user
  answers.
- **Long entries:** an entry over ~80 words is accepted; the first time, one line suggests a reference entry instead.
  Never blocked.
- **Knowledge-base requests:** when the user asks to store large documents or "a knowledge base" in decisions, the
  skill runs `forge.js decisions --kb-request "<one line>"` (local count in `state/declined.json`, revisit at 500
  users) and explains decisions stay one line each.

### 1.8 External code (spec 5.2b)

- **Guest repos: decision memory is off.** The repo's own `decisions.md` is someone else's text: never injected (it
  would be instructions from a stranger), never written.
- **Migration mappings** are ordinary decisions with both paths in `Touches:` (*"sessions: legacy/session.php →
  src/auth.ts, cookie format kept"*); the decide skill offers that shape when a read-only source exists.
- **Licence check:** at the first session in a guest repo and for each read-only source, one file read (`LICENSE*`,
  `COPYING*`, the `license` field of `package.json`) classified in plain words: permissive (MIT, Apache-2.0, BSD,
  ISC), copyleft (GPL, AGPL, LGPL, MPL), non-commercial (CC-BY-NC, PolyForm Noncommercial, BSL), or none found
  ("all rights reserved by default"). Shown once per repo or source; a hint, not legal advice.

### 1.9 State

`state/decisions.json` (local): flags raised per entry per day, injections per session, long-entry warnings given,
the glob check date. Never committed.

### 1.10 Spike E (before building 1.4's plan trigger)

Does PostToolUse fire for `ExitPlanMode` when the user approves a plan, and what does its input hold? Run interactively
once (headless runs cannot approve a plan). If it does not fire, the plan trigger is only the superpowers plan or
spec file, and the spec's "plan-mode exit" becomes a known gap.

### 1.11 Tests

- Parser and writer: round trip keeps every byte except the changed entry; malformed entries reported with line
  numbers; ids never reused.
- Glob matching: ≥ 30 cases (`**`, `*`, folders, case rules per platform, Windows backslashes).
- PreToolUse: a touched path injects ≤ 3 lines, most specific first; once per session; again after compaction or 30
  minutes; a reference injects only its pointer; a blocked command injects nothing; guest repos inject nothing.
- PostToolUse: commit → the record prompt (one per reply, batched); a stale flag once per entry per day; superpowers
  plan or spec written → the prompt; superpowers absent or reshaped → nothing breaks.
- `forge.js decide`: add, verify, update, retire (with supersede), long-entry warning once; `check` changes nothing.
- Licence classification on ≥ 10 real licence texts.
- Integration (real Claude, headless): an edit to a touched file shows the decision in Claude's reply ("I kept prices
  in cents"); a commit ends the reply with "Record the decision?".

### 1.12 Open questions for the owner

- **Q-D1:** the record prompt only when a commit settled something (1.4), instead of literally every commit?
- **Q-D2:** should `decisions.md` be committed by default (shared with a team) or kept local like the handoff?
  Recommendation: committed, as the spec says; a solo founder loses nothing, and a cloned project keeps its "why".
