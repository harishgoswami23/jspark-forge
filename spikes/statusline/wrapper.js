#!/usr/bin/env node
// Spike B status-line wrapper (throw-away; the real one is built in v0.1 step 6).
// 1. reads the status-line JSON on stdin
// 2. if <project>/.jspark-forge/ exists, writes usage/<session_id>.json atomically
// 3. runs the user's ORIGINAL status-line command (saved by install.js) with the same stdin, 2 s timeout
// 4. prints the original output unchanged, then " · Forge ok"; on failure/timeout prints only the suffix
// Config: FORGE_STATUSLINE_CONFIG (default: statusline.json next to this file) = {"original": <statusLine obj|null>}
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG = process.env.FORGE_STATUSLINE_CONFIG || path.join(__dirname, 'statusline.json');
const SUFFIX = ' · Forge ok';

function writeUsage(data) {
  try {
    const proj = (data.workspace && (data.workspace.project_dir || data.workspace.current_dir)) || data.cwd;
    if (!proj || !data.session_id) return;
    const dir = path.join(proj, '.jspark-forge', 'usage');
    if (!fs.existsSync(path.join(proj, '.jspark-forge'))) return;
    fs.mkdirSync(dir, { recursive: true });
    const rl = data.rate_limits || {};
    const n = v => (typeof v === 'number' ? v : null);
    const rec = {
      ts: Date.now(),
      context_pct: n(data.context_window && data.context_window.used_percentage),
      five_hour_pct: n(rl.five_hour && rl.five_hour.used_percentage),
      seven_day_pct: n(rl.seven_day && rl.seven_day.used_percentage),
      five_hour_resets_at: (rl.five_hour && rl.five_hour.resets_at) || null,
      seven_day_resets_at: (rl.seven_day && rl.seven_day.resets_at) || null,
    };
    const file = path.join(dir, `${data.session_id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec));
    for (let i = 0; i < 3; i++) { try { fs.renameSync(tmp, file); return; } catch (e) { if (i === 2) throw e; } }
  } catch { /* never break the status line */ }
}

function shellFor(cmd) {
  // Same shell Claude Code uses for status lines: Git Bash on Windows if present, else PowerShell; sh elsewhere.
  if (process.platform !== 'win32') return ['/bin/sh', ['-c', cmd]];
  const gitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH ||
    ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(p => fs.existsSync(p));
  if (gitBash) return [gitBash, ['-c', cmd]];
  return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]];
}

function runOriginal(cmd, stdin, done) {
  const [exe, args] = shellFor(cmd);
  let out = Buffer.alloc(0);
  let finished = false;
  const child = spawn(exe, args, { windowsHide: true });
  const killTree = () => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch {}
  };
  const timer = setTimeout(() => { if (!finished) { finished = true; killTree(); done(null); } }, 2000);
  child.stdout.on('data', d => { out = Buffer.concat([out, d]); });
  child.on('error', () => { if (!finished) { finished = true; clearTimeout(timer); done(null); } });
  child.on('close', code => { if (!finished) { finished = true; clearTimeout(timer); done(code === 0 ? out : null); } });
  child.stdin.on('error', () => {});
  child.stdin.end(stdin);
}

function main(raw) {
  let data = {};
  try { data = JSON.parse(raw.toString('utf8')); } catch {}
  writeUsage(data);
  let original = null;
  try { original = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).original; } catch {}
  const cmd = original && original.type === 'command' && original.command;
  // Exit as soon as the output is flushed: a hung original (or its grandchildren) must not hold the status line.
  const finish = buf => process.stdout.write(buf, () => process.exit(0));
  if (!cmd) { finish(SUFFIX.trim()); return; }
  runOriginal(cmd, raw, out => {
    if (out === null) { finish(SUFFIX.trim()); return; }
    // Strip one trailing newline so the suffix lands on the last line; everything else byte-identical.
    let body = out;
    if (body.length && body[body.length - 1] === 0x0a) body = body.subarray(0, body[body.length - 2] === 0x0d ? -2 : -1);
    finish(Buffer.concat([body, Buffer.from(SUFFIX)]));
  });
}

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => main(Buffer.concat(chunks)));
