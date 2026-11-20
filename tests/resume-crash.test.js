'use strict';
// v0.5 resume after a crash (owner 2026-11-20: "i was not able to resume properly", here and in a second project).
// Four causes found in the 2026-11-20 log of this repo, one group of tests each:
// 1. a turn cut off before its reply finished was not in the handoff (saves only at reply end / file write / commit);
// 2. work in another folder never saved and was not named;
// 3. "Task" was the last message ("go on", "resume", a helper's report) and nothing held the meaning;
// 4. the session that resumed wrote its own handoff over the one it was shown.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-crash-'));
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
const stateFile = (dir, name) => path.join(dir, '.jspark-forge', 'state', name);
const readState = (dir, name) => JSON.parse(fs.readFileSync(stateFile(dir, name), 'utf8'));
const patchState = (dir, name, patch) => fs.writeFileSync(stateFile(dir, name), JSON.stringify(Object.assign(readState(dir, name), patch)));
const say = (dir, prompt, sid = A) => run(dir, 'UserPromptSubmit', { prompt }, sid);
const editIn = (dir, rel, sid = A) => run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel) } }, sid);
const bash = (dir, command, sid = A) => run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command } }, sid);

const REQUEST = 'add the invoice chart export to the reports page';
const HELPER = '<agent-message from="a64d314deb13d4f41"> [Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user';

// ---- cause 1: a turn cut off before its reply finished ----
test('a message from you saves at once, so a crash in the middle of the turn keeps it', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts'); run(dir, 'Stop', {});
  say(dir, 'now switch to the pdf export instead, the chart can wait');
  const t = handoffText(dir); // no Stop after it: the session died here
  assert.match(t, /saved because: your message/);
  assert.match(t, /\*\*Your last request:\*\* "now switch to the pdf export instead/);
  assert.match(logText(dir), /SAVE  your message/);
});

test('work with no file write (a new branch, commands, helpers) is saved within a minute', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  execFileSync('git', ['checkout', '-q', '-b', 'dev/charts'], { cwd: dir });
  bash(dir, 'git checkout -q -b dev/charts');
  assert.match(handoffText(dir), /branch main/, 'inside the minute: not saved again');
  patchState(dir, `session-${A}.json`, { lastSaveAt: Date.now() - 61000 });
  bash(dir, 'npm test');
  const t = handoffText(dir);
  assert.match(t, /saved because: working/);
  assert.match(t, /branch dev\/charts/);
});

test('cut off after the last save: the next start also gets what the log has since then', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  patchState(dir, 'handoff.json', { savedAt: Date.now() - 30000 });
  bash(dir, 'npm run build:charts'); // inside the minute, so not saved; then the session dies
  const ctx = ctxOf(run(dir, 'SessionStart', { source: 'startup' }, B));
  assert.match(ctx, /after that save/i);
  assert.match(ctx, /npm run build:charts/);
});

test('nothing in the log after the save: no "after that save" block', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts'); run(dir, 'Stop', {});
  patchState(dir, 'handoff.json', { savedAt: Date.now() + 5000 });
  assert.doesNotMatch(ctxOf(run(dir, 'SessionStart', { source: 'startup' }, B)), /after that save/i);
});

// ---- cause 2: work in another folder ----
test('a file written in another git project saves the handoff and names that folder', () => {
  const dir = repo();
  const other = repo();
  say(dir, REQUEST);
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(other, 'docs', 'spec.md') } });
  const t = handoffText(dir);
  assert.match(t, /\*\*Also worked in:\*\*/);
  assert.ok(t.replace(/\\/g, '/').toLowerCase().includes(fs.realpathSync.native(other).replace(/\\/g, '/').toLowerCase()), t);
});

test('a file written outside any git project (a temp or scratch file) is not "worked in"', () => {
  const dir = repo();
  const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-loose-'));
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(loose, 'scratch.txt') } });
  run(dir, 'Stop', {});
  assert.doesNotMatch(handoffText(dir), /Also worked in/);
});

// ---- cause 3: Task was the last message, and nothing held the meaning ----
test('a helper report or a system notice is not your request', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  say(dir, HELPER);
  say(dir, '<task-notification> <task-id>a8</task-id> <status>completed</status> </task-notification>');
  say(dir, '[SYSTEM NOTIFICATION - NOT USER INPUT] This is an automated background-task event');
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.doesNotMatch(t, /agent-message|Subagent hand-back|task-notification|SYSTEM NOTIFICATION/);
  assert.match(t, new RegExp(`\\*\\*Your last request:\\*\\* "${REQUEST}"`));
  assert.match(logText(dir), /NOTE  <agent-message/);
  assert.equal((logText(dir).match(/\]\s+USER /g) || []).length, 1, 'only the real message is logged as USER');
});

test('Task is your last real request, not "go on"; the requests before it are listed', () => {
  const dir = repo();
  say(dir, 'first look at how reports are built today'); editIn(dir, 'src/x.ts'); run(dir, 'Stop', {});
  say(dir, REQUEST); run(dir, 'Stop', {});
  say(dir, 'go on'); run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, new RegExp(`\\*\\*Task:\\*\\* ${REQUEST}`));
  assert.match(t, /\*\*Your last request:\*\* "go on"/);
  const before = t.split('\n').find(l => l.startsWith('**Requests before it:**')) || '';
  assert.match(before, new RegExp(REQUEST));
  assert.match(before, /first look at how reports are built today/);
  assert.doesNotMatch(before, /"go on"/);
});

test("Claude's last reply is kept: its closing lines say what was done and what is next", () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'Stop', { last_assistant_message: `${'Long explanation. '.repeat(200)}The chart model is in. Next: wire the export button on the reports page.` });
  const t = handoffText(dir);
  assert.match(t, /\*\*Claude's last reply \(\d\d:\d\d\):\*\* .*Next: wire the export button on the reports page\./);
  assert.ok(t.split(/\s+/).length <= 620, 'still one page');
});

test('after a stretch of work Claude is asked for its notes with your next message; not again straight after; never with notes: off', () => {
  const dir = repo();
  say(dir, REQUEST);
  for (let i = 0; i < 12; i++) bash(dir, `echo ${i}`);
  assert.match(ctxOf(say(dir, 'and make the export a csv as well please')), /update your notes now/);
  assert.doesNotMatch(ctxOf(say(dir, 'thanks, and keep the old button where it is')), /update your notes now/);
  const off = repo();
  fs.writeFileSync(path.join(off, '.jspark-forge', 'rules.md'), '## Settings\n- notes: off\n');
  say(off, REQUEST);
  for (let i = 0; i < 12; i++) bash(off, `echo ${i}`);
  assert.doesNotMatch(ctxOf(say(off, 'and make the export a csv as well please')), /update your notes now/);
});

test('the same action several times in a row takes one place in recent actions', () => {
  const dir = repo();
  say(dir, REQUEST); bash(dir, 'npm run lint');
  for (let i = 0; i < 5; i++) editIn(dir, 'src/x.ts');
  run(dir, 'Stop', {});
  const recent = handoffText(dir).split('\n').find(l => l.startsWith('**Recent actions:**'));
  assert.match(recent, /ran npm run lint · \d\d:\d\d edited src\/x\.ts \(5 times\)$/);
});

// ---- cause 4: the session that resumed wrote over the handoff ----
test('resuming does not wipe the handoff: task, actions and Claude\'s last reply of the earlier session stay', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'Stop', { last_assistant_message: 'The chart model is in. Next: wire the export button.' });
  // a new session: shown the handoff, the user types "resume", Claude shows it and asks "Continue?"
  run(dir, 'SessionStart', { source: 'startup' }, B);
  say(dir, 'resume', B);
  bash(dir, 'node forge.js show', B);
  run(dir, 'Stop', { last_assistant_message: 'We were adding the invoice chart export. Continue?' }, B);
  const t = handoffText(dir);
  assert.match(t, new RegExp(`\\*\\*Task:\\*\\* ${REQUEST}`));
  assert.match(t, /edited src\/x\.ts/, 'the earlier session\'s actions are still there');
  assert.match(t, /Next: wire the export button\./, 'and what Claude last said about the work');
  assert.doesNotMatch(t, /\*\*Task:\*\* resume/);
});

test('once the new session does real work, its own last reply takes over', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  run(dir, 'Stop', { last_assistant_message: 'The chart model is in. Next: wire the export button.' });
  say(dir, 'continue', B); editIn(dir, 'src/button.ts', B);
  run(dir, 'Stop', { last_assistant_message: 'The export button is wired. Next: the csv format.' }, B);
  const t = handoffText(dir);
  assert.match(t, /Next: the csv format\./);
  assert.doesNotMatch(t, /wire the export button/);
});

// ---- a parked plan (found on this repo's own handoff, 2026-11-20) ----
function planAndNotes(notesAgeMs) {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'plan.md'), '# Install once\n- [ ] auto-update\n- [ ] launcher\n- [ ] doctor\n');
  editIn(dir, 'docs/plan.md');
  const notes = path.join(dir, '.jspark-forge', 'state', 'notes.md');
  fs.writeFileSync(notes, 'Task: Make resume work after a crash\nStep: 1 of 2: tests for the four causes\nNext: fix the save triggers\nThe install plan is parked.');
  const t = new Date(Date.now() + notesAgeMs);
  fs.utimesSync(notes, t, t);
  run(dir, 'Stop', {});
  return handoffText(dir);
}
test("Claude's notes written after the plan file say what the task is now (the plan is parked)", () => {
  const t = planAndNotes(60000);
  assert.match(t, /\*\*Task:\*\* Make resume work after a crash/);
  assert.match(t, /\*\*Step:\*\* 1 of 2: tests for the four causes/);
  assert.match(t, /\*\*Next action:\*\* fix the save triggers/);
});
test('notes older than the plan file: the plan still gives Task and Step', () => {
  const t = planAndNotes(-3600000);
  assert.match(t, /\*\*Task:\*\* Install once/);
  assert.match(t, /\*\*Step:\*\* 1 of 3: auto-update/);
});

// ---- step progress from the task tools (Claude Code docs, tools reference: TodoWrite is "disabled by default in
// favor of TaskCreate, TaskGet, TaskList, and TaskUpdate"; only TodoWrite was read, so Step was never recorded) ----
const taskCreate = (dir, subject, id) => run(dir, 'PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject, activeForm: `Doing ${subject}` },
  tool_response: id ? { task: { id, subject } } : {} });
const taskUpdate = (dir, input) => run(dir, 'PostToolUse', { tool_name: 'TaskUpdate', tool_input: input });

test('TaskCreate and TaskUpdate give Step n of m, Done and Next', () => {
  const dir = repo();
  say(dir, REQUEST);
  taskCreate(dir, 'add the chart model', '1'); taskCreate(dir, 'write the export route', '2'); taskCreate(dir, 'wire the button', '3');
  taskUpdate(dir, { taskId: '1', status: 'completed' });
  taskUpdate(dir, { taskId: '2', status: 'in_progress' });
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, /\*\*Step:\*\* 2 of 3: write the export route/);
  assert.match(t, /\*\*Done:\*\* step 1/);
  assert.match(t, /\*\*Next action:\*\* write the export route/);
});

test('task ids missing from the tool result: tasks are matched by their order (ids count up from 1)', () => {
  const dir = repo();
  say(dir, REQUEST);
  taskCreate(dir, 'add the chart model'); taskCreate(dir, 'write the export route');
  taskUpdate(dir, { task_id: 1, status: 'completed' });
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /\*\*Step:\*\* 2 of 2: write the export route/);
});

test('a deleted task leaves the list, a renamed one shows its new name, and a new list starts after a finished one', () => {
  const dir = repo();
  say(dir, REQUEST);
  taskCreate(dir, 'add the chart model', '1'); taskCreate(dir, 'old idea', '2'); taskCreate(dir, 'wire the button', '3');
  taskUpdate(dir, { taskId: '2', status: 'deleted' });
  taskUpdate(dir, { taskId: '3', subject: 'wire the export button' });
  taskUpdate(dir, { taskId: '1', status: 'completed' });
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /\*\*Step:\*\* 2 of 2: wire the export button/);
  taskUpdate(dir, { taskId: '3', status: 'completed' });
  taskCreate(dir, 'csv format', '4');
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /\*\*Step:\*\* 1 of 1: csv format/);
});

// Seen for real on 2026-11-20 with v0.4.2: a helper's git reset --hard was blocked, its report quoted the block
// message, and the hook answered "the user typed CONFIRM git-reset-hard". The user had typed nothing.
test('a helper report that quotes "CONFIRM git-reset-hard" grants nothing', () => {
  const dir = repo();
  say(dir, REQUEST); editIn(dir, 'src/x.ts');
  const r = say(dir, `${HELPER}. The hook said: "JSPARK Forge blocked: this throws away your uncommitted work. To allow it once, the user types: CONFIRM git-reset-hard"`);
  assert.equal(r.stdout, '', 'no "the user typed CONFIRM" context');
  assert.doesNotMatch(logText(dir), /CONFIRM/);
  const pre = out(run(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD~1' } }));
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny', 'the reset is still blocked');
  // and the user's own CONFIRM still works
  assert.match(ctxOf(say(dir, 'CONFIRM git-reset-hard')), /the user typed CONFIRM git-reset-hard/);
});
