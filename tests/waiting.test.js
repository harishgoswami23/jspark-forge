'use strict';
// v0.1.1 "Waiting on you" (spec 5.2a, design-v0.1.1 section 4): a question that blocks work is kept in a list until
// the user answers it, shown in the status line, first at session start, in the handoff and by /jspark-forge:waiting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const WRAPPER = path.join(__dirname, '..', 'scripts', 'statusline', 'wrapper.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wait-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const hook = (dir, event, input = {}) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 'wait-1', cwd: dir, source: 'startup' }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const cli = (dir, ...args) => spawnSync(process.execPath, [FORGE, 'waiting', ...args], { cwd: dir, encoding: 'utf8',
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) }).stdout;
const list = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'waiting.json'), 'utf8')).items; } catch { return []; } };

const ASK = { tool_name: 'AskUserQuestion', tool_input: { questions: [
  { question: 'Which colour should the button use?', header: 'Button', multiSelect: false,
    options: [{ label: 'Red', description: 'bold' }, { label: 'Blue (Recommended)', description: 'calm' }] },
  { question: 'Ship it today?', header: 'Release', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] },
] } };

test('a question through the question tool is filed before the dialog shows, and never blocked', () => {
  const dir = project();
  const o = hook(dir, 'PreToolUse', ASK);
  assert.ok(!o || !o.hookSpecificOutput || !o.hookSpecificOutput.permissionDecision, 'not denied or asked');
  const items = list(dir);
  assert.equal(items.length, 2);
  assert.equal(items[0].question, 'Which colour should the button use?');
  assert.equal(items[0].about, 'Button');
  assert.equal(items[0].recommendation, 'Blue');
  assert.deepEqual(items[0].options, ['Red', 'Blue']);
  const md = fs.readFileSync(path.join(dir, '.jspark-forge', 'waiting.md'), 'utf8');
  assert.match(md, /Which colour should the button use\?/);
  assert.match(md, /recommended: Blue/i);
});

test('answering the question tool removes its questions', () => {
  const dir = project();
  hook(dir, 'PreToolUse', ASK);
  hook(dir, 'PostToolUse', Object.assign({ tool_response: { answers: {} } }, ASK));
  assert.equal(list(dir).length, 0);
});

test('a reply ending in a question is filed only when there is work it holds up', () => {
  const dir = project();
  hook(dir, 'Stop', { last_assistant_message: 'Hello! What shall we do?' });
  assert.equal(list(dir).length, 0, 'only talk: nothing filed');
});

test('a reply ending in a question is filed; the next message in that session answers it', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'db.js'), 'x');
  hook(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'db.js') } });
  hook(dir, 'Stop', { last_assistant_message: 'I found two options. Should I use Postgres or SQLite?' });
  assert.equal(list(dir).length, 1);
  assert.equal(list(dir)[0].question, 'Should I use Postgres or SQLite?');
  hook(dir, 'Stop', { last_assistant_message: 'Should I use Postgres or SQLite?' });
  assert.equal(list(dir).length, 1, 'the same question is not filed twice');
  hook(dir, 'UserPromptSubmit', { prompt: 'look at the logs first', session_id: 'other-session' });
  assert.equal(list(dir).length, 1, 'a message in another session does not answer it');
  hook(dir, 'UserPromptSubmit', { prompt: 'SQLite' });
  assert.equal(list(dir).length, 0);
});

test('a reply that does not end in a question files nothing', () => {
  const dir = project();
  hook(dir, 'Stop', { last_assistant_message: 'Done. Tests pass.' });
  assert.equal(list(dir).length, 0);
});

test('session start lists what is waiting first, and tells Claude not to act on a recommendation alone', () => {
  const dir = project();
  hook(dir, 'PreToolUse', ASK);
  const o = hook(dir, 'SessionStart', { session_id: 'next-session' });
  assert.match(o.systemMessage.split('\n')[0], /^Waiting on you \(2\)/);
  assert.match(o.systemMessage, /Which colour should the button use\? \(recommended: Blue\)/);
  assert.match(o.hookSpecificOutput.additionalContext, /Ship it today\?/);
  assert.match(o.hookSpecificOutput.additionalContext, /never act on a recommendation without the user's answer/i);
});

test('the handoff names the count and the oldest question', () => {
  const dir = project();
  hook(dir, 'PreToolUse', ASK);
  hook(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'a.txt') } });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  spawnSync(process.execPath, [FORGE, 'save'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  const h = fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
  assert.match(h, /\*\*Waiting on you:\*\* 2 questions; oldest: "Which colour should the button use\?"/);
});

test('the status line shows the count and the age of the oldest', () => {
  const dir = project();
  hook(dir, 'PreToolUse', ASK);
  const f = path.join(dir, '.jspark-forge', 'state', 'waiting.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.items[0].askedAt = Date.now() - 14 * 3600 * 1000;
  fs.writeFileSync(f, JSON.stringify(j));
  const sl = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-wait-sl-'));
  fs.copyFileSync(WRAPPER, path.join(sl, 'statusline.js'));
  const r = spawnSync(process.execPath, [path.join(sl, 'statusline.js')], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'wait-1', workspace: { project_dir: dir } }) });
  assert.match(r.stdout, /⏳ 2 waiting on you · oldest 14h/);
  fs.writeFileSync(f, JSON.stringify({ items: [] }));
  const r2 = spawnSync(process.execPath, [path.join(sl, 'statusline.js')], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'wait-1', workspace: { project_dir: dir } }) });
  assert.ok(!/waiting/.test(r2.stdout), 'nothing shown when the list is empty');
});

test('forge.js waiting lists the questions; --clear <id> and --clear all remove them', () => {
  const dir = project();
  hook(dir, 'PreToolUse', ASK);
  const shown = cli(dir);
  assert.match(shown, /1\. \[w\d+\] Which colour should the button use\? \(recommended: Blue\)/);
  const id = list(dir)[0].id;
  assert.match(cli(dir, '--clear', id), /Removed 1/);
  assert.equal(list(dir).length, 1);
  cli(dir, '--clear', 'all');
  assert.equal(list(dir).length, 0);
  assert.match(cli(dir), /Nothing is waiting on you/);
});

test('the list keeps at most 20 items and drops items older than 14 days', () => {
  const { add, read } = require('../scripts/lib/waiting');
  const dir = project();
  for (let i = 0; i < 25; i++) add(dir, [{ question: `Q${i}?`, session: 's' }]);
  assert.equal(read(dir).length, 20);
  assert.equal(read(dir)[0].question, 'Q5?', 'oldest dropped first');
  const old = Date.now() - 15 * 86400000;
  add(dir, [{ question: 'Very old?', session: 's', askedAt: old }]);
  assert.ok(!read(dir).some(x => x.question === 'Very old?'));
});

test('the question tool is in the PreToolUse and PostToolUse matchers', () => {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    assert.ok(h[ev].some(m => new RegExp(`^(${m.matcher})$`).test('AskUserQuestion')), ev);
  }
});
