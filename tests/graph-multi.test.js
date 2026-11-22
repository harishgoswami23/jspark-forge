'use strict';
// More than one build graph open at a time (owner 2026-11-22). A graph that waits at a human step no longer blocks
// another graph. Helper steps and gates of two graphs still never run at the same moment, unless both graphs carry a
// "- lock: <name>" line and the names differ; a graph with no lock line runs alone, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'gm-1';

function project(graphs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-multi-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  for (const [n, t] of Object.entries(graphs)) fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', `${n}.md`), t);
  return dir;
}
const env = (dir, sid = SID, extra = {}) => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sid, CLAUDE_CODE_SESSION_ATTENDED: '1' }, extra);
const cli = (dir, args, sid) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8', env: env(dir, sid) }).stdout;
const hook = (dir, event, input, sid = SID, extra) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir, sid, extra),
    input: JSON.stringify(Object.assign({ session_id: sid, cwd: dir, source: 'startup' }, input)) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const say = (dir, prompt) => { const o = hook(dir, 'UserPromptSubmit', { prompt }); return (o && o.systemMessage) || ''; };
const helperStarted = (dir, type) => hook(dir, 'SubagentStart', { agent_id: `a${Date.now()}${Math.random()}`, agent_type: type });
const report = (dir, n, step, outputs = {}) => {
  const f = path.join(dir, '.jspark-forge', 'state', `report-${step}.json`);
  fs.writeFileSync(f, JSON.stringify(outputs));
  return cli(dir, ['done', n, step, '--from', f]);
};
const ran = (dir, command) => hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: 'ok' } });
const st = (dir, n) => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', `graph-${n}.json`), 'utf8'));
const startTrusted = (dir, n) => { say(dir, `TRUST GRAPH ${n}`); return cli(dir, ['start', n]); };

// main: waits for the person first, then builds. trial: one helper step. Neither runs commands.
const MAIN = (n, lock) => `# Graph: ${n}\n${lock ? `- lock: ${lock}\n` : ''}## approve (human)\n- say: Approve the plan.\n\n## build (agent)\n- helper: builder\n- after: approve\n`;
const TRIAL = (n, lock) => `# Graph: ${n}\n${lock ? `- lock: ${lock}\n` : ''}## work (agent)\n- helper: checker\n`;
const WORK2 = (n, lock) => `# Graph: ${n}\n${lock ? `- lock: ${lock}\n` : ''}## work (agent)\n- helper: checker\n\n## more (agent)\n- helper: checker\n- after: work\n`;
const GATE = (n, lock) => `# Graph: ${n}\n${lock ? `- lock: ${lock}\n` : ''}## check (gate)\n- run: npm test\n`;

test('a graph that waits at a human step does not block another graph from starting and running', () => {
  const dir = project({ main: MAIN('main'), trial: TRIAL('trial') });
  cli(dir, ['start', 'main']);
  assert.match(cli(dir, ['next', 'main']), /Step approve \(human\)/);
  assert.match(cli(dir, ['start', 'trial']), /Started build graph trial/);
  assert.match(cli(dir, ['next', 'trial']), /Step work \(agent\)/);
  helperStarted(dir, 'jspark-forge:checker');
  assert.match(report(dir, 'trial', 'work'), /work done/);
  assert.match(cli(dir, ['next', 'trial']), /Build graph trial finished/);
  assert.equal(st(dir, 'main').steps.approve.state, 'running', 'the first graph still waits for the person');
  assert.match(say(dir, 'DONE approve'), /approve done/);
  assert.match(cli(dir, ['next', 'main']), /Step build \(agent\)/);
});

test('graph status with no name lists every open graph and what each waits for', () => {
  const dir = project({ main: MAIN('main'), trial: WORK2('trial') });
  assert.match(cli(dir, ['status']), /No build graph is open/);
  cli(dir, ['start', 'main']); cli(dir, ['next', 'main']);
  cli(dir, ['start', 'trial']); cli(dir, ['next', 'trial']);
  const s = cli(dir, ['status']);
  assert.match(s, /2 build graphs are open/);
  assert.match(s, /main: 0 of 2 steps done; approve waiting for the user/);
  assert.match(s, /trial: 0 of 2 steps done; work running/);
  cli(dir, ['stop', 'trial']);
  const one = cli(dir, ['status']);
  assert.match(one, /main:/);
  assert.doesNotMatch(one, /trial:/);
});

test('the session-start summary and the handoff name every open graph', () => {
  const dir = project({ main: MAIN('main'), trial: WORK2('trial') });
  cli(dir, ['start', 'main']); cli(dir, ['next', 'main']);
  cli(dir, ['start', 'trial']); cli(dir, ['next', 'trial']);
  const ctx = hook(dir, 'SessionStart', {}, 'gm-2').hookSpecificOutput.additionalContext;
  assert.match(ctx, /Build graph main: 0 of 2 steps done/);
  assert.match(ctx, /Build graph trial: 0 of 2 steps done/);
  spawnSync(process.execPath, [FORGE, 'save'], { cwd: dir, encoding: 'utf8', env: env(dir) });
  const h = fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
  assert.match(h, /\*\*Task:\*\* Build graphs main, trial/);
  assert.match(h, /\*\*Step:\*\* .*main: 0 of 2 done; approve waiting for the user \| trial: 0 of 2 done; work running/);
});

test('with no lock line a graph runs alone: its helper steps and gates wait for another graph\'s, and the other way round', () => {
  const dir = project({ a: WORK2('a'), b: TRIAL('b'), c: GATE('c') });
  cli(dir, ['start', 'a']);
  assert.match(cli(dir, ['next', 'a']), /Step work \(agent\)/);
  assert.match(cli(dir, ['start', 'b']), /Started build graph b/, 'starting is allowed');
  const held = cli(dir, ['next', 'b']);
  assert.match(held, /Step work \(agent\) is not started: build graph a is running work/);
  assert.doesNotMatch(held, /use the Agent tool/);
  assert.equal(st(dir, 'b').steps.work.state, 'waiting');
  startTrusted(dir, 'c');
  assert.match(cli(dir, ['next', 'c']), /Step check \(gate\) is not started: build graph a is running work/);
  helperStarted(dir, 'jspark-forge:checker');
  assert.match(report(dir, 'a', 'work'), /work done/);
  // a is between steps: whoever asks first gets to run
  assert.match(cli(dir, ['next', 'c']), /Step check \(gate\): Run each command/);
  assert.match(cli(dir, ['next', 'a']), /Step more \(agent\) is not started: build graph c is running check/, 'a gate that was handed out and has not passed holds the others');
  assert.match(cli(dir, ['next', 'b']), /is not started: build graph c is running check/);
  ran(dir, 'npm test');
  assert.equal(st(dir, 'c').steps.check.state, 'done', 'the exit code went to the graph whose gate it is');
  assert.match(cli(dir, ['next', 'a']), /Step more \(agent\)/);
});

test('"- lock: <name>": the same name waits, different names run side by side, and a graph without one still runs alone', () => {
  const same = project({ a: TRIAL('a', 'db'), b: TRIAL('b', 'db') });
  cli(same, ['start', 'a']); cli(same, ['next', 'a']); cli(same, ['start', 'b']);
  assert.match(cli(same, ['next', 'b']), /is not started: build graph a is running work[\s\S]*lock "db"/);

  const diff = project({ a: TRIAL('a', 'db'), b: TRIAL('b', 'docs') });
  cli(diff, ['start', 'a']); cli(diff, ['next', 'a']); cli(diff, ['start', 'b']);
  assert.match(cli(diff, ['next', 'b']), /Step work \(agent\): use the Agent tool/);
  // each helper start is evidence for one step only, and both graphs can be reported
  helperStarted(diff, 'jspark-forge:checker');
  assert.match(report(diff, 'a', 'work'), /work done/);
  assert.match(report(diff, 'b', 'work'), /Refused: no checker helper ran/, 'one helper start does not serve two graphs');
  helperStarted(diff, 'jspark-forge:checker');
  assert.match(report(diff, 'b', 'work'), /work done/);

  const mixed = project({ a: TRIAL('a', 'db'), b: TRIAL('b') });
  cli(mixed, ['start', 'a']); cli(mixed, ['next', 'a']); cli(mixed, ['start', 'b']);
  assert.match(cli(mixed, ['next', 'b']), /is not started: build graph a is running work/);
});

test('the lock line is checked, is fixed for the run, and is part of what TRUST GRAPH covers', () => {
  const { parse, validate } = require('../scripts/lib/graph');
  assert.equal(parse(TRIAL('a', 'db')).lock, 'db');
  assert.deepEqual(validate(parse(TRIAL('a', 'db')), 'a'), []);
  assert.match(validate(parse(TRIAL('a', 'My DB!')), 'a').map(e => e.message).join('|'), /lock must be a short name/);
  const dir = project({ a: TRIAL('a') });
  cli(dir, ['start', 'a']); cli(dir, ['stop', 'a']);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'a.md'), TRIAL('a', 'docs'));
  const again = cli(dir, ['start', 'a']);
  assert.match(again, /TRUST GRAPH a/, 'declaring a graph safe to run beside others is the person\'s call');
  assert.match(again, /lock: docs/i);
  assert.doesNotMatch(again, /Started/);
});

test('DONE with two graphs: one waiting step is completed; the same step waiting in two graphs asks which', () => {
  const dir = project({ main: MAIN('main'), other: MAIN('other') });
  cli(dir, ['start', 'main']); cli(dir, ['next', 'main']);
  cli(dir, ['start', 'other']);
  assert.match(say(dir, 'DONE approve'), /approve done/, 'only one graph waits at it');
  assert.equal(st(dir, 'main').steps.approve.state, 'done');
  assert.equal(st(dir, 'other').steps.approve.state, 'waiting');

  const d2 = project({ main: MAIN('main'), other: MAIN('other') });
  cli(d2, ['start', 'main']); cli(d2, ['next', 'main']);
  cli(d2, ['start', 'other']); cli(d2, ['next', 'other']);
  const which = say(d2, 'DONE approve');
  assert.match(which, /more than one build graph \(main, other\)[\s\S]*DONE <graph> approve/);
  assert.equal(st(d2, 'main').steps.approve.state, 'running', 'nothing is completed on a guess');
  assert.equal(say(d2, 'done'), '', 'bare done with two waiting is an ordinary message');
  assert.match(say(d2, 'DONE other approve'), /approve done[\s\S]*graph next other/);
  assert.equal(st(d2, 'other').steps.approve.state, 'done');
  assert.equal(st(d2, 'main').steps.approve.state, 'running');
  assert.match(say(d2, 'done'), /approve done[\s\S]*graph next main/, 'now exactly one waits');
});

test('a record written by an older version (one graph name) is still read', () => {
  const dir = project({ main: MAIN('main') });
  cli(dir, ['start', 'main']); cli(dir, ['next', 'main']);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-active.json'), JSON.stringify({ name: 'main' }));
  assert.match(cli(dir, ['status']), /main: 0 of 2 steps done/);
  assert.match(say(dir, 'DONE approve'), /approve done/);
});
