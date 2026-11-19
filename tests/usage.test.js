'use strict';
// Design 7.2: hooks read .jspark-forge/usage/<session>.json (written by the status line). Figures older than 2 min
// are ignored. The highest figure decides: >= 80 % quiet save + notes reminder, >= 95 % forced save + message.
// Once per band per window; bands re-arm when the figure drops.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'usage000-0000-0000-0000-000000000000';
const MSG95 = 'Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were.';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-usage-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'usage'), { recursive: true });
  return dir;
}
function usage(dir, figs, ageMs = 0) {
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'usage', `${SID}.json`), JSON.stringify(Object.assign(
    { ts: Date.now() - ageMs, context_pct: null, five_hour_pct: null, seven_day_pct: null }, figs)));
}
function run(dir, event, input = {}) {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: SID, cwd: dir, hook_event_name: event }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const post = dir => run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
const logText = dir => { const d = path.join(dir, '.jspark-forge', 'log'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const saves = (dir, band) => (logText(dir).match(new RegExp(`SAVE  usage ${band} %`, 'g')) || []).length;
const ctx = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';

test('80 %: a quiet save and the notes reminder, once', () => {
  const dir = project();
  usage(dir, { context_pct: 82 });
  const o = post(dir);
  assert.ok(!o.systemMessage, 'quiet: no message to the user');
  assert.match(ctx(o), /update your notes now/);
  assert.equal(saves(dir, 80), 1);
  assert.ok(fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md')));
  assert.equal(post(dir), null, 'not repeated in the same band');
  assert.equal(saves(dir, 80), 1);
});

test('95 %: a forced save, the published message, and "do not start new work" for Claude', () => {
  const dir = project();
  usage(dir, { context_pct: 50, five_hour_pct: 96 });
  const o = post(dir);
  assert.equal(o.systemMessage, MSG95);
  assert.match(ctx(o), /finish the current small step/);
  assert.match(ctx(o), /do not start new work/i);
  assert.equal(saves(dir, 95), 1);
  assert.equal(post(dir), null, 'at most once per window');
});

test('jumping straight past 80 to 95 fires only the 95 band', () => {
  const dir = project();
  usage(dir, { seven_day_pct: 97 });
  post(dir);
  assert.equal(saves(dir, 95), 1);
  assert.equal(saves(dir, 80), 0);
});

test('figures older than 2 minutes, or all null, are ignored', () => {
  const dir = project();
  usage(dir, { context_pct: 99 }, 3 * 60 * 1000);
  assert.equal(post(dir), null);
  usage(dir, {});
  assert.equal(post(dir), null);
  assert.equal(saves(dir, 95) + saves(dir, 80), 0);
});

test('bands re-arm when the figure drops (after compaction or a window reset)', () => {
  const dir = project();
  usage(dir, { context_pct: 85 }); post(dir);
  usage(dir, { context_pct: 10 }); post(dir);
  usage(dir, { context_pct: 86 });
  assert.match(ctx(post(dir)), /update your notes now/);
  assert.equal(saves(dir, 80), 2);
});

test('notes: off keeps the 80 % save but drops the reminder', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Settings\n- notes: off\n');
  usage(dir, { context_pct: 81 });
  assert.equal(post(dir), null);
  assert.equal(saves(dir, 80), 1);
});

test('UserPromptSubmit and Stop also check the bands; Stop shows the message without context', () => {
  const dir = project();
  usage(dir, { context_pct: 95 });
  const o = run(dir, 'Stop', {});
  assert.equal(o.systemMessage, MSG95);
  assert.ok(!o.hookSpecificOutput, 'Stop carries no additionalContext');
  const d2 = project();
  usage(d2, { context_pct: 80 });
  assert.match(ctx(run(d2, 'UserPromptSubmit', { prompt: 'go on' })), /update your notes now/);
});

test('a missing usage file changes nothing', () => {
  const dir = project();
  assert.equal(post(dir), null);
});
