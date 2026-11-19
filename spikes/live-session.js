#!/usr/bin/env node
// One interactive session that covers spike A (usage figures), the live rows of spike B (wrapper in a real session)
// and the interactive half of spike D (hook env in an attended session), plus builder checks B2 and B3.
// Usage (any shell):  node "<repo>/spikes/live-session.js"
// Writes only under ~/forge-spike/. Never edits ~/.claude/settings.json: the status line comes from --settings.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO_SPIKES = __dirname;
const ROOT = path.join(os.homedir(), 'forge-spike');
const PROJECT = path.join(ROOT, 'project');
const SLHOME = path.join(ROOT, 'sl-home');
const SETTINGS = path.join(ROOT, 'live-settings.json');
const fwd = p => p.replace(/\\/g, '/');

fs.mkdirSync(path.join(PROJECT, '.jspark-forge'), { recursive: true });
if (!fs.existsSync(path.join(PROJECT, '.git'))) {
  fs.writeFileSync(path.join(PROJECT, 'readme.txt'), 'forge spike project\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: PROJECT });
  execFileSync('git', ['add', '-A'], { cwd: PROJECT });
  execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', 'commit', '-qm', 'init'], { cwd: PROJECT });
}
fs.mkdirSync(SLHOME, { recursive: true });
fs.copyFileSync(path.join(REPO_SPIKES, 'statusline', 'wrapper.js'), path.join(SLHOME, 'statusline.js'));
fs.writeFileSync(path.join(SLHOME, 'statusline.json'), JSON.stringify({
  original: { type: 'command', command: `node "${fwd(path.join(REPO_SPIKES, 'probe-statusline.js'))}"` },
}, null, 2));
// --refresh <seconds>: spike A re-test with a status-line timer (owner 2026-11-19: 30 s).
const ri = process.argv.indexOf('--refresh');
const REFRESH = ri >= 0 ? Number(process.argv[ri + 1]) : null;
const statusLine = { type: 'command', command: `node "${fwd(path.join(SLHOME, 'statusline.js'))}"` };
if (REFRESH) statusLine.refreshInterval = REFRESH;
fs.writeFileSync(SETTINGS, JSON.stringify({ statusLine }, null, 2));

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const env = Object.assign({}, process.env, {
  FORGE_SPIKE_LOG: path.join(ROOT, `live-hooks-${stamp}.jsonl`),
  FORGE_SPIKE_STATUSLINE_LOG: path.join(ROOT, `live-statusline-${stamp}.jsonl`),
});

if (REFRESH) console.log(`
JSPARK Forge spike A re-test, status line refreshed every ${REFRESH} s  (logs: ${ROOT})
------------------------------------------------------------------
Please do these steps (about 6 minutes):
 1. Type:  say hi            then wait 2 minutes without typing.
 2. Type:  say hi again      then wait 2 minutes without typing.
 3. Type:  say bye
 4. Type:  /exit             and tell Claude in the main window you are done.
------------------------------------------------------------------
Starting Claude Code...
`);
else console.log(`
JSPARK Forge live spike session  (logs: ${ROOT})
------------------------------------------------------------------
Please do these steps, in order (about 8 minutes):

 1. At startup, note: do you see "forge-probe: SessionStart systemMessage (B2)"?
    Does the status line at the bottom read "probe · Forge ok"?
 2. Wait 60 seconds without typing.
 3. Paste this prompt:
      Create notes.txt with three short lines, commit it with git, then run the bash command "sleep 150", then run "echo done".
    (Approve the tool prompts.)
 4. When it has finished, type:   /compact
 5. Then paste:
      Answer yes or no for each: did you receive text containing FORGE-SESSIONSTART-CANARY? containing FORGE-PRECOMPACT-CANARY?
 6. Type:   /exit
 7. Back in the main Claude Code window, tell Claude your answers to step 1.
------------------------------------------------------------------
Starting Claude Code...
`);

const child = spawn('claude', ['--plugin-dir', path.join(REPO_SPIKES, 'probe-plugin'), '--settings', SETTINGS],
  { cwd: PROJECT, env, stdio: 'inherit' });
child.on('exit', code => {
  console.log(`\nSession ended (exit ${code}). Logs:\n  ${env.FORGE_SPIKE_LOG}\n  ${env.FORGE_SPIKE_STATUSLINE_LOG}`);
});
