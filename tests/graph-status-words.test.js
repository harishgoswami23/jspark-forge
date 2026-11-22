'use strict';
// Status wording (owner 2026-11-22): "running" only while a process JSPARK Forge started is alive; a gate that was
// handed out and not run is "waiting to be run"; a gate whose command was stopped before it ended is "interrupted",
// not "failed". A step named like its kind ("gate") is named once in messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'gw-1';

function project(graphs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-words-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  for (const [n, t] of Object.entries(graphs)) fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', `${n}.md`), t);
  return dir;
}
const env = (dir, sid = SID) => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sid, CLAUDE_CODE_SESSION_ATTENDED: '1' });
const cli = (dir, args) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8', env: env(dir) }).stdout;
const hook = (dir, event, input) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir),
    input: JSON.stringify(Object.assign({ session_id: SID, cwd: dir, source: 'startup' }, input)) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const stateFile = dir => path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
const st = dir => JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
const started = graph => { const dir = project({ g: graph }); hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' }); cli(dir, ['start', 'g']); return dir; };
const CHECKS = '# Graph: g\n## checks (gate)\n- run: npm test\n';

test('a gate that was handed out and not run is "waiting to be run"; nothing is called running', () => {
  const dir = started(CHECKS);
  cli(dir, ['next', 'g']);
  const s = cli(dir, ['status', 'g']);
  assert.match(s, /^- checks: waiting to be run \(0 of 1 commands passed\)$/m);
  assert.doesNotMatch(s, /running|not yet passed/);
  assert.match(cli(dir, ['next', 'g']), /waiting for checks waiting to be run/);
});

test('"running" is said only while a process JSPARK Forge started is alive', () => {
  const dir = started(CHECKS);
  cli(dir, ['next', 'g']);
  const s = st(dir);
  s.steps.checks.runner = { pid: process.pid, at: Date.now() }; // a gate runner that is alive (this test's own process)
  fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  assert.match(cli(dir, ['status', 'g']), /^- checks: running \(its commands are being run by graph gate since /m);
});

test('a gate whose runner was killed is "interrupted", not running and not failed', () => {
  const dir = started(CHECKS);
  cli(dir, ['next', 'g']);
  const s = st(dir);
  const dead = spawnSync(process.execPath, ['-e', '0']).pid; // a process that has ended
  s.steps.checks.runner = { pid: dead, at: Date.now() };
  fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  const out = cli(dir, ['status', 'g']);
  assert.match(out, /^- checks: interrupted \(its command was stopped before it ended, so nothing was recorded as failed; 0 of 1 commands passed; run it again\)$/m);
  assert.equal(st(dir).steps.checks.state, 'running', 'the record is unchanged: the gate can be run again');
});

test('a gate command stopped by hand is "interrupted", not "failed"; the run goes on and the gate still has to pass', () => {
  for (const stop of [
    () => ['PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { interrupted: true, stdout: '' } }],
    () => ['PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'The user interrupted the command' }],
    () => ['PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Command timed out after 10m 0s' }],
  ]) {
    const dir = started(CHECKS);
    cli(dir, ['next', 'g']);
    hook(dir, ...stop());
    assert.equal(st(dir).steps.checks.state, 'running', 'not failed');
    assert.match(cli(dir, ['status', 'g']), /^- checks: interrupted \(/m);
    assert.doesNotMatch(cli(dir, ['next', 'g']), /Stopped: checks failed/);
    hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } });
    assert.equal(st(dir).steps.checks.state, 'done', 'only a real pass completes it');
    assert.equal(st(dir).steps.checks.interrupted, undefined);
  }
});

test('a real exit code still fails the gate', () => {
  const dir = started(CHECKS);
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1' });
  assert.equal(st(dir).steps.checks.state, 'failed');
  assert.match(cli(dir, ['status', 'g']), /^- checks: failed \("npm test" exited 1\)/m);
});

test('a helper step that was handed out is "handed to a helper"', () => {
  const dir = project({ g: '# Graph: g\n## build (agent)\n- helper: builder\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['status', 'g']), /^- build: handed to a helper$/m);
});
