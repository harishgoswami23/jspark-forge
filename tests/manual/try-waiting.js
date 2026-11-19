#!/usr/bin/env node
'use strict';
// Manual pre-release check for "Waiting on you" (design-v0.1.1 section 4), about 2 minutes, in a plain terminal:
//   node "<repo>/tests/manual/try-waiting.js"            first run: makes a test project and opens Claude Code
//   node "<repo>/tests/manual/try-waiting.js" <folder>   second run: reopens that project
// Loads this checkout of JSPARK Forge with --plugin-dir and shows its status line through --settings, so the real
// ~/.claude/settings.json is never changed (automatic status-line setup is switched off for these runs).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const fwd = p => p.replace(/\\/g, '/');
let dir = process.argv[2] && path.resolve(process.argv[2]);
const reopen = !!dir;
if (!dir) {
  dir = path.join(os.homedir(), 'forge-try', `waiting-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Try waiting on you\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('add', '-A');
  g('-c', 'user.name=try', '-c', 'user.email=try@example.invalid', 'commit', '-qm', 'start');
}
const me = fwd(path.join(PLUGIN, 'tests', 'manual', 'try-waiting.js'));

console.log(reopen ? `
JSPARK Forge "waiting on you" check, part 2   (project: ${dir})
--------------------------------------------------------------------------------
 4. Claude Code opens below. Check, before typing anything:
    -> the first message lists "Waiting on you (1)" with the button-colour question;
    -> the status line at the bottom shows "⏳ 1 waiting on you · oldest 1m" (it may take up to 30 seconds).
 5. Type:   /jspark-forge:waiting
    -> it lists the question with "recommended: Blue". Answer:   go with recommendations
    -> Claude clears it; within 30 seconds the "⏳" note disappears from the status line.
 6. Type /exit. Tell Claude in the other window what you saw (or paste anything that looked wrong).
--------------------------------------------------------------------------------
` : `
JSPARK Forge "waiting on you" check, part 1   (project: ${dir})
--------------------------------------------------------------------------------
 1. Claude Code opens below. Paste:
      Use the AskUserQuestion tool to ask me which colour the button should be: Red or Blue (Recommended).
 2. When the question box appears, do NOT answer it. Close this terminal window (the X button), so the
    session is cut off while the question is open.
 3. Open a new terminal and run:
      node "${me}" "${fwd(dir)}"
--------------------------------------------------------------------------------
`);

// The status line for these runs only, from a settings file next to the test projects (not ~/.claude/settings.json).
const settings = path.join(os.homedir(), 'forge-try', 'waiting-settings.json');
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command',
  command: `node "${fwd(path.join(PLUGIN, 'scripts', 'statusline', 'wrapper.js'))}"`, refreshInterval: 30 } }, null, 2));
const child = spawn('claude', ['--plugin-dir', PLUGIN, '--settings', settings], { cwd: dir, stdio: 'inherit',
  env: Object.assign({}, process.env, { JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
child.on('exit', code => process.exit(code || 0));
