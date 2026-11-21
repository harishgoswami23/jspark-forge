'use strict';
// v0.6 token care: a long conversation is the largest cost (every step re-reads all of it). At the end of a reply
// JSPARK Forge tells the user, each time the conversation passes another 150k tokens, that a new session would save
// usage. The note goes to the user only (systemMessage), never into Claude's context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'ffffffff-0000-0000-0000-000000000000';

function fixture() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fresh-home-')));
  fs.mkdirSync(path.join(home, 'projects', 'p'), { recursive: true });
  const tp = path.join(home, 'projects', 'p', `${SID}.jsonl`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fresh-proj-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return { home, dir, tp };
}
const size = (fx, tokens, side = false) => fs.appendFileSync(fx.tp, `${JSON.stringify({ type: 'assistant', isSidechain: side,
  message: { id: `m${Math.random()}`, usage: { input_tokens: 5, cache_creation_input_tokens: 995, cache_read_input_tokens: tokens - 1000, output_tokens: 50 }, content: [{ type: 'text', text: 'ok' }] } })}\n`);
function stop(fx, transcript = fx.tp) {
  const r = spawnSync(process.execPath, [FORGE, 'Stop'], { encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: fx.dir, CLAUDE_CONFIG_DIR: fx.home }),
    input: JSON.stringify({ session_id: SID, cwd: fx.dir, hook_event_name: 'Stop', transcript_path: transcript, last_assistant_message: 'Done.' }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const NOTE = /this conversation is now about (\d+)k tokens[\s\S]*new session[\s\S]*resume/;

test('a short conversation gets no note; passing 150k tokens gets one, to the user only', () => {
  const fx = fixture();
  size(fx, 60000);
  assert.equal(stop(fx), null);
  size(fx, 180000);
  const o = stop(fx);
  assert.match(o.systemMessage, NOTE);
  assert.equal(o.systemMessage.match(NOTE)[1], '180');
  assert.equal(o.hookSpecificOutput, undefined, 'nothing is added to Claude\'s context');
});

test('the note is not repeated until another 150k tokens are passed; a helper\'s size does not count', () => {
  const fx = fixture();
  size(fx, 180000); assert.ok(stop(fx));
  size(fx, 220000); assert.equal(stop(fx), null);
  size(fx, 900000, true); assert.equal(stop(fx), null, 'a helper line is ignored');
  size(fx, 310000); assert.match(stop(fx).systemMessage, /about 310k tokens/);
});

test('after a compaction the count starts over', () => {
  const fx = fixture();
  size(fx, 320000); assert.ok(stop(fx));
  size(fx, 40000); assert.equal(stop(fx), null);
  size(fx, 160000); assert.match(stop(fx).systemMessage, /about 160k tokens/);
});

test('"- fresh-session: off" in rules.md switches the note off', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.dir, '.jspark-forge', 'rules.md'), '## Settings\n- fresh-session: off\n');
  size(fx, 400000);
  assert.equal(stop(fx), null);
});

test('no transcript, or one outside the Claude home: no note and no error', () => {
  const fx = fixture();
  assert.equal(stop(fx, undefined), null);
  const outside = path.join(fx.dir, 't.jsonl');
  fs.writeFileSync(outside, '');
  size(Object.assign({}, fx, { tp: outside }), 400000);
  assert.equal(stop(fx, outside), null);
});

test('the note is logged, and the README says how to switch it off', () => {
  const fx = fixture();
  size(fx, 200000); stop(fx);
  const logDir = path.join(fx.dir, '.jspark-forge', 'log');
  const text = fs.readdirSync(logDir).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('');
  assert.match(text, /FRESH\s+200k tokens/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), /fresh-session: off/);
});
