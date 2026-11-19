#!/usr/bin/env node
'use strict';
// JSPARK Forge status-line wrapper (design 7.1). Installed as a COPY in ~/.claude/jspark-forge/statusline.js so it
// keeps working after plugin updates or removal (then it is a pure pass-through).
// 1. reads the status-line JSON on stdin;
// 2. if <project>/.jspark-forge/ exists, writes .jspark-forge/usage/<session_id>.json atomically (the usage bridge);
// 3. runs the user's ORIGINAL status-line command (saved next to this file) with the same stdin, 2 s timeout;
// 4. prints the original output unchanged, then " · JSPARK Forge saved 3m ago" (off with statusline-segment: off).
// Never breaks the status line: any error -> original output (or nothing).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG = path.join(__dirname, 'statusline.json');
const TIMEOUT_MS = 2000;

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Where JSPARK Forge keeps this project's files: the same rule as scripts/lib/paths.js (this copy cannot load it).
// Yours: <proj>/.jspark-forge with state/ or log/. Guest: guests/<id>/ next to this wrapper (~/.claude/jspark-forge/).
function normPath(p) {
  let r;
  try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); }
  r = r.replace(/\\/g, '/');
  if (r.length > 1 && !/^[a-zA-Z]:\/$/.test(r)) r = r.replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function gitDirOf(proj) {
  try {
    for (let d = path.resolve(proj); ; d = path.dirname(d)) {
      const g = path.join(d, '.git');
      if (fs.existsSync(g)) {
        if (!fs.statSync(g).isFile()) return g;
        const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
        return m ? path.resolve(d, m[1]) : null;
      }
      if (path.dirname(d) === d) return null;
    }
  } catch { return null; }
}
function forgeOf(proj) {
  const repo = path.join(proj, '.jspark-forge');
  const gitDir = gitDirOf(proj);
  const own = (isDir(path.join(repo, 'state')) || isDir(path.join(repo, 'log'))) &&
    (!gitDir || fs.existsSync(path.join(gitDir, 'jspark-forge-own'))); // a committed state/ proves nothing (paths.js isOwn)
  if (own) return { dir: repo, guest: false };
  const id = require('crypto').createHash('sha1').update(normPath(proj)).digest('hex').slice(0, 12);
  const g = path.join(__dirname, 'guests', id);
  return isDir(g) ? { dir: g, guest: true } : null;
}

function writeUsage(forge, data) {
  try {
    if (!data.session_id) return;
    const dir = path.join(forge.dir, 'usage');
    fs.mkdirSync(dir, { recursive: true });
    const rl = data.rate_limits || {};
    const rec = {
      ts: Date.now(),
      context_pct: num(data.context_window && data.context_window.used_percentage),
      five_hour_pct: num(rl.five_hour && rl.five_hour.used_percentage),
      seven_day_pct: num(rl.seven_day && rl.seven_day.used_percentage),
      five_hour_resets_at: (rl.five_hour && rl.five_hour.resets_at) || null,
      seven_day_resets_at: (rl.seven_day && rl.seven_day.resets_at) || null,
    };
    const file = path.join(dir, `${String(data.session_id).replace(/[^A-Za-z0-9-]/g, '')}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec));
    for (let i = 0; ; i++) { try { fs.renameSync(tmp, file); break; } catch (e) { if (i >= 3) throw e; } }
  } catch { /* never break the status line */ }
}

function segment(forge) {
  try { // a guest repo's rules.md is the repo author's file: not read
    const rules = forge.guest ? '' : fs.readFileSync(path.join(forge.dir, 'rules.md'), 'utf8');
    if (/^\s*[-*]\s*statusline-segment\s*:\s*off\s*$/im.test(rules)) return null;
  } catch { /* no rules.md: segment on */ }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(forge.dir, 'state', 'handoff.json'), 'utf8'));
    if (meta && meta.status === 'open' && meta.savedAt) {
      const s = Math.max(0, Math.floor((Date.now() - meta.savedAt) / 1000));
      const ago = s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 172800 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
      return `JSPARK Forge saved ${ago}`;
    }
  } catch { /* no handoff yet */ }
  return 'JSPARK Forge on';
}

function shellFor(cmd) {
  // The shell Claude Code uses for status lines: Git Bash on Windows if present, else PowerShell; sh elsewhere.
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
  let child;
  const finish = v => { if (!finished) { finished = true; done(v); } };
  try { child = spawn(exe, args, { windowsHide: true }); } catch { finish(null); return; }
  const timer = setTimeout(() => {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch {}
    finish(null);
  }, TIMEOUT_MS);
  child.stdout.on('data', d => { out = Buffer.concat([out, d]); });
  child.on('error', () => { clearTimeout(timer); finish(null); });
  child.on('close', code => { clearTimeout(timer); finish(code === 0 ? out : null); });
  child.stdin.on('error', () => {});
  child.stdin.end(stdin);
}

function main(raw) {
  // Exit as soon as the output is flushed: a hung original (or its grandchildren) must not hold the status line.
  const emit = buf => process.stdout.write(buf, () => process.exit(0));
  let data = {};
  try { data = JSON.parse(raw.toString('utf8')); } catch {}
  const proj = (data.workspace && (data.workspace.project_dir || data.workspace.current_dir)) || data.cwd || '';
  const forge = proj ? forgeOf(proj) : null;
  if (forge) writeUsage(forge, data);
  const seg = forge ? segment(forge) : null;
  let original = null;
  try { original = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).original; } catch {}
  const cmd = original && original.type === 'command' && original.command;
  if (!cmd) { emit(seg || ''); return; }
  runOriginal(cmd, raw, out => {
    if (out === null) { emit(seg || ''); return; }
    if (!seg) { emit(out); return; }
    let body = out; // strip one trailing newline so the note lands on the last line; all else byte-identical
    if (body.length && body[body.length - 1] === 0x0a) body = body.subarray(0, body[body.length - 2] === 0x0d ? -2 : -1);
    emit(Buffer.concat([body, Buffer.from(body.length ? ` · ${seg}` : seg)]));
  });
}

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => main(Buffer.concat(chunks)));
process.stdin.on('error', () => main(Buffer.alloc(0)));
