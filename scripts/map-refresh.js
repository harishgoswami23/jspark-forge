#!/usr/bin/env node
'use strict';
// JSPARK Forge code map refresh (design-v0.3 1.2), started detached by a hook: `node map-refresh.js <project>`.
// One at a time per project: a lock holding a random token, touched every few seconds while this runs; a lock not
// touched for 30 s is stale and taken over, and no process is ever killed by the pid in it (review H1). Results are
// written, and the lock removed, only while the lock still holds this runner's token (review M7). Reads the full HEAD
// before indexing and records it only when the engine exits 0; a trigger while it runs sets `pending` and it runs once
// more; a hard timeout kills the engine's process tree (only this runner's own child); failures are recorded with a
// back-off (1, 5, 30 minutes). Never prompts, never prints except to a direct caller.
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const map = require('./lib/map');
const paths = require('./lib/paths');

const HARD_TIMEOUT_MS = Number(process.env.JSPARK_FORGE_MAP_TIMEOUT_MS) > 0 ? Number(process.env.JSPARK_FORGE_MAP_TIMEOUT_MS) : 3 * 60 * 1000;
const dir = path.resolve(process.argv[2] || process.cwd());
const token = crypto.randomBytes(12).toString('hex');
let engine = null; // the engine child while it runs
let lost = false; // another runner took the lock over

function killTree(pid) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL'); // the engine is detached on POSIX: its own process group
  } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}
function killEngine() { const c = engine; engine = null; if (c && c.pid && c.exitCode === null && c.signalCode === null) killTree(c.pid); }

function runOnce() {
  return new Promise(resolve => {
    const sha = map.headSha(dir); // read before indexing: the commit the index is based on (review H2)
    if (!sha) { resolve({ ok: false, error: 'git could not read HEAD' }); return; }
    const [cmd, ...pre] = map.engineCmd(dir);
    let child;
    let timedOut = false;
    let done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    try {
      child = spawn(cmd, [...pre, 'cli', '--quiet', 'index_repository', JSON.stringify({ repo_path: paths.repoRoot(dir).replace(/\\/g, '/') })],
        { cwd: dir, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) { finish({ ok: false, error: `engine not started: ${e.message}` }); return; }
    engine = child;
    const timer = setTimeout(() => { timedOut = true; killEngine(); }, HARD_TIMEOUT_MS);
    child.on('error', e => { clearTimeout(timer); if (engine === child) engine = null; finish({ ok: false, error: `engine not found or not started (${e.code || e.message})` }); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (engine === child) engine = null;
      if (timedOut) finish({ ok: false, error: `engine timed out after ${Math.round(HARD_TIMEOUT_MS / 1000)} s` });
      else if (lost) finish({ ok: false, error: 'stopped: another refresh took over' });
      else finish(code === 0 ? { ok: true, sha } : { ok: false, error: signal ? `engine stopped (${signal})` : `engine failed (exit ${code})` });
    });
  });
}

const stillOurs = () => { if (map.ownsLock(dir, token) === false) lost = true; return !lost; };

async function main() {
  if (!map.takeLock(dir, token)) {
    map.updateState(dir, s => { s.pending = true; });
    process.stdout.write('A code map refresh is already running; it will run once more when it finishes.\n');
    return;
  }
  const beat = setInterval(() => { if (map.touchLock(dir, token) === false) { lost = true; killEngine(); } }, map.HEARTBEAT_MS);
  try {
    for (let round = 0; round < 3; round++) {
      if (!stillOurs()) break;
      map.updateState(dir, s => { s.pending = false; });
      const r = await runOnce();
      if (!stillOurs()) break; // never write through a lock another runner holds
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
  } finally { clearInterval(beat); map.releaseLock(dir, token); }
  if (lost) { process.stdout.write('Code map refresh stopped: another refresh took over.\n'); return; }
  const st = map.readState(dir);
  process.stdout.write(st.lastError ? `Code map refresh failed: ${st.lastError}\n` : `Code map refreshed (as of ${String(st.sha).slice(0, 7)}).\n`);
}

// Stopped from outside: take the engine down with this runner, and give the lock back only if it is still ours.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  try { process.on(sig, () => { killEngine(); map.releaseLock(dir, token); process.exit(1); }); } catch { /* not on this platform */ }
}
process.on('exit', killEngine);

main().catch(() => { killEngine(); map.releaseLock(dir, token); });
