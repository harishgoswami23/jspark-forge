'use strict';
// v0.6 token care, step 1: measure. `forge.js usage` reads the session's transcript (only inside the Claude home) and
// says in plain words where the tokens went: the main conversation, helpers, what JSPARK Forge's hooks added, the
// biggest tool outputs, and what would save most.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'dddddddd-0000-0000-0000-000000000000';

const asst = (id, usage, content = [{ type: 'text', text: 'ok' }], model = 'claude-test-1') => ({ type: 'assistant', uuid: `u-${id}-${Math.random()}`, message: { id, model, usage, content } });
const result = (toolUseId, text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] } });
const hookCtx = (event, text) => ({ type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: event, content: [text] } });
const U = (cacheRead, out = 100, cacheWrite = 1000, input = 10) => ({ input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: out });

// A temp Claude home with one transcript (and helper transcripts), and a project whose session file names it.
function fixture(mainEntries, helpers = {}) {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-usage-home-')));
  const tdir = path.join(home, 'projects', 'p');
  fs.mkdirSync(tdir, { recursive: true });
  const tp = path.join(tdir, `${SID}.jsonl`);
  fs.writeFileSync(tp, mainEntries.map(e => JSON.stringify(e)).join('\n') + '\n');
  const sub = path.join(tdir, SID, 'subagents');
  for (const [name, h] of Object.entries(helpers)) {
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `${name}.jsonl`), h.entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(path.join(sub, `${name}.meta.json`), JSON.stringify({ agentType: h.type }));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-usage-proj-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', `session-${SID}.json`), JSON.stringify({ session: SID, transcriptPath: tp }));
  return { home, dir, tp };
}
const cli = (fx, args = [], sid = SID) => spawnSync(process.execPath, [FORGE, 'usage', ...args], { cwd: fx.dir, encoding: 'utf8',
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: fx.dir, CLAUDE_CONFIG_DIR: fx.home, CLAUDE_CODE_SESSION_ID: sid }) }).stdout;

test('the report counts each API call once and says how much conversation each step re-read', () => {
  const big = U(400000);
  const fx = fixture([
    asst('m1', big), asst('m1', big), // one call written as two lines (text, then a tool call): counted once
    asst('m2', U(420000)), asst('m3', U(440000)),
  ]);
  const out = cli(fx);
  assert.match(out, /JSPARK Forge usage report/);
  assert.match(out, /Main conversation: 3 steps/);
  assert.match(out, /re-read about 421k tokens/);
});

test('helpers are listed by kind with their step count and model', () => {
  const fx = fixture([asst('m1', U(50000))], {
    'agent-a1': { type: 'jspark-forge:builder', entries: [asst('h1', U(100000), undefined, 'claude-std-1'), asst('h2', U(120000), undefined, 'claude-std-1')] },
    'agent-a2': { type: 'jspark-forge:builder', entries: [asst('h3', U(80000), undefined, 'claude-std-1')] },
    'agent-a3': { type: 'jspark-forge:reviewer', entries: [asst('h4', U(60000))] },
  });
  const out = cli(fx);
  assert.match(out, /Helpers:/);
  assert.match(out, /builder x2: 3 steps, about 101k tokens re-read per step \(claude-std-1\)/);
  assert.match(out, /reviewer x1: 1 step/);
});

test('what JSPARK Forge itself added is shown, small or not, and the biggest tool outputs are named', () => {
  const fx = fixture([
    hookCtx('SessionStart', `JSPARK Forge grounding rule:\n${'x'.repeat(4000)}`),
    hookCtx('PreToolUse', 'JSPARK Forge: update your notes now in .jspark-forge/state/notes.md'),
    hookCtx('SessionStart', 'You have superpowers. '.repeat(100)), // not JSPARK Forge's: not counted as its own
    asst('m1', U(50000), [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }, { type: 'tool_use', id: 't2', name: 'Read', input: {} }]),
    result('t1', 'y'.repeat(80000)), result('t2', 'z'.repeat(4000)),
    asst('m2', U(60000)),
  ]);
  const out = cli(fx);
  assert.match(out, /JSPARK Forge's own notes to Claude: about 1k tokens/);
  assert.match(out, /Biggest tool outputs: Bash \(1 result, about 20k tokens\), Read \(1 result, about 1k tokens\)/);
});

test('advice: a long conversation gets the "new session" line with numbers; a short one does not', () => {
  const long = fixture([asst('m1', U(300000)), asst('m2', U(320000)), asst('m3', U(340000))]);
  assert.match(cli(long), /What would save most:[\s\S]*new session[\s\S]*resume/);
  const short = fixture([asst('m1', U(30000)), asst('m2', U(32000))]);
  assert.doesNotMatch(cli(short), /new session/);
  assert.match(cli(short), /Nothing stands out/);
});

test('advice: one very large tool output and helpers with very many steps are pointed out', () => {
  const many = [];
  for (let i = 0; i < 70; i++) many.push(asst(`h${i}`, U(90000)));
  const fx = fixture([
    asst('m1', U(40000), [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), result('t1', 'y'.repeat(120000)), asst('m2', U(41000)),
  ], { 'agent-a1': { type: 'jspark-forge:builder', entries: many } });
  const out = cli(fx);
  assert.match(out, /A single Bash result was about 30k tokens/);
  assert.match(out, /builder helpers ran 70 steps each on average/);
});

test('a transcript outside the Claude home is not read; no transcript known says so', () => {
  const fx = fixture([asst('m1', U(50000))]);
  const outside = path.join(fx.dir, 'x.jsonl');
  fs.copyFileSync(fx.tp, outside);
  fs.writeFileSync(path.join(fx.dir, '.jspark-forge', 'state', `session-${SID}.json`), JSON.stringify({ session: SID, transcriptPath: outside }));
  assert.match(cli(fx), /no transcript/i);
  assert.match(cli(fx, [], 'eeeeeeee-0000-0000-0000-000000000000'), /no transcript/i);
});

test('a session file with no transcript path: the transcript is found by the session id in the Claude home', () => {
  const fx = fixture([asst('m1', U(50000), [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]), result('t1', 'z'.repeat(60000)), asst('m2', U(60000))]);
  fs.writeFileSync(path.join(fx.dir, '.jspark-forge', 'state', `session-${SID}.json`), JSON.stringify({ session: SID }));
  const out = cli(fx);
  assert.match(out, /Main conversation: 2 steps/);
  assert.match(out, /A single Read result was about 15k tokens[\s\S]*Read only the part that is needed/);
});

test('broken lines, missing usage and an empty file never break the report', () => {
  const fx = fixture([asst('m1', U(50000))]);
  fs.appendFileSync(fx.tp, '{"type":"assistant","message":{"id":"x"}}\nnot json\n\0\0\0\n{"type":"assistant"');
  assert.match(cli(fx), /Main conversation: 1 step/);
  fs.writeFileSync(fx.tp, '');
  assert.match(cli(fx), /no API calls/i);
});

test('the usage skill exists and runs the command', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'skills', 'usage', 'SKILL.md'), 'utf8');
  assert.match(t, /^---\nname: usage\n/);
  assert.match(t, /forge\.js" usage/);
});
