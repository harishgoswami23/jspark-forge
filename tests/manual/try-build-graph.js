#!/usr/bin/env node
'use strict';
// First-user check for v0.4 (build graph), about 5 minutes, in a plain terminal:
//   node "<repo>/tests/manual/try-build-graph.js"
// Opens Claude Code in a fresh test project holding a small graph: a checker helper step, a step that needs you, and a
// check (gate). Never changes ~/.claude/settings.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const fwd = p => p.replace(/\\/g, '/');
const dir = path.join(os.homedir(), 'forge-try', `build-graph-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const GRAPH = `# Graph: tiny
## look (agent)
- helper: checker
- gives: readme_path

## approve (human)
- after: look
- say: Check that the readme path is right and reply DONE approve.

## gate (gate)
- after: approve
- run: node --version
`;
fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
fs.writeFileSync(path.join(dir, 'README.md'), '# Try the build graph\n');
fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'tiny.md'), GRAPH);
const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
g('init', '-q', '-b', 'main'); g('add', '-A');
g('-c', 'user.name=try', '-c', 'user.email=try@example.invalid', 'commit', '-qm', 'start');
const settings = path.join(os.homedir(), 'forge-try', 'build-graph-settings.json');
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command',
  command: `node "${fwd(path.join(PLUGIN, 'scripts', 'statusline', 'wrapper.js'))}"`, refreshInterval: 30 } }, null, 2));

console.log(`
JSPARK Forge v0.4 check   (test project: ${dir})
--------------------------------------------------------------------------------
 1. Type:   /jspark-forge:build tiny
    -> it shows the one command the graph runs (node --version) and asks you to trust it.
 2. Type exactly:   TRUST GRAPH tiny
    -> "you trusted build graph tiny's commands". Then type:   go on
 3. Claude runs the look step with the checker helper, then stops at the approve step and shows its instruction.
 4. Type exactly:   DONE approve
    -> "approve done (your reply)". Then type:   go on
 5. Claude runs the gate (node --version); the graph says it finished. Type:   /jspark-forge:build tiny
    and ask for the status: every step done, with the minutes and tokens of the helper step.
 6. Type /exit and tell Claude in the other window what you saw.
--------------------------------------------------------------------------------
`);
const child = spawn('claude', ['--plugin-dir', PLUGIN, '--settings', settings], { cwd: dir, stdio: 'inherit',
  env: Object.assign({}, process.env, { JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
child.on('exit', code => process.exit(code || 0));
