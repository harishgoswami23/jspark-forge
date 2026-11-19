#!/usr/bin/env node
// Spike B offline harness. Usage: node test-spike-b.js <sandbox-dir> [runs=100]
// Never touches the real ~/.claude: every case uses <sandbox>/<case>/settings.json and <sandbox>/<case>/home.
// Live-session rows (shell Claude Code really uses, project-level status line, npx, zsh) are NOT covered here.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const SANDBOX = path.resolve(process.argv[2]);
const RUNS = Number(process.argv[3] || 100);
const HERE = __dirname;
const GITBASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => fs.existsSync(p));
const fwd = p => p.replace(/\\/g, '/');

fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });
const proj = path.join(SANDBOX, 'project');
fs.mkdirSync(path.join(proj, '.jspark-forge'), { recursive: true });
const STDIN = JSON.stringify({
  session_id: 'spike-b-session', cwd: proj, model: { display_name: 'Opus' },
  workspace: { current_dir: proj, project_dir: proj },
  context_window: { used_percentage: 42.5 },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: 1795100000 }, seven_day: { used_percentage: 33, resets_at: 1795600000 } },
});

const scripts = path.join(SANDBOX, 'scripts');
fs.mkdirSync(scripts);
fs.writeFileSync(path.join(scripts, 'sl.sh'),
  '#!/bin/bash\ninput=$(cat)\nm=$(echo "$input" | grep -o \'"display_name":"[^"]*"\' | cut -d\'"\' -f4)\necho "[$m] ctx ok"\n');
fs.writeFileSync(path.join(scripts, 'sl.ps1'),
  '$j = [Console]::In.ReadToEnd() | ConvertFrom-Json\nWrite-Output "[$($j.model.display_name)] ps ok"\n');
fs.writeFileSync(path.join(scripts, 'hang.sh'), '#!/bin/bash\nsleep 5\necho late\n');

const CASES = [
  { name: 'none', statusLine: undefined },
  { name: 'bash-script', statusLine: { type: 'command', command: `bash ${fwd(path.join(scripts, 'sl.sh'))}` } },
  { name: 'inline-quotes', statusLine: { type: 'command', command: `input=$(cat); echo "dir: '$(echo "$input" | grep -o '"current_dir":"[^"]*"' | head -c 20)' // ok"` } },
  { name: 'powershell-file', statusLine: { type: 'command', command: `powershell -NoProfile -ExecutionPolicy Bypass -File ${fwd(path.join(scripts, 'sl.ps1'))}` } },
  { name: 'ansi-osc8-multiline', statusLine: { type: 'command', command: `printf '\\033[32mline one\\033[0m\\n\\033]8;;https://example.com\\033\\\\link\\033]8;;\\033\\\\ two\\n'` } },
  { name: 'padding-refresh', statusLine: { type: 'command', command: 'echo padded', padding: 2, refreshInterval: 10 } },
  { name: 'fails', statusLine: { type: 'command', command: 'exit 3' } },
  { name: 'hangs-5s', statusLine: { type: 'command', command: `bash ${fwd(path.join(scripts, 'hang.sh'))}` } },
];

function runDirect(cmd) {
  const t = process.hrtime.bigint();
  const r = spawnSync(GITBASH, ['-c', cmd], { input: STDIN, timeout: 10000, windowsHide: true });
  return { out: r.stdout || Buffer.alloc(0), code: r.status, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}
function runWrapper(wrapper) {
  const t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [wrapper], { input: STDIN, timeout: 10000, windowsHide: true });
  return { out: r.stdout || Buffer.alloc(0), ms: Number(process.hrtime.bigint() - t) / 1e6 };
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function stripNl(b) { if (b.length && b[b.length - 1] === 0x0a) return b.subarray(0, b[b.length - 2] === 0x0d ? -2 : -1); return b; }

const results = [];
for (const c of CASES) {
  const dir = path.join(SANDBOX, c.name);
  const home = path.join(dir, 'home');
  const settings = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  const base = { model: 'opus', env: { FOO: 'bar' } };
  if (c.statusLine) base.statusLine = c.statusLine;
  const beforeText = JSON.stringify(base, null, 2) + '\n';
  fs.writeFileSync(settings, beforeText);

  execFileSync(process.execPath, [path.join(HERE, 'install.js'), '--settings', settings, '--home', home]);
  const wrapper = path.join(home, 'statusline.js');
  const installed = JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine;

  const row = { case: c.name };
  const w = runWrapper(wrapper);
  if (c.statusLine && !['fails', 'hangs-5s'].includes(c.name)) {
    const d = runDirect(c.statusLine.command);
    const expected = Buffer.concat([stripNl(d.out), Buffer.from(' · Forge ok')]);
    row.identical = Buffer.compare(w.out, expected) === 0;
    const added = [];
    for (let i = 0; i < RUNS; i++) added.push(runWrapper(wrapper).ms - runDirect(c.statusLine.command).ms);
    row.added_median_ms = Math.round(pct(added, 0.5));
    row.added_p95_ms = Math.round(pct(added, 0.95));
  } else if (!c.statusLine) {
    row.identical = w.out.toString() === '· Forge ok';
    const tot = []; for (let i = 0; i < RUNS; i++) tot.push(runWrapper(wrapper).ms);
    row.added_median_ms = Math.round(pct(tot, 0.5)); row.added_p95_ms = Math.round(pct(tot, 0.95));
  } else {
    row.identical = w.out.toString() === '· Forge ok';
    row.wrapper_ms = Math.round(w.ms);
  }
  row.kept_padding_refresh = c.name === 'padding-refresh' ? (installed.padding === 2 && installed.refreshInterval === 10) : '';
  const usage = path.join(proj, '.jspark-forge', 'usage', 'spike-b-session.json');
  row.usage_file = fs.existsSync(usage) && JSON.parse(fs.readFileSync(usage, 'utf8')).five_hour_pct === 12;

  // "uninstall": the wrapper copy lives in home, so it must keep working with this harness folder unreachable.
  const moved = path.join(SANDBOX, `${c.name}-wrapper-only.js`);
  fs.copyFileSync(wrapper, moved);
  fs.copyFileSync(path.join(home, 'statusline.json'), path.join(SANDBOX, 'statusline.json'));
  row.after_uninstall = runWrapper(moved).out.length > 0;

  execFileSync(process.execPath, [path.join(HERE, 'install.js'), '--undo', '--settings', settings, '--home', home]);
  row.undo_byte_identical = fs.readFileSync(settings, 'utf8') === beforeText;
  results.push(row);
}

// Undo after the user edited another key since install: statusLine restored, the other edit kept.
{
  const dir = path.join(SANDBOX, 'edited-after-install');
  const home = path.join(dir, 'home');
  const settings = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo hi' } }, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(HERE, 'install.js'), '--settings', settings, '--home', home]);
  const s = JSON.parse(fs.readFileSync(settings, 'utf8')); s.theme = 'dark';
  fs.writeFileSync(settings, JSON.stringify(s, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(HERE, 'install.js'), '--undo', '--settings', settings, '--home', home]);
  const r = JSON.parse(fs.readFileSync(settings, 'utf8'));
  results.push({ case: 'edited-after-install', undo_byte_identical: 'n/a',
    identical: r.statusLine.command === 'echo hi' && r.theme === 'dark' });
}
console.table(results);
console.log(`node ${process.version}, Git Bash: ${GITBASH || 'none'}, runs per timing case: ${RUNS}`);
