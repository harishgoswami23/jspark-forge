#!/usr/bin/env node
'use strict';
// Spike E (design-v0.2 1.10): does PostToolUse fire for ExitPlanMode when the user approves a plan, and what does its
// input hold? About 2 minutes, in a plain terminal:  node "<repo>/tests/manual/spike-e.js"
// Opens Claude Code in a fresh test project with only the spike probe plugin (it logs every hook call to a file and
// changes nothing). Never touches ~/.claude/settings.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PROBE = path.resolve(__dirname, '..', '..', 'spikes', 'probe-plugin');
const dir = path.join(os.homedir(), 'forge-try', `spike-e-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'README.md'), '# Spike E\n');
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
const log = path.join(dir, 'hooks.jsonl');

console.log(`
JSPARK Forge spike E   (test project: ${dir})
--------------------------------------------------------------------------------
 1. Claude Code opens below. Press Shift+Tab until the bottom line says "plan mode".
 2. Paste:   Plan how to add a hello.txt file containing "hi". Keep the plan to two steps.
 3. When Claude shows the plan and asks to proceed, choose the option that APPROVES it (yes / auto-accept).
 4. Let it finish (it may create hello.txt), then type /exit.
 5. Tell Claude in the other window "spike E done". It reads ${log.replace(/\\/g, '/')}
--------------------------------------------------------------------------------
`);
const child = spawn('claude', ['--plugin-dir', PROBE], { cwd: dir, stdio: 'inherit',
  env: Object.assign({}, process.env, { FORGE_SPIKE_LOG: log }) });
child.on('exit', code => process.exit(code || 0));
