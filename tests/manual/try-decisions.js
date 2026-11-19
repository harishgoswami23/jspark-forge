#!/usr/bin/env node
'use strict';
// First-user check for decision memory (v0.2), about 5 minutes, in a plain terminal:
//   node "<repo>/tests/manual/try-decisions.js"
// Opens Claude Code in a fresh test project with this checkout of JSPARK Forge and its status line (from a settings
// file next to the test projects; ~/.claude/settings.json is never changed).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const fwd = p => p.replace(/\\/g, '/');
const dir = path.join(os.homedir(), 'forge-try', `decisions-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'README.md'), '# Try decision memory\n');
fs.writeFileSync(path.join(dir, 'src', 'checkout.js'), "const { price } = require('./price');\nmodule.exports = qty => price * qty;\n");
const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
g('init', '-q', '-b', 'main'); g('add', '-A');
g('-c', 'user.name=try', '-c', 'user.email=try@example.invalid', 'commit', '-qm', 'start');

console.log(`
JSPARK Forge decision memory check   (test project: ${dir})
--------------------------------------------------------------------------------
 1. Claude Code opens below. Paste:
      Create src/price.js exporting price = 1999, stored in whole cents as an integer so totals never round wrong. Commit it with the message "Store prices in cents".
    -> at the end of its reply Claude offers: Record the decision? "...". Answer:   yes
    -> you see "JSPARK Forge recorded D-001: ..." (in the conversation or the system line).
 2. Paste:
      The starter plan now costs 24.50 dollars. Update src/price.js.
    -> Claude keeps cents (2450) or stops and asks. It should mention the decision.
 3. Type:   /jspark-forge:decisions     -> D-001 is listed with the file it touches.
 4. Type:   /jspark-forge:check         -> "All 1 decision looks fine" (or a short list).
 5. Type /exit, open a new terminal and run Claude Code in the same folder:
      cd "${fwd(dir)}" && claude --plugin-dir "${fwd(PLUGIN)}"
    -> the session starts with the project notes index (D-001 ...), shown to Claude, not to you.
 6. Tell Claude in the other window what you saw, or paste anything that looked wrong.
--------------------------------------------------------------------------------
`);
const settings = path.join(os.homedir(), 'forge-try', 'decisions-settings.json');
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command',
  command: `node "${fwd(path.join(PLUGIN, 'scripts', 'statusline', 'wrapper.js'))}"`, refreshInterval: 30 } }, null, 2));
const child = spawn('claude', ['--plugin-dir', PLUGIN, '--settings', settings], { cwd: dir, stdio: 'inherit',
  env: Object.assign({}, process.env, { JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
child.on('exit', code => process.exit(code || 0));
