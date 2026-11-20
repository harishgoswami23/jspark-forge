'use strict';
// v0.5.1 gaps, item 4 ("Waiting on you", spec 5.2a): what a question blocks and whether the answer is reversible
// (optional fields set through the CLI), the link to the launch list, the offer to record an answer as a decision,
// and /jspark-forge:check filing open questions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gw-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const env = dir => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'cfg') });
const hook = (dir, event, input = {}) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir),
    input: JSON.stringify(Object.assign({ session_id: 'gw-1', cwd: dir, source: 'startup' }, input)) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const cli = (dir, ...args) => spawnSync(process.execPath, [FORGE, 'waiting', ...args], { cwd: dir, encoding: 'utf8', env: env(dir) }).stdout;
const items = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'waiting.json'), 'utf8')).items;
const ask = (dir, question) => hook(dir, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [
  { question, header: 'Q', multiSelect: false, options: [{ label: 'A (Recommended)' }, { label: 'B' }] }] } });
const skill = n => fs.readFileSync(path.join(ROOT, 'skills', n, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');

test('what it blocks and reversible: absent from a captured question, settable through the CLI, shown when present', () => {
  const dir = project();
  ask(dir, 'Which database should we use?');
  assert.equal(items(dir)[0].blocks, undefined);
  assert.doesNotMatch(cli(dir), /blocks:|reversible:/);
  const out = cli(dir, '--set', 'w1', '--blocks', 'the data model and every later step', '--reversible', 'no');
  assert.match(out, /w1/);
  assert.equal(items(dir)[0].blocks, 'the data model and every later step');
  assert.equal(items(dir)[0].reversible, false);
  const shown = cli(dir);
  assert.match(shown, /blocks: the data model and every later step/);
  assert.match(shown, /reversible: no/);
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', 'waiting.md'), 'utf8'), /Blocks: the data model and every later step[\s\S]*Reversible: no/);
  cli(dir, '--set', 'w1', '--reversible', 'yes');
  assert.equal(items(dir)[0].reversible, true);
  assert.equal(items(dir)[0].blocks, 'the data model and every later step', 'the other field is kept');
  assert.match(cli(dir, '--set', 'w9', '--blocks', 'x'), /No open question w9/);
});

test('session start asks Claude to say, for each open question, what it blocks, and how to record it', () => {
  const dir = project();
  ask(dir, 'Which database should we use?');
  const o = hook(dir, 'SessionStart');
  const ctx = o.hookSpecificOutput.additionalContext;
  assert.match(ctx, /state for each open question what it blocks/i);
  assert.match(ctx, /waiting --set <id> --blocks/);
  assert.match(o.systemMessage, /Which database should we use\?/);
});

test('launch link: a question or its blocks field naming an open launch item shows "blocks launch item: <title>"', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'launch.md'),
    '# Launch list\n\nLaunch date: 2026-12-31\n\n- [ ] Checkout page\n- [x] Landing page\n- [ ] Email receipts\n\n## After launch\n- [ ] Dark mode\n');
  ask(dir, 'Which payment provider for the Checkout page?');
  ask(dir, 'Pick a name for the landing page?');
  ask(dir, 'Which mail service?');
  cli(dir, '--set', 'w3', '--blocks', 'email receipts cannot be built');
  const text = cli(dir);
  const line = n => text.split('\n').find(l => l.includes(`[w${n}]`));
  assert.match(line(1), /blocks launch item: Checkout page/);
  assert.doesNotMatch(line(2), /blocks launch item/, 'a finished launch item is not held up');
  assert.match(line(3), /blocks launch item: Email receipts/, 'through the blocks field');
  const o = hook(dir, 'SessionStart');
  assert.match(o.systemMessage, /blocks launch item: Checkout page/);
});

test('launch link: no launch list, no link', () => {
  const dir = project();
  ask(dir, 'Which payment provider for the Checkout page?');
  assert.doesNotMatch(cli(dir), /launch item/);
});

test('the waiting skill offers to record an answer as a decision, with /jspark-forge:decide', () => {
  const s = skill('waiting');
  assert.match(s, /offer to record (the|that) answer as a decision/i);
  assert.match(s, /\/jspark-forge:decide/);
  assert.match(s, /only after the user says yes/i);
  assert.match(s, /waiting --set/);
});

test('the check skill asks Claude to file open questions to the user that are not in the waiting list', () => {
  const s = skill('check');
  assert.match(s, /open question/i);
  assert.match(s, /not in the waiting list/i);
  assert.match(s, /scripts\/forge\.js" waiting/);
});

test('a question Claude files itself (waiting --add) keeps the optional fields; the same question is not filed twice', () => {
  const dir = project();
  const out = cli(dir, '--add', 'Do we ship the beta on Friday?', '--blocks', 'the announcement', '--reversible', 'yes', '--recommend', 'Yes');
  assert.match(out, /w1/);
  const x = items(dir)[0];
  assert.equal(x.question, 'Do we ship the beta on Friday?');
  assert.equal(x.blocks, 'the announcement');
  assert.equal(x.reversible, true);
  assert.equal(x.recommendation, 'Yes');
  assert.equal(x.source, 'claude');
  assert.match(cli(dir, '--add', 'Do we ship the beta on Friday?'), /already/i);
  assert.equal(items(dir).length, 1);
});
