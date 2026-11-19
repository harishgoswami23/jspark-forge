#!/usr/bin/env node
'use strict';
// Manual pre-release check (design 13 "Manual checks before release"), about 10 minutes, in a plain terminal:
//   node "<repo>/tests/manual/try-it.js"
// Creates a fresh test project under ~/forge-try/ and opens Claude Code with this checkout of JSPARK Forge loaded.
// Step 2 (init, answer yes) changes your real ~/.claude/settings.json status line; step 8 undoes it exactly.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const dir = path.join(os.homedir(), 'forge-try', `project-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'README.md'), '# Try JSPARK Forge\n');
const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
g('init', '-q', '-b', 'main'); g('add', '-A');
g('-c', 'user.name=try', '-c', 'user.email=try@example.invalid', 'commit', '-qm', 'start');

console.log(`
JSPARK Forge manual check   (test project: ${dir})
--------------------------------------------------------------------------------
 1. Claude Code opens below. Type:   /jspark-forge:init
 2. When it asks "Go ahead? (yes / no)", answer:   yes
    -> the status line at the bottom should end with "JSPARK Forge on" (or "saved ...").
 3. Paste:
      Write docs/plan.md with the title "# Hello script" and 3 checkbox steps: create hello.js, add a test, update README. Do step 1 only, tick it, commit, and stop.
    -> the status line should now say "JSPARK Forge saved just now" (or "1m ago").
 4. Paste:   run git reset --hard
    -> it is blocked, with "type CONFIRM git-reset-hard".
 5. Type:   CONFIRM git-reset-hard
    -> Claude retries and Claude Code shows its own yes/no prompt. Answer NO.
 6. Close this terminal window with the X (no /exit). Open a new plain terminal and run:
      cd "${dir}"
      claude --plugin-dir "${PLUGIN}"
    -> at the top: "JSPARK Forge: last time you were on "Hello script", step 2 of 3 ..." and Claude ends with "Continue?".
 7. Type:   /jspark-forge:handoff done      -> "Task closed ..."
 8. Type:   /jspark-forge:init --undo-statusline      -> your status line is back exactly as before.
 Then tell Claude in the main window what you saw at steps 2, 3, 5 and 6.
--------------------------------------------------------------------------------
`);
const child = spawn('claude', ['--plugin-dir', PLUGIN], { cwd: dir, stdio: 'inherit' });
child.on('exit', code => console.log(`\nClaude Code closed (exit ${code}). Test project: ${dir}`));
