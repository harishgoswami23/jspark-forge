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
