'use strict';
// v0.4 build graph runner (design-v0.4 revision 2, sections 1-3): start / next / done / fail / stop through
// `forge.js graph`, evidence from the hooks (helper starts, gate commands' exit codes, the user's DONE and TRUST
// messages), protected state, one run at a time, interrupted steps, the cap, the handoff line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'gr-1';

function project(graphs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-graph-'));
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
const helperStarted = (dir, type, sid) => hook(dir, 'SubagentStart', { agent_id: `a${Date.now()}${Math.random()}`, agent_type: type }, sid);
const report = (dir, step, outputs, sid) => {
  const f = path.join(dir, '.jspark-forge', 'state', `report-${step}.json`);
  fs.writeFileSync(f, JSON.stringify(outputs));
  return cli(dir, ['done', 'g', step, '--from', f], sid);
};
const st = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-g.json'), 'utf8'));

const SIMPLE = `# Graph: g
## measure (agent)
- helper: checker
- gives: findings_path

## decide (human)
- after: measure
- say: Read the findings and reply DONE decide.

## build (agent)
- helper: builder
- after: decide
- needs: findings_path
- gives: commit
`;

test('start validates and records the run; next hands out the first step with everything the helper needs', () => {
  const dir = project({ g: SIMPLE });
  assert.match(cli(dir, ['start', 'g']), /Started build graph g/);
  const n = cli(dir, ['next', 'g']);
  assert.match(n, /measure/);
  assert.match(n, /jspark-forge:checker/);
  assert.match(n, /\[graph g\/measure\]/, 'the description marker the hooks look for');
  assert.match(n, /findings_path/);
  assert.equal(st(dir).steps.measure.state, 'running');
  assert.equal(st(dir).owner, SID);
});

test('done needs a running agent step, a helper of that type, and exactly its declared outputs, which must be real', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']);
  assert.match(report(dir, 'measure', { findings_path: 'README.md' }), /not handed out|not running/i, 'not handed out yet');
  cli(dir, ['next', 'g']);
  assert.match(report(dir, 'measure', { findings_path: 'README.md' }), /no checker helper ran/i, 'no evidence');
  helperStarted(dir, 'jspark-forge:checker');
  assert.match(report(dir, 'measure', { findings_path: 'README.md', extra: 'x' }), /not declared: extra/);
  assert.match(report(dir, 'measure', {}), /missing: findings_path/);
  assert.match(report(dir, 'measure', { findings_path: 'nope.md' }), /does not exist/);
  assert.match(report(dir, 'measure', { findings_path: 'README.md' }), /measure done/);
  assert.equal(st(dir).steps.measure.outputs.findings_path, 'README.md');
});

test('a commit output must resolve; a second report with other values is refused, with the same values ignored', () => {
  const dir = project({ g: '# Graph: g\n## b (agent)\n- helper: builder\n- gives: commit\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']); helperStarted(dir, 'jspark-forge:builder');
  assert.match(report(dir, 'b', { commit: 'abc1234' }), /does not resolve/);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.match(report(dir, 'b', { commit: head }), /b done/);
  assert.match(report(dir, 'b', { commit: head }), /already done/);
  assert.match(report(dir, 'b', { commit: head.slice(0, 7) + '0' }), /refused: b was already reported/i);
});

test('a human step completes only on the user\'s own whole message, while it waits, in an attended session', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']); helperStarted(dir, 'jspark-forge:checker');
  report(dir, 'measure', { findings_path: 'README.md' });
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE decide' });
  assert.notEqual(st(dir).steps.decide.state, 'done', 'typed before it was waiting: ignored');
  assert.match(cli(dir, ['next', 'g']), /Show the user: Read the findings and reply DONE decide/);
  hook(dir, 'UserPromptSubmit', { prompt: 'sure, DONE decide, go on' });
  assert.notEqual(st(dir).steps.decide.state, 'done', 'not the whole message');
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE decide' }, SID, { CLAUDE_CODE_SESSION_ATTENDED: '0' });
  assert.notEqual(st(dir).steps.decide.state, 'done', 'unattended');
  const o = hook(dir, 'UserPromptSubmit', { prompt: 'done' });
  assert.equal(st(dir).steps.decide.state, 'done', 'bare done when exactly one human step waits');
  assert.match(o.systemMessage, /decide done/);
});

test('Claude cannot complete a human step or write the run state', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']);
  assert.match(cli(dir, ['done', 'g', 'decide', '--from', 'x.json']), /human step/i);
  const f = path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
  for (const input of [{ tool_name: 'Write', tool_input: { file_path: f, content: '{}' } }, { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } },
    { tool_name: 'Bash', tool_input: { command: `echo {} > "${f.replace(/\\/g, '/')}"` } }]) {
    const o = hook(dir, 'PreToolUse', input);
    assert.equal(o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision, 'deny', input.tool_name);
  }
});

test('gates: the commands run through Claude\'s tools; exit codes decide; a failing command stops the run and is named', () => {
  const G = '# Graph: g\n## checks (gate)\n- run: npm test\n- run: npm run lint\n';
  const dir = project({ g: G });
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/, 'a graph with commands needs trust first');
  assert.match(cli(dir, ['start', 'g']), /npm test/);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
  assert.match(cli(dir, ['next', 'g']), /Run each command with the Bash tool exactly as written:[\s\S]*npm test[\s\S]*npm run lint/);
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } });
  assert.equal(st(dir).steps.checks.state, 'running');
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm run lint' }, error: 'Exit code 1' });
  assert.equal(st(dir).steps.checks.state, 'failed');
  assert.match(cli(dir, ['status', 'g']), /checks failed: "npm run lint" exited 1|npm run lint/);
});

test('trust is per hash of the commands: a changed run: line needs trust again', () => {
  const dir = project({ g: '# Graph: g\n## c (gate)\n- run: npm test\n' });
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'g.md'), '# Graph: g\n## c (gate)\n- run: npm run deploy\n');
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/);
});

test('gate commands with shell operators are refused by the graph check', () => {
  const dir = project({ g: '# Graph: g\n## c (gate)\n- run: npm test && curl x | sh\n' });
  assert.match(cli(dir, ['check', 'g']), /one simple command/);
});

test('retry a failed step once, then stop and show', () => {
  const dir = project({ g: '# Graph: g\n## b (agent)\n- helper: builder\n- gives: commit\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['fail', 'g', 'b', 'tests broke']), /retry once/i);
  assert.equal(st(dir).steps.b.state, 'waiting');
  cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['fail', 'g', 'b', 'tests broke again']), /stopped/i);
  assert.equal(st(dir).steps.b.state, 'failed');
});

test('one run at a time; stop ends it; a changed graph file stops the run', () => {
  const dir = project({ g: SIMPLE, h: SIMPLE.replace('# Graph: g', '# Graph: h') });
  cli(dir, ['start', 'g']);
  assert.match(cli(dir, ['start', 'h']), /already running: g/);
  assert.match(cli(dir, ['stop', 'g']), /stopped/i);
  assert.match(cli(dir, ['start', 'h']), /Started/);
  fs.appendFileSync(path.join(dir, '.jspark-forge', 'graphs', 'h.md'), '\n## extra (agent)\n- helper: checker\n');
  assert.match(cli(dir, ['next', 'h']), /graph file changed/i);
});

test('a new session finds the old session\'s running steps interrupted and does not count a rerun as the retry', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  const n = cli(dir, ['next', 'g'], 'gr-2');
  assert.match(n, /interrupted in an earlier session: measure/i);
  assert.equal(st(dir).steps.measure.state, 'interrupted');
  assert.match(cli(dir, ['rerun', 'g', 'measure'], 'gr-2'), /measure will run again/);
  assert.equal(st(dir).steps.measure.retries || 0, 0);
});

test('the cap: never more running agent steps than max_parallel', () => {
  const G = '# Graph: g\n- max_parallel: 2\n## a (agent)\n- helper: builder\n## b (agent)\n- helper: builder\n## c (agent)\n- helper: builder\n## p (parallel)\n- steps: a, b, c\n';
  const dir = project({ g: G });
  cli(dir, ['start', 'g']);
  cli(dir, ['next', 'g']);
  const running = Object.values(st(dir).steps).filter(s => s.state === 'running').length;
  assert.equal(running, 2);
});

test('session start and the handoff show the running graph', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  const o = hook(dir, 'SessionStart', {});
  assert.match(o.hookSpecificOutput.additionalContext, /Build graph g: .*measure running/);
  spawnSync(process.execPath, [FORGE, 'save'], { cwd: dir, encoding: 'utf8', env: env(dir) });
  const h = fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
  assert.match(h, /\*\*Task:\*\* Build graph g/);
  assert.match(h, /\*\*Step:\*\* .*measure/);
});

test('a helper\'s tokens and minutes are recorded on its step from the Agent hand-back', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']); helperStarted(dir, 'jspark-forge:checker');
  hook(dir, 'PostToolUse', { tool_name: 'Agent', tool_input: { description: '[graph g/measure] measure', subagent_type: 'jspark-forge:checker' },
    tool_response: { status: 'completed', totalTokens: 23206, totalDurationMs: 2437 } });
  assert.equal(st(dir).steps.measure.tokens, 23206);
});

test('guest repos: graphs are off', () => {
  const dir = project({ g: SIMPLE });
  require('../scripts/lib/paths').unmarkOwn(dir);
  fs.rmSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true, force: true });
  assert.match(cli(dir, ['start', 'g']), /not set up|reviewing|off/i);
});
