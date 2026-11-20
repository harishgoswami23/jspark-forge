# JSPARK Forge v0.5: installs once, runs on its own

Status: draft for the owner's approval (2026-11-20). Fixes issue #7.

## Why

The owner used v0.4.2 as an end user (Windows) and hit too many manual steps: PowerShell commands pasted to install
and start things, then a trip to `/plugin` → Marketplaces to switch on auto-update. Issue #7: the code map was
silently off (codebase-memory-mcp never installed) while `/jspark-forge:doctor` said `8 ok, 0 to fix`.

Owner's rule: **after the one install command, JSPARK Forge must set itself up and keep itself running.**

## Goals

1. One install step, typed inside Claude Code. No PowerShell, no `/plugin` menus, no other commands.
2. Auto-update switches on by itself.
3. The code map works without a separate install (issue #7).
4. The UI companions arrive with JSPARK Forge instead of as a tip with four install lines.
5. The doctor reports every piece above: on, or off with the one fix.
6. The README install section is one command plus what JSPARK Forge set up and how to undo each.

## Non-goals

- Installing Node.js or Git (JSPARK Forge needs Node to run at all; it keeps saying so at start).
- The Anthropic directory listing (separate launch task).
- Wrapping a user's own existing status line without asking (stays opt-in via `/jspark-forge:init`, as decided earlier).

## Anti-goals (a failure even if it works)

- Re-enabling something the user switched off (auto-update, a companion, the code map). One automatic switch-on,
  never again after that.
- Touching `settings.json` when it is not valid JSON, or rewriting anything in it beyond the one key.
- A slower session start: nothing downloads inside a hook; hooks keep their current time limits.
- Silent failure: if a piece cannot be set up, the doctor and one start message say so with the fix.

## Approaches (owner picked A, 2026-11-20)

- **A. Self-setup at first start (picked).** One `/plugin install` command; JSPARK Forge switches on auto-update,
  ships the code map and companions as plugin parts, and the doctor checks all of it. Trade-off: JSPARK Forge now
  adds other programs and changes one Claude Code setting, so the README's "never installs anything" promise is
  replaced by an exact list of what it adds and how to remove each.
- B. One PowerShell install line doing everything. Rejected: still a PowerShell step, which is what the owner wants gone.
- C. Better tips and doctor lines only. Rejected: fixes #7's silence but leaves every manual step.

## Design

### 1. Auto-update on by itself

- At SessionStart (machine messages, once per machine, state flag `autoUpdateSet`), when JSPARK Forge was installed
  from the `jspark-forge` marketplace (entry in `plugins/known_marketplaces.json`) and auto-update is not already on:
  set `extraKnownMarketplaces["jspark-forge"].autoUpdate = true` in `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json`
  (documented: code.claude.com/docs/en/plugins/loading.md, "Which marketplaces and plugins auto-update", settings
  entry wins). Add the `source` (`{"source":"github","repo":"harishgoswami23/jspark-forge"}`) only when the entry
  does not exist.
- Never when: the settings entry already has `autoUpdate` set to anything, or `known_marketplaces.json` has
  `autoUpdate: false` for jspark-forge (the `/plugin` toggle writes there; either = the user decided). Having seen
  the v0.4.2 tip does not count as a decision (the owner's own goal is auto-update on);
  settings.json exists but is not valid JSON; the flag says it was done before. Write with the same safe
  read-modify-write the status line install uses (keep every other key and the formatting style).
- One start line: "JSPARK Forge switched on its own auto-update; new versions load when Claude Code starts. Undo:
  /plugin → Marketplaces → jspark-forge." Replaces the v0.4.2 tip.

### 2. Code map ships with the plugin (issue #7)

- Plugin `.mcp.json` declares a `codebase-memory` stdio server started through a small launcher,
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/mcp/run.js codebase-memory`, which runs the pinned npm package
  `codebase-memory-mcp@0.12.1` (MIT; its postinstall downloads the native binary) via npx in a cross-platform way
  (Windows needs `npx.cmd`/shell handling). Pinned version, bumped deliberately like the other pins.
- Claude Code starts it when the plugin is enabled. First start downloads the binary (outside any hook).
- `map.js`: tool names become `mcp__plugin_jspark-forge_codebase-memory__…`; the engine regex already matches
  (verify). The background refresh must find the engine without PATH: resolve the binary the launcher used (the
  launcher records its path in machine state) before falling back to PATH. `JSPARK_FORGE_MAP_CMD` and
  `forge.js map engine` keep working.
- If the user already has codebase-memory-mcp as their own MCP server, the map would see two engines: the doctor
  says so once and names which one to remove (like the superpowers duplicate note).
- The "add codebase-memory-mcp" tip goes away (it is installed).
- Known risk to document: the project's own page notes a Windows Defender false positive on its binary.

### 3. UI companions with the plugin

- **frontend-design** and **chrome-devtools-mcp** (both in `claude-plugins-official`): installed **once** by JSPARK
  Forge, not declared as dependencies (builder check: a disabled dependency stops JSPARK Forge itself from loading,
  and auto-update reinstalls removed dependencies; both break the anti-goal). At SessionStart, once per machine
  (state flag per companion), when the companion is not installed: start `claude plugin install
  <name>@claude-plugins-official` detached in the background (never waits inside the hook); one start line says it
  is being added and loads at the next start. Never again after that flag, so a removed companion stays removed.
  Failure is recorded and shown by the doctor.
- **Playwright MCP**: a second `.mcp.json` server via the same launcher, pinned `@playwright/mcp@0.0.86`.
- **Off switches** for the bundled servers, under `## Settings` in `rules.md`: `- code-map: off`,
  `- playwright: off`; and machine-wide `JSPARK_FORGE_CODE_MAP=off` / `JSPARK_FORGE_PLAYWRIGHT=off`. When off, the
  launcher starts a server with no tools (no error in `/mcp`), and the doctor says "off by your choice". Playwright
  serves tools only in projects with a front end (same detection as `uitip.js`); elsewhere it starts with no tools.
  The code map server runs in guest repos too (read-only indexing), but the map layer stays off there as today.
- **shadcn MCP** stays a one-time tip in React projects only: it is per project and writes the project's config,
  which an automatic setup must not do. (Builder's call to confirm; owner can override.)
- `uitip.js` names only what is still missing (normally just shadcn in React projects).

### 4. Doctor

New lines, each `ok` or `FIX` with the fix:
- Auto-update: on / off (fix: the undo path in reverse, or "JSPARK Forge switches it on at next start").
- Code map: engine reachable (launcher found the binary) / not (fix: restart Claude Code; if it stays, the reason the
  launcher recorded, e.g. no network or antivirus quarantine).
- Companions: frontend-design and chrome-devtools installed / which is missing (fix: `/plugin install …`).
- Duplicate engines or duplicate companions, when present.
Issue #7's case (map missing) must now produce a FIX line, never `ok`.

### 5. README and docs

- Install: the one `/plugin install` command, then a short list "On first start JSPARK Forge sets up: auto-update,
  the code map, frontend-design, Chrome DevTools, Playwright, its status line (if you have none)", each with its undo.
- Drop "turn on updates, once" and "JSPARK Forge never installs it"; Building a UI section lists only shadcn as manual.
- Uninstall: add removing the dependencies (`claude plugin prune`).
- Release notes v0.5.0; close #7 from the release PR.

### 6. Ship gate: CI integration (found 2026-11-20)

The integration job (first real run on the v0.4.2 push) failed on all three systems: no plugin hook fired under
`claude -p --plugin-dir` in CI, while the same test passes locally on the same Claude Code (2.1.329). v0.5 does not
release until this is understood and green. First step: print `system/init` `plugins` and `plugin_errors` in the
integration job (documented: headless.md, "Fail CI when a plugin or MCP server doesn't load").

### 7. Minimum Claude Code version

v0.5 needs a Claude Code that loads plugin `.mcp.json` servers and the `extraKnownMarketplaces.autoUpdate` setting.
The builder finds the lowest such version from the Claude Code changelog; the README states it (replacing the
"older than 2.1.275" line), and the doctor checks `claude --version` against it (FIX: update Claude Code).

## Left to the builder

- Exact launcher code and how it records the engine path; Windows npx handling.
- Whether `${CLAUDE_PLUGIN_ROOT}` substitution in `.mcp.json` args works as documented (verify with a real run).
- Test layout: unit tests for the settings write (all "never when" cases), doctor lines, map engine resolution;
  integration test that the bundled server loads (`plugin_errors` empty).
- Version 0.5.0 in plugin.json and package.json.

## Owner checks at the end (batched)

- Fresh install on Windows with one command: no PowerShell, auto-update shows on in `/plugin`, the doctor is all ok,
  "where is X" uses the code map.
