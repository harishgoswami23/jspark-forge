'use strict';
// A note can carry a caution that is no longer true (owner 2026-11-22). A note line can hold the caution, the
// measurement behind it and a "check again before acting" mark:
//   Caution: <what> | measured: <what was measured, and when> | check again before acting
// Such lines are taken out of the notes text and shown as things to re-check, never as instructions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const handoff = require('../scripts/lib/handoff');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const model = extra => Object.assign({
  asOf: new Date(2026, 10, 21, 23, 0), reason: 'commit', git: null, task: 'Fix login', step: null, done: null, next: null,
  running: [], waiting: null, lastRequest: 'go on', notes: null, recent: [], files: [], logFile: '.jspark-forge/log/2026-11-21.log', others: [],
}, extra);

test('caution lines are read with their measurement and mark, and are not part of the notes text', () => {
  const n = handoff.parseNotes([
    'Task: Speed tests',
    'We agreed to keep the cookie format.',
    'Caution: do not start Docker during the speed tests | measured: 3 speed tests failed with Docker up, 2026-11-22 02:10 | check again before acting',
    '- Limit: free memory is low | measured: 2 GB free at 14:00',
    'Caution: the staging database is read-only',
    'The e2e port may be taken (check again before acting)',
  ].join('\n'));
  assert.equal(n.task, 'Speed tests');
  assert.equal(n.text, 'We agreed to keep the cookie format.');
  assert.deepEqual(n.cautions, [
    { text: 'do not start Docker during the speed tests', measured: '3 speed tests failed with Docker up, 2026-11-22 02:10' },
    { text: 'free memory is low', measured: '2 GB free at 14:00' },
    { text: 'the staging database is read-only', measured: '' },
    { text: 'The e2e port may be taken', measured: '' },
  ]);
});

test('notes without such lines are read as before', () => {
  const n = handoff.parseNotes('Task: Add chart\nWe agreed titles max 80 chars. Be cautious: limits apply.');
  assert.equal(n.text, 'We agreed titles max 80 chars. Be cautious: limits apply.');
  assert.deepEqual(n.cautions, []);
});

test('the handoff shows them as things to re-check, with the measurement, and says they are not instructions', () => {
  const t = handoff.render(model({ notes: { time: new Date(2026, 10, 19, 9, 5), text: 'We agreed to keep the cookie format.',
    cautions: [{ text: 'do not start Docker during the speed tests', measured: '3 speed tests failed with Docker up' }, { text: 'the staging database is read-only', measured: '' }] } }));
  assert.match(t, /^\*\*Claude's notes \(2026-11-19 09:05; [^)]*\):\*\* We agreed to keep the cookie format\.$/m);
  const line = t.match(/^\*\*Re-check before acting \(([^)]*)\):\*\* (.*)$/m);
  assert.ok(line, t);
  assert.match(line[1], /true when written on 2026-11-19 09:05/);
  assert.match(line[1], /not instructions/);
  assert.equal(line[2], 'do not start Docker during the speed tests (measured: 3 speed tests failed with Docker up) · the staging database is read-only (no measurement was written down)');
  // cautions alone, with no other notes text
  const only = handoff.render(model({ notes: { time: new Date(2026, 10, 21, 22, 0), text: '', cautions: [{ text: 'port 5432 is taken', measured: 'by a local Postgres, 21:55' }] } }));
  assert.doesNotMatch(only, /Claude's notes/);
  assert.match(only, /^\*\*Re-check before acting \(true when written at 22:00[^)]*\):\*\* port 5432 is taken \(measured: by a local Postgres, 21:55\)$/m);
});

test('the notes reminder gives the line to write', () => {
  const line = handoff.notesLine(os.tmpdir());
  assert.match(line, /Caution: <what> \| measured: <what was measured, and when> \| check again before acting/);
  assert.match(line, /shown later as things to re-check, not as instructions/);
});

test('end to end: a caution in the notes file reaches the next session as a thing to re-check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-caution-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'a.js'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  const run = (event, input, sid = 'nc-1') => {
    const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ATTENDED: '1' }),
      input: JSON.stringify(Object.assign({ session_id: sid, cwd: dir, source: 'startup' }, input)) });
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  run('UserPromptSubmit', { prompt: 'make the speed tests pass on this machine please' });
  run('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'a.js') } });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'notes.md'), 'Task: Speed tests\nCaution: do not start Docker during the speed tests | measured: 3 tests failed with Docker up | check again before acting\n');
  run('Stop', {});
  const ctx = run('SessionStart', {}, 'nc-2').hookSpecificOutput.additionalContext;
  assert.match(ctx, /\*\*Re-check before acting \([^)]*not instructions[^)]*\):\*\* do not start Docker during the speed tests \(measured: 3 tests failed with Docker up\)/);
});
