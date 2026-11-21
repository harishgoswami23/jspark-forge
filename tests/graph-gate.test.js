'use strict';
// v0.5.2: a gate whose command outlasts one tool call (the Bash tool waits 10 minutes at most; a command moved to the
// background gives the hooks no exit code, so the gate stayed "running" for ever). `forge.js graph gate <name> <step>`
// runs the gate's own commands itself and records each real exit code; Claude runs it in the background.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'gg-1';
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(3)"';
const MARK = 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'x\')"';

function project(graph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gate-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'g.md'), graph);
  return dir;
}
const env = (dir, sid = SID) => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sid, CLAUDE_CODE_SESSION_ATTENDED: '1' });
const cli = (dir, args, sid) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8', env: env(dir, sid) }).stdout;
const hook = (dir, event, input, sid = SID) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir, sid),
  input: JSON.stringify(Object.assign({ session_id: sid, cwd: dir }, input)) });
const st = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-g.json'), 'utf8'));
function started(graph) {
  const dir = project(graph);
  cli(dir, ['start', 'g']);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
  return dir;
}
const gateOf = (...runs) => `# Graph: g\n## checks (gate)\n${runs.map(r => `- run: ${r}\n`).join('')}`;

test('graph next tells Claude how to run a gate that can take longer than one tool call', () => {
  const dir = started(gateOf(OK));
  const out = cli(dir, ['next', 'g']);
  assert.match(out, /Run each command with the Bash tool exactly as written/);
  assert.match(out, /longer than 9 minutes[\s\S]*in the background: node "[^"]+forge\.js" graph gate g checks/);
});

test('graph gate runs the gate\'s commands itself and records the pass', () => {
  const dir = started(gateOf(OK, MARK));
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'checks']);
  assert.match(out, /passed/);
  assert.match(out, /graph next g/);
  assert.equal(st(dir).steps.checks.state, 'done');
  assert.ok(fs.existsSync(path.join(dir, 'ran.txt')), 'the command ran in the project folder');
  assert.match(cli(dir, ['next', 'g']), /finished/);
});

test('a failing command stops the gate with its real exit code; the commands after it do not run', () => {
  const dir = started(gateOf(BAD, MARK));
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'checks']);
  assert.match(out, /exited 3/);
  assert.equal(st(dir).steps.checks.state, 'failed');
  assert.match(st(dir).steps.checks.reason, /exited 3/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
});

test('a command already passed through the Bash tool is not run again', () => {
  const dir = started(gateOf(MARK, OK));
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: MARK }, tool_response: { stdout: '' } });
  assert.deepEqual(st(dir).steps.checks.passed, [MARK]);
  cli(dir, ['gate', 'g', 'checks']);
  assert.equal(st(dir).steps.checks.state, 'done');
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')), 'only the command still pending ran');
});

test('refused: another session, a step that is not a gate, a gate not handed out yet, an unknown graph', () => {
  const dir = started(`# Graph: g\n## ok (human)\n- say: approve\n\n## checks (gate)\n- after: ok\n- run: ${MARK}\n`);
  cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'checks']), /not running/);
  assert.match(cli(dir, ['gate', 'g', 'ok']), /not a gate/);
  assert.match(cli(dir, ['gate', 'g', 'nope']), /no step/);
  assert.match(cli(dir, ['gate', 'zz', 'checks']), /has not started/);
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE ok' });
  cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'checks'], 'other-session'), /another session/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')), 'nothing ran in any refused case');
  assert.equal(st(dir).steps.checks.state, 'running');
});

test('a command the block list would hold is not run by the gate runner', () => {
  const graphRun = require('../scripts/lib/graph-run');
  const dir = started(gateOf(MARK));
  cli(dir, ['next', 'g']);
  const out = graphRun.gate(dir, 'g', 'checks', SID, { blocked: () => 'it is on the block list', write: () => {} });
  assert.match(out, /Not run[\s\S]*block list[\s\S]*Bash tool/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')));
  assert.equal(st(dir).steps.checks.state, 'running');
});

test('while one runner is alive a second one is refused; a dead runner\'s mark does not block', () => {
  const dir = started(gateOf(OK));
  cli(dir, ['next', 'g']);
  const f = path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
  const s = st(dir);
  s.steps.checks.runner = { pid: process.pid, at: Date.now() }; // this test process is alive
  fs.writeFileSync(f, JSON.stringify(s));
  assert.match(cli(dir, ['gate', 'g', 'checks']), /already being run/);
  s.steps.checks.runner = { pid: 999999, at: Date.now() - 60000 };
  fs.writeFileSync(f, JSON.stringify(s));
  assert.match(cli(dir, ['gate', 'g', 'checks']), /passed/);
  assert.equal(st(dir).steps.checks.runner, undefined, 'the mark is removed when the runner ends');
});

test('a gate left running with nobody running it: graph next names what is left and how to run it', () => {
  const dir = started(gateOf(OK, MARK));
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: OK }, tool_response: { stdout: '' } });
  const out = cli(dir, ['next', 'g']);
  assert.match(out, /waiting for checks running/);
  assert.match(out, /Gate checks still needs: node -e "require[\s\S]*graph gate g checks/);
  assert.doesNotMatch(out, /still needs: node -e "process\.exit\(0\)"/, 'the passed command is not listed');
});

test('graph status says when a gate is being run by the runner; the usage line and the build skill name the command', () => {
  const dir = started(gateOf(OK));
  cli(dir, ['next', 'g']);
  const f = path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
  const s = st(dir);
  s.steps.checks.runner = { pid: process.pid, at: Date.now() };
  fs.writeFileSync(f, JSON.stringify(s));
  assert.match(cli(dir, ['status', 'g']), /checks: running \(its commands are being run by graph gate/);
  assert.match(cli(dir, ['bogus', 'g']), /Usage: .*\bgate\b/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'skills', 'build', 'SKILL.md'), 'utf8'), /graph gate <name> <step>/);
});
