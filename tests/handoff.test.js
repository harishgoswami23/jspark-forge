'use strict';
// Design 5.1 (sources), 5.2 (format, 600-word cap, trimming order), deviation 7 (task/step sources).
const test = require('node:test');
const assert = require('node:assert/strict');
const handoff = require('../scripts/lib/handoff');

const base = () => ({
  asOf: new Date(2026, 10, 2, 14, 32),
  reason: 'commit',
  git: { branch: 'feature/save-as-chart', head: '3f2e1d0', dirty: 2 },
  task: 'Add "Save as chart" to the report page',
  step: { n: 4, m: 10, text: 'write tests for the save route' },
  done: 'steps 1–3 (last commit 3f2e1d0 "add chart model")',
  next: 'write tests in tests/save_chart.test.ts, then run them',
  running: ['`npm run dev` (started 14:05, may have stopped)'],
  waiting: null,
  lastRequest: 'carry on with the plan, stop before deploy',
  notes: { time: new Date(2026, 10, 2, 14, 28), text: 'The save route reuses the existing export permission check.' },
  recent: ['14:20 edited src/routes/save.ts', '14:24 ran tests', '14:31 commit 3f2e1d0'],
  files: ['src/routes/save.ts', 'src/models/chart.ts'],
  logFile: '.jspark-forge/log/2026-11-02.log',
  others: [],
});
const words = s => s.split(/\s+/).filter(Boolean).length;

test('renders the design 5.2 layout', () => {
  const t = handoff.render(base());
  const lines = t.split('\n');
  assert.equal(lines[0], '# Where we were');
  assert.equal(lines[1], 'As of 2026-11-02 14:32 · saved because: commit · branch feature/save-as-chart @ 3f2e1d0 · 2 files not committed');
  assert.match(t, /^\*\*Task:\*\* Add "Save as chart" to the report page$/m);
  assert.match(t, /^\*\*Step:\*\* 4 of 10: write tests for the save route$/m);
  assert.match(t, /^\*\*Done:\*\* steps 1–3/m);
  assert.match(t, /^\*\*Next action:\*\* write tests in/m);
  assert.match(t, /^\*\*Still running at cutoff:\*\* `npm run dev`/m);
  assert.match(t, /^\*\*Waiting on you:\*\* nothing$/m);
  assert.match(t, /^\*\*Your last request:\*\* "carry on with the plan, stop before deploy"$/m);
  assert.match(t, /^\*\*Claude's notes \(14:28; re-check any caution or limit before acting on it\):\*\* The save route/m);
  assert.match(t, /^\*\*Recent actions:\*\* 14:20 edited src\/routes\/save\.ts · 14:24 ran tests · 14:31 commit 3f2e1d0$/m);
  assert.match(t, /^\*\*Files touched in this task:\*\* src\/routes\/save\.ts, src\/models\/chart\.ts$/m);
  assert.match(t, /^\*\*More detail:\*\* \.jspark-forge\/log\/2026-11-02\.log · older handoffs: \.jspark-forge\/archive\/$/m);
  assert.ok(!t.includes('\r'));
});

test('missing fields say "not recorded" / "nothing"; no git means no branch part', () => {
  const m = Object.assign(base(), { git: null, step: null, done: null, next: null, running: [], notes: null, recent: [], files: [] });
  const t = handoff.render(m);
  assert.equal(t.split('\n')[1], 'As of 2026-11-02 14:32 · saved because: commit');
  assert.match(t, /\*\*Step:\*\* not recorded/);
  assert.match(t, /\*\*Next action:\*\* not recorded/);
  assert.match(t, /\*\*Still running at cutoff:\*\* nothing/);
  assert.ok(!/Claude's notes/.test(t));
});

test('600-word cap: drops recent actions, then trims files to 5, then notes to 60 words; top fields kept', () => {
  const m = base();
  m.recent = Array.from({ length: 8 }, (_, i) => `14:${10 + i} edited ${'src/very/long/path/name/'.repeat(3)}f${i}.ts with a long description here`);
  m.files = Array.from({ length: 20 }, (_, i) => `src/module${i}/component${i}/file-number-${i}.ts`);
  m.notes.text = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');
  const t = handoff.render(m);
  assert.ok(words(t) <= 600, `${words(t)} words`);
  assert.ok(!/Recent actions/.test(t), 'recent actions dropped first');
  assert.match(t, /\*\*Files touched in this task:\*\* 20 files; newest: (?:[^,;\n]+, ){2}[^,;\n]+; the rest are in the log \([^)]+\)$/m);
  const notes = t.match(/\*\*Claude's notes \(14:28; [^)]*\):\*\* (.*)$/m)[1];
  assert.ok(words(notes) <= 61, 'notes trimmed to 60 words');
  for (const f of ['Task', 'Step', 'Done', 'Next action', 'Still running at cutoff', 'Waiting on you', 'Your last request']) {
    assert.match(t, new RegExp(`\\*\\*${f}:\\*\\*`));
  }
});

test('other active sessions get one line each, newest first, at most 2 more (3 in all)', () => {
  const m = base();
  m.others = [
    { id: 'bbbb2222', at: new Date(2026, 10, 2, 14, 30), lastRequest: 'fix the login bug', running: [] },
    { id: 'cccc3333', at: new Date(2026, 10, 2, 14, 10), lastRequest: 'write docs', running: ['`npm run docs`'] },
    { id: 'dddd4444', at: new Date(2026, 10, 2, 13, 0), lastRequest: 'old one', running: [] },
  ];
  const t = handoff.render(m);
  assert.match(t, /\*\*Also active:\*\* session bbbb2222 \(14:30\): "fix the login bug"/);
  assert.match(t, /session cccc3333 \(14:10\): "write docs" · running `npm run docs`/);
  assert.ok(!t.includes('dddd4444'));
});

test('task fields: the todo list wins, then a plan file, then the notes, then the last request', () => {
  const todos = [{ content: 'add model', status: 'completed' }, { content: 'write tests', status: 'in_progress' }, { content: 'ship', status: 'pending' }];
  const plan = { title: 'Plan title', total: 10, done: 3, stepIndex: 4, next: 'plan step 4' };
  const notes = { task: 'Notes task', step: '2 of 5: notes step', next: 'notes next' };
  let f = handoff.taskFields({ todos, plan, notes, lastRequest: 'req' });
  assert.deepEqual(f.step, { n: 2, m: 3, text: 'write tests' });
  assert.equal(f.next, 'write tests');
  assert.equal(f.task, 'Plan title', 'a todo list has no title: the next source (plan) gives it');
  f = handoff.taskFields({ todos: null, plan, notes, lastRequest: 'req' });
  assert.deepEqual(f.step, { n: 4, m: 10, text: 'plan step 4' });
  assert.equal(f.task, 'Plan title');
  assert.equal(f.done, 'steps 1–3');
  f = handoff.taskFields({ todos: null, plan: null, notes, lastRequest: 'req' });
  assert.deepEqual(f.step, { n: 2, m: 5, text: 'notes step' });
  assert.equal(f.next, 'notes next');
  f = handoff.taskFields({ todos: null, plan: null, notes: null, lastRequest: 'fix the login bug' });
  assert.equal(f.task, 'fix the login bug');
  assert.equal(f.step, null);
  assert.equal(f.next, null);
});

test('notes header lines are parsed and removed from the shown notes text', () => {
  const n = handoff.parseNotes('Task: Add chart\nStep: 4 of 10: tests\nNext: run tests\nWe agreed titles max 80 chars.');
  assert.equal(n.task, 'Add chart');
  assert.equal(n.step, '4 of 10: tests');
  assert.equal(n.next, 'run tests');
  assert.equal(n.text, 'We agreed titles max 80 chars.');
});
