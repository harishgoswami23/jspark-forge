#!/usr/bin/env node
'use strict';
// v0.5 installer for the bundled MCP servers: `node install.js <name>`. Started detached by the launcher, so it
// outlives the session that started it. Installs the pinned package once into
// <claude home>/jspark-forge/engines/<safe-name>-<pin>/ with npm, and writes the marker installed.json only after
// npm succeeded. A folder without the marker is never used, so an install that was cut short cannot poison later
// starts: the next installer removes the half-written folder and starts again. One installer at a time (a lock file
// with pid and time; stale when the pid is dead or it is older than 15 minutes). Failure: the reason goes into
// bundled.json (exit: { code, at, reason }) and no marker is written. Nothing is printed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bundled = require('../lib/bundled');

const LOCK_STALE_MS = 15 * 60 * 1000;
const INSTALL_LIMIT_MS = 10 * 60 * 1000;

function lockIsStale(lock) {
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    let o = null;
    try { o = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* being written, or junk */ }
    if (o && Number.isInteger(o.pid)) return !bundled.pidAlive(o.pid) || age > LOCK_STALE_MS;
    return age > LOCK_STALE_MS;
  } catch { return false; }
}
// true when this process now holds the lock
function takeLock(lock) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return false;
      if (!lockIsStale(lock)) return false;
      try { fs.unlinkSync(lock); } catch { /* another installer took it over */ }
    }
  }
  return false;
}
function release(lock) {
  try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock); } catch { /* gone */ }
}

function main() {
  const name = process.argv[2];
  const spec = bundled.SERVERS[name];
  if (!spec) process.exit(1);
  const home = bundled.claudeHome();
  const project = process.env.CLAUDE_PROJECT_DIR || undefined;
  const dir = bundled.engineDir(home, name);
  const lock = bundled.lockFile(home, name);
  if (!takeLock(lock)) process.exit(0); // another installer is working on it
  process.on('exit', () => release(lock));
  if (bundled.installed(home, name)) process.exit(0);

  const fail = (code, reason) => {
    bundled.record(home, name, { exit: { code, at: Date.now(), reason: String(reason).slice(-300) } }, project);
    process.exit(1);
  };
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { fail(1, `could not remove the half-written folder (${e.message})`); }
  const cmd = bundled.installCommand(home, name);
  if (!cmd) return fail(1, 'npm was not found next to Node.js');
  let stderr = '';
  let child;
  try {
    child = spawn(cmd[0], cmd.slice(1), { cwd: bundled.neutralDir(home), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, shell: false,
      timeout: INSTALL_LIMIT_MS, env: Object.assign({}, process.env, { NoDefaultCurrentDirectoryInExePath: '1' }) });
  } catch (e) { return fail(1, e.message); }
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  child.on('error', e => fail(1, e.message));
  child.on('close', (code, sig) => {
    if (sig) return fail(1, `install stopped (${sig}; the limit is 10 minutes)`);
    if (code !== 0) return fail(code === null ? 1 : code, stderr.trim() || `install exit code ${code}`);
    if (!bundled.binPath(home, name)) return fail(1, 'the package was installed but its program was not found');
    try {
      require('../lib/fsx').writeAtomic(path.join(dir, 'installed.json'), `${JSON.stringify({ pkg: spec.pkg, pin: spec.pin, at: Date.now() })}\n`);
    } catch (e) { return fail(1, `could not write the marker (${e.message})`); }
    process.exit(0);
  });
  return undefined;
}

try { main(); } catch (e) { try { process.stderr.write(`jspark-forge: ${e && e.message ? e.message : e}\n`); } catch { /* none */ } process.exit(1); }
