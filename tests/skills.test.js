'use strict';
// Design 3 (layout) and 8: /jspark-forge:resume and /jspark-forge:handoff skills.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = n => fs.readFileSync(path.join(__dirname, '..', 'skills', n, 'SKILL.md'), 'utf8');
const front = t => { const m = t.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(m, 'frontmatter'); return m[1]; };

for (const name of ['resume', 'handoff']) {
  test(`${name}: frontmatter has its name and a "Use when" description`, () => {
    const f = front(read(name));
    assert.match(f, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(f, /^description: Use when /m);
  });
}

test('resume reads only the handoff, never the log, and waits', () => {
  const t = read('resume');
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" show/, 'asks the script (guest mode moves the file)');
  assert.match(t, /Do not read the log/);
  assert.match(t, /Continue\?/);
});

test('handoff updates the notes, then runs the save script from the plugin root; done closes the task', () => {
  const t = read('handoff');
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" where/, 'asks where the notes file is');
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" save/);
  assert.match(t, /--done/);
  assert.match(t, /\$ARGUMENTS/);
});

test('init is user-only, runs init.js, asks before wrapping the status line, and offers undo', () => {
  const t = read('init');
  const f = front(t);
  assert.match(f, /^name: init$/m);
  assert.match(f, /^disable-model-invocation: true$/m);
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/init\.js"/);
  assert.match(t, /Go ahead\? \(yes \/ no\)/);
  assert.match(t, /--undo-statusline/);
  assert.match(t, /install\.js" --undo/);
});

test('the rules template parses with no errors and no active rules', () => {
  const { parseRules } = require('../scripts/lib/rules');
  const r = parseRules(fs.readFileSync(path.join(__dirname, '..', 'templates', 'rules.md'), 'utf8'));
  assert.equal(r.errors.length, 0);
  assert.equal(r.confirm.length + r.never.length, 0);
  assert.equal(r.settings.notes, 'on');
});
