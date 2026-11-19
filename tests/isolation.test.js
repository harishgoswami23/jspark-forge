'use strict';
// Guard: the test run must never see the real Claude Code config folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

test('tests run with a throw-away CLAUDE_CONFIG_DIR, never the real ~/.claude', () => {
  const d = process.env.CLAUDE_CONFIG_DIR || '';
  assert.ok(d, 'CLAUDE_CONFIG_DIR is set (run tests with npm test)');
  assert.notEqual(path.resolve(d), path.resolve(os.homedir(), '.claude'));
  assert.ok(path.resolve(d).startsWith(path.resolve(os.tmpdir())), d);
});
