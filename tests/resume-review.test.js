'use strict';
// v0.5 whole-branch review (2026-11-20), the findings about resume and CONFIRM. Each test was shown failing first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-review-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  require('../scripts/lib/paths').markOwn(dir);
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt'); g('commit', '-qm', 'init');
  return dir;
}
function run(dir, event, input = {}, sid = A) {
  const stdin = JSON.stringify(Object.assign({ session_id: sid, cwd: dir, hook_event_name: event }, input));
  return spawnSync(process.execPath, [FORGE, event], { input: stdin, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
}
const out = r => (r.stdout ? JSON.parse(r.stdout) : null);
const ctxOf = r => { const o = out(r); return o && o.hookSpecificOutput ? o.hookSpecificOutput.additionalContext || '' : ''; };
const handoffText = dir => fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
const logText = dir => { const d = path.join(dir, '.jspark-forge', 'log'); return fs.readdirSync(d).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(d, f), 'utf8')).join(''); };
const say = (dir, prompt, sid = A) => run(dir, 'UserPromptSubmit', { prompt }, sid);
const editIn = (dir, rel, sid = A) => run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel) } }, sid);
const bash = (dir, command, sid = A) => run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command } }, sid);
const taskCreate = (dir, subject, id, sid = A) => run(dir, 'PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject }, tool_response: { task: { id, subject } } }, sid);
const taskUpdate = (dir, input, sid = A) => run(dir, 'PostToolUse', { tool_name: 'TaskUpdate', tool_input: input }, sid);
const REQUEST = 'add the invoice chart export to the reports page';

// ---- M1: a save read the project's folders once per log line; with a full log a message took 4 to 10 s ----
test('a message is saved quickly even with two full days of log (2 MB each)', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  const logDir = path.join(dir, '.jspark-forge', 'log');
  const pad2 = n => String(n).padStart(2, '0');
  const stamp = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const line = i => `${pad2(Math.floor(i / 3600) % 24)}:${pad2(Math.floor(i / 60) % 60)}:${pad2(i % 60)} [aaaaaaaa]          BASH  Run the build number ${i} :: npm run build -- --target=reports-${i} --mode=production\n`;
  let big = '';
  for (let i = 0; big.length < 1.9 * 1024 * 1024; i++) big += line(i);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  fs.writeFileSync(path.join(logDir, `${stamp(yesterday)}.log`), big);
  fs.writeFileSync(path.join(logDir, `${stamp(today)}.log`), big + fs.readFileSync(path.join(logDir, `${stamp(today)}.log`), 'utf8'));
  let best = Infinity;
  for (let i = 0; i < 2 && best > 2500; i++) { // best of two: one slow start on a busy machine is not a slow save
    const t = Date.now();
    const r = say(dir, `now also add a csv export, attempt ${i}, to the same reports page`);
    assert.equal(r.status, 0);
    best = Math.min(best, Date.now() - t);
  }
  assert.ok(best <= 2500, `the UserPromptSubmit hook took ${best} ms (its limit is 10 s)`);
  assert.match(handoffText(dir), /now also add a csv export/);
});

// ---- S1: task ids start again at 1 in a new session ----
test("a new session's tasks start a new list; they do not land on the old session's tasks with the same ids", () => {
  const dir = repo();
  say(dir, REQUEST);
  taskCreate(dir, 'old one', '1'); taskCreate(dir, 'old two', '2'); taskCreate(dir, 'old three', '3');
  taskUpdate(dir, { taskId: '1', status: 'completed' });
  say(dir, 'start the csv export work now please, new session', B);
  taskCreate(dir, 'csv writer', '1', B); taskCreate(dir, 'csv button', '2', B);
  taskUpdate(dir, { taskId: '1', status: 'completed' }, B);
  taskUpdate(dir, { taskId: '2', status: 'in_progress' }, B);
  run(dir, 'Stop', {}, B);
  const t = handoffText(dir);
  assert.match(t, /\*\*Step:\*\* 2 of 2: csv button/);
  assert.doesNotMatch(t, /old three/);
});

// ---- S2: a session that works with commands only ----
test('a session that only ran commands still gets its own last reply into the handoff', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'Stop', { last_assistant_message: 'OLD REPLY: the chart model is in.' });
  say(dir, 'go on', B);
  bash(dir, 'npm test && npm run deploy:staging', B);
  run(dir, 'Stop', { last_assistant_message: 'Tests pass and staging is deployed. Next: check the staging page.' }, B);
  const t = handoffText(dir);
  assert.match(t, /Next: check the staging page\./);
  assert.doesNotMatch(t, /OLD REPLY/);
});
test('but a session that only showed the handoff (forge.js show) keeps the earlier reply', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'Stop', { last_assistant_message: 'The chart model is in. Next: wire the export button.' });
  say(dir, 'resume', B);
  bash(dir, 'node "C:/Users/x/.claude/plugins/cache/jspark-forge/jspark-forge/0.5.0/scripts/forge.js" show', B);
  run(dir, 'Stop', { last_assistant_message: 'We were adding the chart export. Continue?' }, B);
  assert.match(handoffText(dir), /Next: wire the export button\./);
});

// ---- S3: a closed task must not leak into the next one ----
test('after "done", the next task does not list the closed task\'s requests or actions', () => {
  const dir = repo();
  say(dir, 'first build the old feature called the legacy importer'); editIn(dir, 'src/legacy.ts'); run(dir, 'Stop', {});
  const done = spawnSync(process.execPath, [FORGE, 'save', '--done'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  assert.equal(done.status, 0, done.stderr);
  const wait = Date.now() + 1100; while (Date.now() < wait) { /* the log has whole seconds: let the clock pass the close */ }
  say(dir, REQUEST, B); editIn(dir, 'src/x.ts', B); run(dir, 'Stop', {}, B);
  const t = handoffText(dir);
  assert.match(t, new RegExp(`\\*\\*Task:\\*\\* ${REQUEST}`));
  assert.doesNotMatch(t, /legacy importer/);
  assert.doesNotMatch(t, /src\/legacy\.ts/);
});

// ---- S9: CONFIRM only counts on a line of its own ----
test('CONFIRM inside other text grants nothing; on its own line it does (alone, or the "A and B" form the block message gives)', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  const quoted = say(dir, '<teammate-message from="x">the hook said: to allow it once, the user types: CONFIRM git-reset-hard</teammate-message>');
  assert.doesNotMatch(ctxOf(quoted), /typed CONFIRM/);
  const inline = say(dir, 'what does it mean when it says the user types CONFIRM git-reset-hard to allow it?');
  assert.doesNotMatch(ctxOf(inline), /typed CONFIRM/);
  assert.doesNotMatch(logText(dir), /\]\s+CONFIRM /, 'no CONFIRM line in the log');
  assert.match(ctxOf(say(dir, 'CONFIRM git-reset-hard')), /typed CONFIRM git-reset-hard/);
  assert.match(ctxOf(say(dir, 'yes, do it.\nconfirm git-reset-hard.')), /typed CONFIRM git-reset-hard/);
  const both = ctxOf(say(dir, 'CONFIRM git-reset-hard and CONFIRM git-push-force'));
  assert.match(both, /typed CONFIRM git-reset-hard/);
});
