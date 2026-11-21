'use strict';
// Preloaded into every test process (package.json: node --require ./tests/helpers/isolate.js --test).
// 1. Automatic setup (scripts/lib/setup.js) writes to Claude Code's config folder: point it at a throw-away folder so
//    no test can ever change the real ~/.claude (settings, status line). Tests that need their own pass it explicitly.
// 2. Every temp file of the run goes into one folder of its own (TMPDIR / TEMP / TMP, which os.tmpdir() reads), removed
//    when the run ends: test runs once left about 50,000 folders in the OS temp folder. FORGE_TEST_KEEP_TMP=1 keeps it.
// The first process (the test runner) sets this up; the test files it starts inherit the environment.
const fs = require('fs');
const os = require('os');
const path = require('path');
if (!process.env.FORGE_TEST_ISOLATED) {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-run-'));
  process.env.TMPDIR = run;
  process.env.TEMP = run;
  process.env.TMP = run;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(run, 'forge-test-claude-'));
  process.env.FORGE_TEST_ISOLATED = '1';
  if (!process.env.FORGE_TEST_KEEP_TMP) {
    process.on('exit', () => {
      // A background child (a code-map refresh) may still hold a file on Windows: whatever cannot go yet stays.
      try { fs.rmSync(run, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
    });
  }
}

// 3. No test may hang for ever (CI, macOS with Node 18, 2026-11-20: a unit job sat for 12 minutes on one child process
//    and was cancelled with nothing to say which). Every child a test starts with spawnSync / execFileSync / execSync
//    gets a 3-minute limit unless the test sets its own; one that hits the limit is named on stderr, so the log shows
//    which command hung. Applies in every test process (this file is preloaded into each).
{
  const cp = require('child_process');
  const LIMIT_MS = 180000;
  const say = (what, args) => { try { process.stderr.write(`\n# TEST CHILD HUNG (killed after ${LIMIT_MS / 1000} s): ${what} ${JSON.stringify(args || []).slice(0, 300)}\n`); } catch { /* best effort */ } };
  const withLimit = o => (o && o.timeout !== undefined ? o : Object.assign({}, o, { timeout: LIMIT_MS }));
  const optsAt = a => (a.length && a[a.length - 1] && typeof a[a.length - 1] === 'object' && !Array.isArray(a[a.length - 1]) ? a.length - 1 : -1);
  const timedOut = e => !!e && (e.code === 'ETIMEDOUT' || e.killed === true || e.signal === 'SIGTERM');
  for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
    const real = cp[name];
    cp[name] = function patched(...a) {
      const i = optsAt(a);
      const mine = i < 0 || a[i].timeout === undefined; // only a limit this file added is reported
      if (i < 0) a.push(withLimit(undefined)); else a[i] = withLimit(a[i]);
      const cmdArgs = Array.isArray(a[1]) ? a[1] : [];
      try {
        const r = real.apply(this, a);
        if (mine && name === 'spawnSync' && r && timedOut(r.error)) say(a[0], cmdArgs);
        return r;
      } catch (e) {
        if (mine && timedOut(e)) say(a[0], cmdArgs);
        throw e;
      }
    };
  }
}
