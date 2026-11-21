'use strict';
// v0.7 better gates (docs/design-v0.7.md): "before:" lines checked before a gate starts; every run of a gate command
// recorded (counts, failing names); "retry:" (only what failed, then one full clean run); flaky versus broken;
// progress read from the run's log; time and tokens so far at every step.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const G = require('../scripts/lib/graph');
const gr = require('../scripts/lib/graph-run');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'v07-1';

// A stand-in for a project's test runner. `node t.js <mode>` takes its next exit code for that mode from a plan file
// and prints what Node's own runner prints. The plan lives under .jspark-forge/ so that using it up does not change
// what git sees of the project (the flaky check compares the code before and after).
const T_JS = [
  "const fs = require('fs');",
  "const f = '.jspark-forge/state/t-plan.json';",
  "const p = JSON.parse(fs.readFileSync(f, 'utf8'));",
  'const m = process.argv[2];',
  'const code = (p[m] || []).shift() || 0;',
  'fs.writeFileSync(f, JSON.stringify(p));',
  "const mark = c => (c ? '\\u2716' : '\\u2714');",
  "const n = m === 'retry' ? 2 : 3;",
  "const lines = m === 'retry' ? [mark(code) + ' logs in (2ms)', mark(code) + ' saves (3ms)'] : ['\\u2714 adds (1ms)', mark(code) + ' logs in (2ms)', mark(code) + ' saves (3ms)'];",
  "console.log(lines.concat(['\\u2139 tests ' + n, '\\u2139 pass ' + (code ? n - 2 : n), '\\u2139 fail ' + (code ? 2 : 0), '\\u2139 skipped 0']).join('\\n'));",
  'process.exit(code);',
].join('\n');

function project(graph, plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-v07-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  fs.writeFileSync(path.join(dir, 't.js'), T_JS);
  fs.writeFileSync(path.join(dir, 'app.js'), 'module.exports = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'g.md'), graph);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 't-plan.json'), JSON.stringify(plan || {}));
  return dir;
}
const env = dir => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CODE_SESSION_ATTENDED: '1' });
const cli = (dir, args) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8', env: env(dir) }).stdout;
const hook = (dir, event, input) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir),
  input: JSON.stringify(Object.assign({ session_id: SID, cwd: dir }, input)) });
const st = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-g.json'), 'utf8'));
function started(graph, plan) {
  const dir = project(graph, plan);
  cli(dir, ['start', 'g']);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
  return dir;
}
const FULL = 'node t.js full';
const RETRY = 'node t.js retry';
const plain = `# Graph: g\n## e2e (gate)\n- run: ${FULL}\n`;
const withRetry = `# Graph: g\n## e2e (gate)\n- run: ${FULL}\n- retry: ${RETRY}\n`;
const errsOf = text => G.validate(G.parse(text), 'g').map(e => `${e.line}: ${e.message}`);

// ---------- the graph file ----------
test('graph file: "before:" takes the fixed forms only, and says the line', () => {
  assert.deepEqual(errsOf('# Graph: g\n## e2e (gate)\n- before: free memory 4 GB\n- before: port 5432 open\n- before: port 3000 free\n- before: container app-db running\n- run: npm test\n'), []);
  const e = errsOf('# Graph: g\n## e2e (gate)\n- before: docker info\n- run: npm test\n');
  assert.equal(e.length, 1);
  assert.match(e[0], /^3: gate "e2e": a "before:" line must be one of: free memory/);
});

test('graph file: "before:" and "retry:" belong to gates', () => {
  const e = errsOf('# Graph: g\n## ask (human)\n- say: look\n- before: port 1 open\n- retry: npm test\n');
  assert.match(e.join('\n'), /4: "before:" belongs to a gate step \("ask" is human\)/);
  assert.match(e.join('\n'), /5: "retry:" belongs to a gate step/);
});

test('graph file: "retry:" is one simple command, on a gate with exactly one "run:" line, and not the run command itself', () => {
  assert.deepEqual(errsOf(withRetry), []);
  assert.match(errsOf(`# Graph: g\n## e2e (gate)\n- run: a\n- run: b\n- retry: c\n`).join('\n'), /5: gate "e2e": "retry:" needs exactly one "run:" line \(it has 2\)/);
  assert.match(errsOf(`# Graph: g\n## e2e (gate)\n- run: a\n- retry: b\n- retry: c\n`).join('\n'), /5: gate "e2e" has more than one "retry:" line/);
  assert.match(errsOf(`# Graph: g\n## e2e (gate)\n- run: a\n- retry: b && rm -rf x\n`).join('\n'), /4: gate "e2e": the "retry:" line must be one simple command/);
  assert.match(errsOf(`# Graph: g\n## e2e (gate)\n- run: a\n- retry: a\n`).join('\n'), /4: gate "e2e": the "retry:" command is the same as its "run:" command/);
});

test('trust: the retry command is shown and covered; a gate without one keeps its old entry', () => {
  const dir = project(withRetry);
  const out = cli(dir, ['start', 'g']);
  assert.match(out, /- node t\.js full\n- node t\.js retry\n/);
  assert.deepEqual(gr.load(dir, 'g').guard.gates, [['e2e', [FULL], RETRY]]);
  const old = project(plain);
  assert.deepEqual(gr.load(old, 'g').guard.gates, [['e2e', [FULL]]], 'a graph trusted before v0.7 is not asked about again');
});

// ---------- pre-flight ----------
test('pre-flight: a need that is not met holds the gate back, and nothing fails', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- before: free memory 1024 GB\n- run: ${FULL}\n`);
  const out = cli(dir, ['next', 'g']);
  assert.match(out, /Step e2e \(gate\) is not started\. Before it can run: free memory is [\d.]+ GB, needs 1024 GB\./);
  assert.doesNotMatch(out, /Run each command/);
  assert.equal(st(dir).steps.e2e.state, 'waiting');
  assert.match(cli(dir, ['next', 'g']), /is not started/, 'asked again at the next graph next');
  assert.doesNotMatch(cli(dir, ['status', 'g']), /failed/);
});

test('pre-flight: a need that is met lets the gate start', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- before: free memory 1 MB\n- run: ${FULL}\n`);
  assert.match(cli(dir, ['next', 'g']), /Step e2e \(gate\): Run each command/);
  assert.equal(st(dir).steps.e2e.state, 'running');
});

test('pre-flight: graph gate checks again before it runs anything', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- before: port 5432 open\n- run: ${FULL}\n`);
  const up = { freeMb: () => 9999, portOpen: () => true, containerRunning: () => true };
  const down = Object.assign({}, up, { portOpen: () => false });
  assert.match(gr.next(dir, 'g', SID, { probes: up }), /Run each command/);
  let ran = 0;
  const out = gr.gate(dir, 'g', 'e2e', SID, { probes: down, write: () => {}, run: () => { ran++; return { status: 0 }; } });
  assert.match(out, /Step e2e \(gate\) was not run\. Before it can run: nothing is listening on port 5432\./);
  assert.equal(ran, 0);
  assert.equal(st(dir).steps.e2e.state, 'running', 'not failed: the same command can be run again');
  assert.match(gr.gate(dir, 'g', 'e2e', SID, { probes: up, write: () => {}, run: () => ({ status: 0 }) }), /passed/);
});

// ---------- runs are recorded ----------
test('a failing run says the counts, the failing tests and where the output is; status lists the run', () => {
  const dir = started(plain, { full: [1] });
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Its output goes to \.jspark-forge\/state\/gatelog-g-e2e-1\.log/);
  assert.match(out, /--- last lines of the output ---[\s\S]*ℹ fail 2[\s\S]*--- end ---/);
  assert.match(out, /Step e2e \(gate\) failed: "node t\.js full" exited 1\. 1 passed, 2 failed, 0 skipped\. Failed: logs in; saves\. Full output: \.jspark-forge\/state\/gatelog-g-e2e-1\.log Show the user/);
  const run = st(dir).steps.e2e.runs[0];
  assert.deepEqual([run.n, run.kind, run.exit, run.passed, run.failed, run.names], [1, 'full', 1, 1, 2, ['logs in', 'saves']]);
  assert.ok(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'gatelog-g-e2e-1.log'), 'utf8').includes('✖ logs in'));
  const s = cli(dir, ['status', 'g']);
  assert.match(s, /^ {4}run 1, full, \d\d:\d\d, [\d.]+ min: exit 1; 1 passed, 2 failed, 0 skipped; failed: logs in; saves$/m);
  assert.match(s, /^ {4}output of the last run: \.jspark-forge\/state\/gatelog-g-e2e-1\.log$/m);
});

test('a passing run says the counts in one line', () => {
  const dir = started(plain);
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) passed\. 3 passed, 0 failed, 0 skipped\. Now run: /);
  assert.doesNotMatch(out, /last lines of the output/, 'a pass does not print the output');
  assert.doesNotMatch(out, /Flaky/);
});

test('an output nobody can read keeps the verdict and drops only the counts', () => {
  const dir = started('# Graph: g\n## e2e (gate)\n- run: node t3.js\n');
  fs.writeFileSync(path.join(dir, 't3.js'), "console.log('hm');\nprocess.exit(2);\n");
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) failed: .* exited 2\. Full output: /);
  assert.equal(st(dir).steps.e2e.runs[0].format, undefined);
  assert.equal(st(dir).steps.e2e.state, 'failed');
});

// ---------- retry only what failed, then one full clean run ----------
test('retry: full fails, the retry passes, the full command passes again: done, and the failed tests are named flaky', () => {
  const dir = started(withRetry, { full: [1, 0], retry: [0] });
  assert.match(cli(dir, ['next', 'g']), /If the command fails, the gate is not failed yet: only what failed runs again \(node t\.js retry\)/);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\): "node t\.js full" exited 1\. 1 passed, 2 failed, 0 skipped\. Failed: logs in; saves\./);
  assert.match(out, /Not failed yet: only what failed runs again now \(node t\.js retry\); then the full command must pass once more\./);
  assert.match(out, /Step e2e \(gate\): the retry passed\. 2 passed, 0 failed, 0 skipped\. A retry alone never completes a gate/);
  assert.match(out, /Step e2e \(gate\) passed\. 3 passed, 0 failed, 0 skipped\. Flaky \(failed, then passed with no change to the code; a flaky test is not a fixed test\), tell the user: logs in; saves\. Now run: /);
  const step = st(dir).steps.e2e;
  assert.equal(step.state, 'done');
  assert.deepEqual(step.runs.map(r => [r.kind, r.exit]), [['full', 1], ['retry', 0], ['full', 0]]);
  assert.deepEqual(step.flaky, ['logs in', 'saves']);
  const end = cli(dir, ['next', 'g']);
  assert.match(end, /Flaky in this run \(failed, then passed with no change to the code; a flaky test is not a fixed test\)\. Tell the user: e2e: logs in; saves/);
  assert.match(end, /Build graph g finished\./);
  assert.match(cli(dir, ['status', 'g']), /^ {4}flaky \(failed, then passed with no change to the code; not fixed\): logs in; saves$/m);
});

test('retry: the retry itself fails: the gate fails (broken), and nothing more runs', () => {
  const dir = started(withRetry, { full: [1, 0], retry: [1] });
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) failed: "node t\.js retry" exited 1 \(the retry of what failed\)\./);
  const step = st(dir).steps.e2e;
  assert.equal(step.state, 'failed');
  assert.deepEqual(step.runs.map(r => r.kind), ['full', 'retry']);
  assert.equal(step.flaky, undefined);
});

test('retry: the full run after the retry fails: the gate fails, a retry never completes it', () => {
  const dir = started(withRetry, { full: [1, 1], retry: [0] });
  cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) failed: "node t\.js full" exited 1 \(the full run after the retry\)\./);
  assert.equal(st(dir).steps.e2e.state, 'failed');
  assert.deepEqual(st(dir).steps.e2e.runs.map(r => [r.kind, r.exit]), [['full', 1], ['retry', 0], ['full', 1]]);
});

test('retry: one round per hand-out; graph rerun gives a new one', () => {
  const dir = started(withRetry, { full: [1, 1, 1, 0], retry: [0, 0] });
  cli(dir, ['next', 'g']);
  cli(dir, ['gate', 'g', 'e2e']);
  assert.equal(st(dir).steps.e2e.state, 'failed');
  assert.match(cli(dir, ['rerun', 'g', 'e2e']), /will run again/);
  cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'e2e']), /Step e2e \(gate\) passed\./);
  assert.deepEqual(st(dir).steps.e2e.runs.map(r => r.kind), ['full', 'retry', 'full', 'full', 'retry', 'full']);
});

test('without a "retry:" line a failing command fails the gate at once, as before', () => {
  const dir = started(plain, { full: [1] });
  cli(dir, ['next', 'g']);
  cli(dir, ['gate', 'g', 'e2e']);
  assert.equal(st(dir).steps.e2e.state, 'failed');
  assert.equal(st(dir).steps.e2e.runs.length, 1);
});

// ---------- flaky versus broken ----------
test('flaky: failed, run again unchanged, passed: named flaky', () => {
  const dir = started(plain, { full: [1, 0] });
  cli(dir, ['next', 'g']); cli(dir, ['gate', 'g', 'e2e']);
  cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'e2e']), /passed\. 3 passed, 0 failed, 0 skipped\. Flaky \(.*\), tell the user: logs in; saves\./);
});

test('flaky: when the code changed in between, the tests may have been fixed: nothing is called flaky', () => {
  const dir = started(plain, { full: [1, 0] });
  cli(dir, ['next', 'g']); cli(dir, ['gate', 'g', 'e2e']);
  fs.writeFileSync(path.join(dir, 'app.js'), 'module.exports = 2; // the fix\n');
  cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) passed\./);
  assert.doesNotMatch(out, /Flaky/);
  assert.equal(st(dir).steps.e2e.flaky, undefined);
});

test('flaky: a failure nobody could name is still said, without names', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- run: node t2.js\n`);
  // not a known runner's output; fails the first time, passes the second (its own marker is under .jspark-forge/)
  fs.writeFileSync(path.join(dir, 't2.js'), "const fs=require('fs');const f='.jspark-forge/state/t2';const again=fs.existsSync(f);fs.writeFileSync(f,'x');console.log('hm');process.exit(again?0:1);\n");
  // only t2.js is committed: "git add -A" would also track JSPARK Forge's own state files, which change at every run
  execFileSync('git', ['add', 't2.js'], { cwd: dir }); execFileSync('git', ['commit', '-qm', 't2'], { cwd: dir });
  cli(dir, ['next', 'g']); cli(dir, ['gate', 'g', 'e2e']);
  cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'e2e']), /Flaky \(.*\), tell the user: the command failed and then passed unchanged \(the test names could not be read\)\./);
});

// ---------- a gate command run by hand with the Bash tool ----------
const OUT_BAD = '✔ adds (1ms)\n✖ logs in (2ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\nℹ skipped 0\n';
const OUT_OK = '✔ adds (1ms)\n✔ logs in (2ms)\nℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ skipped 0\n';

test('Bash tool: the run is recorded from the output the tool reports', () => {
  const dir = started(plain);
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: FULL }, tool_response: { stdout: OUT_OK } });
  const step = st(dir).steps.e2e;
  assert.equal(step.state, 'done');
  assert.deepEqual([step.runs[0].exit, step.runs[0].passed, step.runs[0].failed], [0, 2, 0]);
});

test('Bash tool: with a "retry:" line a failure asks for the retry, then for the full command once more', () => {
  const dir = started(withRetry);
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: FULL }, error: `Exit code 1\n${OUT_BAD}` });
  assert.equal(st(dir).steps.e2e.state, 'running', 'not failed yet');
  assert.deepEqual(st(dir).steps.e2e.runs[0].names, ['logs in']);
  let out = cli(dir, ['next', 'g']);
  assert.match(out, /Step e2e \(gate\) still needs: node t\.js retry \(the full command failed; this runs only what failed\)\./);
  assert.match(cli(dir, ['status', 'g']), /- e2e: not yet passed \(the full command failed; the retry of what failed is next, none running\)/);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: RETRY }, tool_response: { stdout: OUT_OK } });
  out = cli(dir, ['next', 'g']);
  assert.match(out, /Step e2e \(gate\) still needs: node t\.js full \(the retry passed; the full command must pass once more\)\./);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: FULL }, tool_response: { stdout: OUT_OK } });
  assert.equal(st(dir).steps.e2e.state, 'done');
  assert.deepEqual(st(dir).steps.e2e.flaky, ['logs in']);
});

// ---------- progress and cost ----------
test('progress: status reads the log of the run that graph gate is making', () => {
  const dir = started(plain);
  cli(dir, ['next', 'g']);
  const f = path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  s.steps.e2e.runner = { pid: process.pid, at: Date.now() }; // a runner that is alive: this test process
  fs.writeFileSync(f, JSON.stringify(s));
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'gatelog-g-e2e-1.log'), 'TAP version 13\n1..63\nok 1 - a\nok 2 - b\nnot ok 3 - c\nok 4 - d\n');
  assert.match(cli(dir, ['status', 'g']), /- e2e: running \(its commands are being run by graph gate since \d\d:\d\d; 4 of 63 tests done, 1 failed\)/);
});

test('cost: every graph next ends with the time and tokens so far', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- run: ${FULL}\n## ask (human)\n- say: look at it\n- after: e2e\n`);
  assert.doesNotMatch(cli(dir, ['next', 'g']), /So far:/, 'nothing is done yet');
  cli(dir, ['gate', 'g', 'e2e']);
  const out = cli(dir, ['next', 'g']);
  assert.match(out, /So far: 1 of 2 steps done, [\d.]+ min \(last: e2e, [\d.]+ min\)\. Tokens are counted for helper steps only\./);
  assert.match(cli(dir, ['status', 'g']), /So far: 1 of 2 steps done/);
});

test('logs: the last 5 of a step are kept', () => {
  const dir = started(plain, { full: [1, 1, 1, 1, 1, 1, 0] });
  cli(dir, ['next', 'g']);
  for (let i = 0; i < 7; i++) { cli(dir, ['gate', 'g', 'e2e']); if (i < 6) { cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']); } }
  const logs = fs.readdirSync(path.join(dir, '.jspark-forge', 'state')).filter(n => /^gatelog-g-e2e-\d+\.log$/.test(n)).sort();
  assert.deepEqual(logs, [3, 4, 5, 6, 7].map(k => `gatelog-g-e2e-${k}.log`));
  assert.equal(st(dir).steps.e2e.state, 'done');
});

// ---------- found by the review of v0.7 ----------
test('review 1: a gate that waits for a parallel step is still checked before it starts', () => {
  const dir = started('# Graph: g\n## a (human)\n- say: do a\n## b (human)\n- say: do b\n## both (parallel)\n- steps: a, b\n' +
    `## e2e (gate)\n- after: both\n- before: free memory 1024 GB\n- run: ${FULL}\n`);
  cli(dir, ['next', 'g']);
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE a' });
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE b' });
  const out = cli(dir, ['next', 'g']);
  assert.match(out, /Step e2e \(gate\) is not started\. Before it can run: free memory is/);
  assert.doesNotMatch(out, /Run each command/);
  assert.equal(st(dir).steps.e2e.state, 'waiting');
});

test('review 1: a check that cannot be made holds the gate back too', () => {
  const dir = started(`# Graph: g\n## e2e (gate)\n- before: port 5432 open\n- run: ${FULL}\n`);
  const out = gr.next(dir, 'g', SID, { probes: { freeMb: () => 9999, portOpen: () => null, containerRunning: () => null } });
  assert.match(out, /is not started\. Before it can run: could not check port 5432/);
  assert.equal(st(dir).steps.e2e.state, 'waiting');
});

test('review 2: a fix made in a new file that was never added is a change: nothing is called flaky', () => {
  const dir = started(plain, { full: [1, 0] });
  fs.writeFileSync(path.join(dir, 'new-feature.js'), 'module.exports = 1; // broken\n');
  cli(dir, ['next', 'g']); cli(dir, ['gate', 'g', 'e2e']);
  fs.writeFileSync(path.join(dir, 'new-feature.js'), 'module.exports = 22; // the fix, in a file git does not track yet\n');
  cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']);
  const out = cli(dir, ['gate', 'g', 'e2e']);
  assert.match(out, /Step e2e \(gate\) passed\./);
  assert.doesNotMatch(out, /Flaky/);
  assert.equal(st(dir).steps.e2e.flaky, undefined);
});

test('review 2: an untracked file that did not change does not hide a flaky test', () => {
  const dir = started(plain, { full: [1, 0] });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'untouched\n');
  cli(dir, ['next', 'g']); cli(dir, ['gate', 'g', 'e2e']);
  cli(dir, ['rerun', 'g', 'e2e']); cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'e2e']), /Flaky \(.*\), tell the user: logs in; saves\./);
});

test('review 4: a command that ended without an exit code (a timeout) is not a test failure: nothing is called flaky', () => {
  const dir = started(withRetry);
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: FULL }, error: 'Command timed out after 10m 0s' });
  assert.equal(st(dir).steps.e2e.runs[0].exit, '?');
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: RETRY }, tool_response: { stdout: OUT_OK } });
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: FULL }, tool_response: { stdout: OUT_OK } });
  const step = st(dir).steps.e2e;
  assert.equal(step.state, 'done');
  assert.equal(step.flaky, undefined);
  assert.equal(step.flakyUnnamed, undefined);
});

test('review 6: when this run wrote no log, an older log with the same number is not read as its result', () => {
  const dir = started(plain);
  cli(dir, ['next', 'g']);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'gatelog-g-e2e-1.log'), OUT_BAD);
  const out = gr.gate(dir, 'g', 'e2e', SID, { write: () => {}, run: () => ({ status: 0 }) });
  assert.match(out, /Step e2e \(gate\) passed\. Now run: /);
  const run = st(dir).steps.e2e.runs[0];
  assert.equal(run.format, undefined);
  assert.equal(run.names, undefined);
});

test('review 7: during the retry a pass of the full command changes nothing; before a failure the retry command changes nothing', () => {
  const dir = started(withRetry);
  cli(dir, ['next', 'g']);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: RETRY }, tool_response: { stdout: OUT_OK } });
  assert.equal(st(dir).steps.e2e.state, 'running', 'the retry command is not one of the gate\'s commands yet');
  assert.equal((st(dir).steps.e2e.runs || []).length, 0);
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: FULL }, error: `Exit code 1\n${OUT_BAD}` });
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: FULL }, tool_response: { stdout: OUT_OK } });
  const step = st(dir).steps.e2e;
  assert.equal(step.state, 'running', 'a full pass while the retry is owed does not complete the gate');
  assert.equal(step.phase, 'retry');
  assert.deepEqual(step.pending, [RETRY]);
  assert.equal(step.runs.length, 1);
});

test('review 7: a run started by the version before (no phase, runs, before or retry in its record) still works', () => {
  const dir = started(plain);
  cli(dir, ['next', 'g']);
  const f = path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const x of s.graph.steps) { delete x.before; delete x.retry; }
  for (const v of Object.values(s.steps)) { delete v.phase; delete v.retried; delete v.runs; }
  fs.writeFileSync(f, JSON.stringify(s));
  assert.match(cli(dir, ['status', 'g']), /- e2e: not yet passed \(0 of 1 commands passed, none running\)/);
  assert.match(cli(dir, ['next', 'g']), /Step e2e \(gate\) still needs: node t\.js full\./);
  assert.match(cli(dir, ['gate', 'g', 'e2e']), /Step e2e \(gate\) passed\./);
  assert.match(cli(dir, ['next', 'g']), /Build graph g finished\./);
});

// ---------- stay reachable (owner 2026-11-22) ----------
const startCtx = (dir, source) => {
  const r = spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'v07-s', cwd: dir, source }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'forge-v07-cfg-')), JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};
const REACH = fs.readFileSync(path.join(__dirname, '..', 'rules', 'stay-reachable.md'), 'utf8').trim();

test('stay reachable: the rule says long commands go in the background and the user\'s mid-task message comes first', () => {
  assert.match(REACH, /^JSPARK Forge stay-reachable rule: /);
  assert.match(REACH, /reaches you only when your current command ends/);
  assert.match(REACH, /longer than about a minute .* in the background/);
  assert.match(REACH, /answer it first, in a line or two, then go back to the task/);
  assert.ok(!REACH.includes('\n'), 'one line');
});

test('stay reachable: it is in the session-start context at startup, resume and compact, once', () => {
  const dir = project(plain);
  for (const source of ['startup', 'resume', 'compact']) {
    const c = startCtx(dir, source);
    assert.ok(c.includes(REACH), source);
    assert.equal(c.split('stay-reachable rule').length, 2, `${source}: said once`);
  }
});

test('stay reachable: "- stay-reachable: off" under ## Settings switches it off; the template shows the switch', () => {
  const dir = project(plain);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Settings\n- stay-reachable: off\n');
  assert.ok(!startCtx(dir, 'startup').includes('stay-reachable rule'));
  const { parseRules } = require('../scripts/lib/rules');
  assert.equal(parseRules('## Settings\n- stay-reachable: off\n').settings['stay-reachable'], 'off');
  assert.deepEqual(parseRules('## Settings\n- stay-reachable: maybe\n').errors.length, 1, 'only on or off');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'templates', 'rules.md'), 'utf8'), /^Example: - stay-reachable: off$/m);
});

test('review 7: the trust value of a graph without "retry:" is exactly what the version before computed', () => {
  const crypto = require('node:crypto');
  const before = crypto.createHash('sha1').update(JSON.stringify({ gates: [['e2e', [FULL]]], human: [] })).digest('hex');
  assert.equal(gr.load(project(plain), 'g').runHash, before);
  assert.notEqual(gr.load(project(withRetry), 'g').runHash, before, 'adding a retry command asks again');
});
