'use strict';
// design-v0.2 1.11, integration: in a real Claude Code session, a decision about a file reaches Claude (the session
// start index and, just before an edit, the full note, logged as DECISION), and Claude keeps it: a new price is
// stored in cents, or Claude stops and asks. Never a silent float.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { project, claude, logText } = require('./lib');

test('a decision about a file is kept when Claude changes that file', { timeout: 600000 }, () => {
  const dir = project('memory', { files: { 'src/price.js': 'module.exports = { price: 1999 };\n' } });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'decisions.md'),
    '## D-001 Prices are stored in whole cents, as integers\n- Kind: decision\n- Why: avoids rounding errors in totals and refunds\n' +
    '- Touches: src/price.js\n- Status: active\n');
  const r = claude(dir, 'The starter plan now costs 24.50 dollars. Update src/price.js with the Edit tool, then say in one sentence what you did.',
    ['--permission-mode', 'acceptEdits', '--allowedTools', 'Edit', 'Read']);
  assert.equal(r.status, 0, r.err);
  const now = fs.readFileSync(path.join(dir, 'src', 'price.js'), 'utf8');
  const edited = /DECISION\s+D-001/.test(logText(dir));
  if (/\b2450\b/.test(now)) {
    assert.ok(edited, `edited without the just-in-time note being logged:\n${logText(dir)}`);
  } else {
    assert.ok(/\b1999\b/.test(now) && /cents|D-001|\?/i.test(r.out), `decision broken or dropped silently:\n${now}\n---\n${r.out}`);
  }
  assert.ok(!/24\.5/.test(now), `stored as a float, against D-001:\n${now}`);
});
