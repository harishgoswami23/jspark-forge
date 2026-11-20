'use strict';
// Detached runner (v0.5 design section 3): node companion-install.js <claude home> <companion name>...
// Runs `claude plugin install <id> --scope user` for each named companion from companions.LIST, one after the other, and records the result in
// <home>/jspark-forge/companions.json ({ name: { at, ok, reason } }, read-modify-write under a lock, atomic).
// No shell sees user text: the command is fixed text plus the fixed id. JSPARK_FORGE_COMPANION_CMD (a JSON array, the id
// is appended) replaces the command, for tests.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeAtomic } = require('./lib/fsx');
const memory = require('./lib/memory');
const companions = require('./lib/companions');

const LIMIT_MS = 120000;
let HOME = null; // the claude home, set by main()

function onPath(name) {
  const dirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) { if (!path.isAbsolute(d)) continue; const f = path.join(d, name); try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } }
  return null;
}

// -> { result } (a spawnSync result) or { reason } when claude cannot be found
function run(id) {
  // cwd is the claude home (never the folder the session was in) and Windows may not look in it for programs (review S8)
  const opts = { encoding: 'utf8', timeout: LIMIT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    cwd: HOME || undefined, env: Object.assign({}, process.env, { NoDefaultCurrentDirectoryInExePath: '1' }) };
  let override = null;
  try {
    const o = JSON.parse(process.env.JSPARK_FORGE_COMPANION_CMD || 'null');
    if (Array.isArray(o) && o.length && o.every(x => typeof x === 'string')) override = o;
  } catch { /* ignore a bad override */ }
  if (override) return { result: spawnSync(override[0], [...override.slice(1), id], opts) };
  const args = ['plugin', 'install', id, '--scope', 'user'];
  if (process.platform !== 'win32') return { result: spawnSync('claude', args, opts) };
  const exe = onPath('claude.exe');
  if (exe) return { result: spawnSync(exe, args, opts) };
  const cmd = onPath('claude.cmd');
  if (!cmd) return { reason: 'claude was not found on PATH' };
  // claude.cmd needs cmd.exe. Fixed text only: the path found on PATH, the fixed arguments and the fixed id.
  const line = `""${cmd}" ${args.join(' ')}"`;
  return { result: spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], Object.assign({ windowsVerbatimArguments: true }, opts)) };
}

function outcome(id) {
  const r = run(id);
  if (r.reason) return { ok: false, reason: r.reason };
  const res = r.result;
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return { ok: false, reason: `timed out after ${LIMIT_MS / 1000} s` };
    return { ok: false, reason: res.error.code === 'ENOENT' ? 'claude was not found' : `could not start: ${res.error.code || res.error.message}` };
  }
  if (res.status === 0) return { ok: true, reason: '' };
  const tail = String(res.stderr || res.stdout || '').trim().split(/\r?\n/).pop().slice(0, 200);
  return { ok: false, reason: `exit code ${res.status}${tail ? `: ${tail}` : ''}` };
}

function recordOne(home, name) {
  const c = companions.LIST.find(x => x.name === name);
  if (!c) return;
  let o;
  try { o = outcome(c.id); } catch (e) { o = { ok: false, reason: `could not start: ${e && e.message}` }; }
  const file = path.join(home, 'jspark-forge', 'companions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  memory.withLock(file, () => {
    let cur = {};
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) cur = j; } catch { /* none yet */ }
    cur[name] = { at: new Date().toISOString(), ok: o.ok, reason: o.reason };
    writeAtomic(file, JSON.stringify(cur, null, 2) + '\n');
  });
}

function main(home, ...names) {
  if (!home) return;
  try { fs.mkdirSync(home, { recursive: true }); } catch { /* the install then reports it */ }
  HOME = home;
  for (const name of names) { try { recordOne(home, name); } catch { /* the next one still runs */ } }
}

if (require.main === module) { try { main(process.argv[2], ...process.argv.slice(3)); } catch { /* nothing to tell */ } }
module.exports = { main, onPath };
