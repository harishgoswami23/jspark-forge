'use strict';
// Preloaded into every test process (package.json: node --require ./tests/helpers/isolate.js --test).
// Automatic setup (scripts/lib/setup.js) writes to Claude Code's config folder: point it at a throw-away folder so
// no test can ever change the real ~/.claude (settings, status line). Tests that need their own pass it explicitly.
const fs = require('fs');
const os = require('os');
const path = require('path');
if (!process.env.FORGE_TEST_ISOLATED) {
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-claude-'));
  process.env.FORGE_TEST_ISOLATED = '1';
}
