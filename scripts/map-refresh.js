#!/usr/bin/env node
'use strict';
// JSPARK Forge code map refresh (design-v0.3 1.2), started detached by a hook: `node map-refresh.js <project>`.
// One at a time per project (a lock created with 'wx'); reads the full HEAD before indexing and records it only when the
// engine exits 0; a trigger while it runs sets `pending` and it runs once more; a hard timeout kills the engine's process
// tree; failures are recorded with a back-off (1, 5, 30 minutes). Never prompts, never prints except to a direct caller.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const map = require('./lib/map');
const paths = require('./lib/paths');

const HARD_TIMEOUT_MS = 3 * 60 * 1000;
const dir = path.resolve(process.argv[2] || process.cwd());

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; } }
function killTree(pid) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

function takeLock() {
  const lock = map.lockFile(dir);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return true;
    } catch {
      let info = {};
      try { info = JSON.parse(fs.readFileSync(lock, 'utf8')) || {}; } catch { /* half-written */ }
      const stale = !info.pid || !alive(info.pid) || Date.now() - (info.at || 0) > HARD_TIMEOUT_MS + 30000;
      if (!stale) return false;
      if (info.pid && alive(info.pid)) killTree(info.pid);
      try { fs.unlinkSync(lock); } catch { /* raced */ }
    }
  }
  return false;
}
const releaseLock = () => { try { fs.unlinkSync(map.lockFile(dir)); } catch { /* gone */ } };

function runOnce() {
  return new Promise(resolve => {
    const sha = map.headSha(dir); // read before indexing: the commit the index is based on (review H2)
    const [cmd, ...pre] = map.engineCmd();
    let child;
    try {
      child = spawn(cmd, [...pre, 'cli', '--quiet', 'index_repository', JSON.stringify({ repo_path: paths.repoRoot(dir).replace(/\\/g, '/') })],
        { cwd: dir, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) { resolve({ ok: false, error: `engine not started: ${e.message}` }); return; }
    const timer = setTimeout(() => { killTree(child.pid); }, HARD_TIMEOUT_MS);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: `engine not found or not started (${e.code || e.message})` }); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true, sha } : { ok: false, error: signal ? `engine stopped (${signal}, timeout?)` : `engine failed (exit ${code})` });
    });
  });
}

async function main() {
  if (!takeLock()) {
    map.updateState(dir, s => { s.pending = true; });
    process.stdout.write('A code map refresh is already running; it will run once more when it finishes.\n');
    return;
  }
  try {
    for (let round = 0; round < 3; round++) {
      map.updateState(dir, s => { s.pending = false; });
      const r = await runOnce();
      map.updateState(dir, s => {
        if (r.ok) { s.sha = r.sha; s.indexedAt = Date.now(); s.lastError = null; s.failures = 0; s.nextTryAt = 0; }
        else {
          s.failures = (s.failures || 0) + 1;
          s.lastError = r.error;
          s.nextTryAt = Date.now() + map.BACKOFF_MIN[Math.min(s.failures, map.BACKOFF_MIN.length) - 1] * 60000;
        }
      });
      if (!r.ok || !map.readState(dir).pending) break;
    }
  } finally { releaseLock(); }
  const st = map.readState(dir);
  process.stdout.write(st.lastError ? `Code map refresh failed: ${st.lastError}\n` : `Code map refreshed (as of ${String(st.sha).slice(0, 7)}).\n`);
}

main().catch(() => { releaseLock(); });
