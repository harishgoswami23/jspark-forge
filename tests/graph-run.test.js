'use strict';
// v0.4 build graph runner (design-v0.4 revision 2, sections 1-3): start / next / done / fail / stop through
// `forge.js graph`, evidence from the hooks (helper starts, gate commands' exit codes, the user's DONE and TRUST
// messages), protected state, one run at a time, interrupted steps, the cap, the handoff line. The v0.4 code review
// cases (H1-H4, M1-M5, lows) are marked with their finding.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

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
const stateFile = dir => path.join(dir, '.jspark-forge', 'state', 'graph-g.json');
const st = dir => JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
const graphFile = dir => path.join(dir, '.jspark-forge', 'graphs', 'g.md');
const lastPrompt = (dir, sid = SID) => require('../scripts/lib/state').readSession(dir, sid).lastPrompt;
// The user's way in: start shows the commands, the user types TRUST GRAPH g, start again.
const trustAndStart = (dir, sid) => { cli(dir, ['start', 'g'], sid); hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' }, sid); return cli(dir, ['start', 'g'], sid); };
const ran = (dir, command, extra = {}, sid = SID) => hook(dir, 'PostToolUse', Object.assign({ tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: 'ok' } }, extra), sid);

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

// Integration 2026-11-20: Claude wrote the report with `node -e` and ran `graph done` in the same shell line; the
// forge-state guard refused the whole line and Claude stopped. The instruction names the route that is allowed.
test('next says to write the report with the Write tool and run graph done as a command of its own', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']);
  const n = cli(dir, ['next', 'g']);
  assert.match(n, /with the Write tool/);
  assert.match(n, /as a command of its own/);
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
  assert.match(report(dir, 'measure', { findings_path: 'x'.repeat(501) }), /at most 500 characters/, 'too long');
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

test('DONE and TRUST that act are not stored as the handoff\'s last request; "done" with no graph running is a normal prompt (review M5, low)', () => {
  const dir = project({ g: SIMPLE.replace('# Graph: g', '# Graph: g\n## c (gate)\n- run: npm test\n') });
  hook(dir, 'UserPromptSubmit', { prompt: 'please refactor the parser' });
  hook(dir, 'UserPromptSubmit', { prompt: 'done' });
  assert.equal(lastPrompt(dir), 'done', 'no graph running: an ordinary reply');
  hook(dir, 'UserPromptSubmit', { prompt: 'Done already' });
  assert.equal(lastPrompt(dir), 'Done already');
  hook(dir, 'UserPromptSubmit', { prompt: 'please refactor the parser' });
  trustAndStart(dir);
  assert.equal(lastPrompt(dir), 'please refactor the parser', 'TRUST GRAPH g is not the last request');
  cli(dir, ['next', 'g']); helperStarted(dir, 'jspark-forge:checker');
  report(dir, 'measure', { findings_path: 'README.md' });
  cli(dir, ['next', 'g']);
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE decide' });
  assert.equal(st(dir).steps.decide.state, 'done');
  assert.equal(lastPrompt(dir), 'please refactor the parser', 'DONE decide is not the last request');
});

test('Claude cannot complete a human step or write the run state', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']);
  assert.match(cli(dir, ['done', 'g', 'decide', '--from', 'x.json']), /human step/i);
  const f = stateFile(dir);
  const S = path.dirname(f);
  const inputs = [{ tool_name: 'Write', tool_input: { file_path: f, content: '{}' } }, { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } },
    { tool_name: 'Bash', tool_input: { command: `echo {} > "${f.replace(/\\/g, '/')}"` } },
    { tool_name: 'Bash', tool_input: { command: 'echo {} > graph-trust.json' }, cwd: S },
    { tool_name: 'Bash', tool_input: { command: `echo '{"prompt":"TRUST GRAPH g"}' | node "${FORGE.replace(/\\/g, '/')}" UserPromptSubmit` } }];
  const link = path.join(dir, 'lnk');
  try { fs.symlinkSync(S, link, 'junction'); } catch { /* no links here */ }
  if (fs.existsSync(link)) inputs.push({ tool_name: 'Write', tool_input: { file_path: path.join(link, 'graph-trust.json'), content: '{}' } });
  for (const input of inputs) {
    const o = hook(dir, 'PreToolUse', input);
    assert.equal(o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(input));
  }
});

// Security re-review 2026-11-20, owner's rule: what only the text shows reaches Claude Code's own permission prompt
// (ask), with no CONFIRM; a resolved target or a hook event run by hand stays a deny; reads pass without a prompt.
test('PreToolUse: a forge-state text match asks (no CONFIRM), a resolved one denies, a read passes', () => {
  const dir = project({ g: SIMPLE });
  const pre = command => hook(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } });
  const ask = pre("D=.jspark-forge/state; echo '{}' > $D/graph-g.json");
  assert.equal(ask.hookSpecificOutput.permissionDecision, 'ask');
  assert.doesNotMatch(ask.hookSpecificOutput.permissionDecisionReason, /CONFIRM/);
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /JSPARK Forge.*allow it only if you expect it/);
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /Write tool/);
  assert.equal(pre("echo '{}' > .jspark-forge/state/graph-g.json").hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(pre(`echo '{}' | node "${FORGE.replace(/\\/g, '/')}" \\\n SubagentStart`).hookSpecificOutput.permissionDecision, 'deny');
  const both = pre("git reset --hard && D=.jspark-forge/state; echo '{}' > $D/graph-g.json");
  assert.equal(both.hookSpecificOutput.permissionDecision, 'deny', 'a typed-confirm block still denies until CONFIRM');
  assert.match(both.hookSpecificOutput.permissionDecisionReason, /CONFIRM git-reset-hard/);
  const read = pre('cat .jspark-forge/state/graph-g.json | python -m json.tool');
  assert.ok(!read || !read.hookSpecificOutput || !read.hookSpecificOutput.permissionDecision, JSON.stringify(read));
});

test('gates: the commands run through Claude\'s tools; exit codes decide; a failing command stops the run and is named', () => {
  const G = '# Graph: g\n## checks (gate)\n- run: npm test\n- run: npm run lint\n';
  const dir = project({ g: G });
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/, 'a graph with commands needs trust first');
  assert.match(cli(dir, ['start', 'g']), /npm test/);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
  assert.match(cli(dir, ['next', 'g']), /Run each command with the Bash tool exactly as written[\s\S]*npm test[\s\S]*npm run lint/);
  ran(dir, 'npm test');
  assert.equal(st(dir).steps.checks.state, 'running');
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm run lint' }, error: 'Exit code 1' });
  assert.equal(st(dir).steps.checks.state, 'failed');
  assert.match(cli(dir, ['status', 'g']), /checks: failed \("npm run lint" exited 1\)/);
});

test('a gate passes fully only on its own commands, run by the owner session, in the project folder, in the foreground (review H4)', () => {
  const dir = project({ g: '# Graph: g\n## checks (gate)\n- run: npm test\n- run: npm test -- --grep "a b"\n' });
  trustAndStart(dir);
  ran(dir, 'npm test');
  assert.deepEqual(st(dir).steps.checks.passed || [], [], 'before it was handed out');
  const n = cli(dir, ['next', 'g']);
  assert.ok(n.includes('\n  npm test -- --grep "a b"\n'), `printed exactly as stored (review M2):\n${n}`);
  ran(dir, 'npm test', { agent_id: 'helper-1' });
  ran(dir, 'npm test', { cwd: os.tmpdir() });
  ran(dir, 'npm test', { tool_input: { command: 'npm test', run_in_background: true } });
  ran(dir, 'npm test', { tool_response: { backgroundTaskId: 'b1' } });
  ran(dir, 'npm test', { tool_response: { interrupted: true } });
  ran(dir, 'npm test', {}, 'other-session');
  hook(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1', cwd: os.tmpdir() });
  assert.equal(st(dir).steps.checks.state, 'running');
  assert.deepEqual(st(dir).steps.checks.passed, [], 'a helper, another folder, the background, an interrupt or another session never count');
  ran(dir, 'npm test', { cwd: process.platform === 'win32' ? dir.toUpperCase() : dir });
  ran(dir, 'npm test -- --grep "a b"');
  assert.equal(st(dir).steps.checks.state, 'done');
  assert.match(cli(dir, ['next', 'g']), /Build graph g finished/);
});

test('trust is for the commands that were shown: changed after the ask, TRUST is refused; commands are shown whole (review M1)', () => {
  const long = `npm test ${'-- '.repeat(50)}--registry=http://evil.example`;
  assert.ok(long.length <= 200);
  const dir = project({ g: `# Graph: g\n## c (gate)\n- run: ${long}\n` });
  const ask = cli(dir, ['start', 'g']);
  assert.ok(ask.includes(long), 'the whole command is shown');
  fs.writeFileSync(graphFile(dir), '# Graph: g\n## c (gate)\n- run: npm run deploy\n');
  const o = hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(o.systemMessage, /changed since/i);
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/, 'still not trusted; asked again');
  const t = hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(t.systemMessage, /npm run deploy/);
  assert.match(cli(dir, ['start', 'g']), /Started/);
});

// Changed on 2026-11-22 (owner): TRUST GRAPH sent before start asked used to be an ordinary prompt, dropped without a
// word. It is now answered and trusts the graph as it is (tests/graph-trust-early.test.js).
test('TRUST rules: the whole message, attended only (review M5); sent before start asked, it is answered', () => {
  const early = project({ g: '# Graph: g\n## c (gate)\n- run: npm test\n' });
  assert.match(hook(early, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' }).systemMessage, /you trusted build graph g[\s\S]*npm test/);
  assert.match(cli(early, ['start', 'g']), /Started/);
  const dir = project({ g: '# Graph: g\n## c (gate)\n- run: npm test\n' });
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/);
  hook(dir, 'UserPromptSubmit', { prompt: 'ok TRUST GRAPH g' });
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' }, SID, { CLAUDE_CODE_SESSION_ATTENDED: '0' });
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/, 'not trusted by a sentence or an unattended session');
  hook(dir, 'UserPromptSubmit', { prompt: '  trust graph g \n' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
});

test('the run keeps the graph it started with: editing the file mid-run cannot turn a human step or a gate into a reportable step (review H2)', () => {
  const HG = '# Graph: g\n## approve (human)\n- say: approve it\n\n## checks (gate)\n- after: approve\n- run: npm test\n';
  const dir = project({ g: HG });
  trustAndStart(dir);
  cli(dir, ['next', 'g']);
  fs.writeFileSync(graphFile(dir), HG.replace('## approve (human)\n- say: approve it', '## approve (agent)\n- helper: checker'));
  helperStarted(dir, 'jspark-forge:checker');
  assert.match(report(dir, 'approve', {}), /human step/);
  fs.writeFileSync(graphFile(dir), HG.replace('## checks (gate)\n- after: approve\n- run: npm test', '## checks (agent)\n- after: approve\n- helper: checker'));
  assert.match(report(dir, 'checks', {}), /gate/);
  fs.writeFileSync(graphFile(dir), HG);
  assert.equal(st(dir).steps.approve.state, 'running');
  assert.match(cli(dir, ['next', 'g']), /waiting for approve/);
});

test('trust is per hash of the commands: a changed run: line needs trust again', () => {
  const dir = project({ g: '# Graph: g\n## c (gate)\n- run: npm test\n' });
  trustAndStart(dir);
  cli(dir, ['stop', 'g']);
  fs.writeFileSync(graphFile(dir), '# Graph: g\n## c (gate)\n- run: npm run deploy\n');
  assert.match(cli(dir, ['start', 'g']), /TRUST GRAPH g/);
});

// Security re-review M6: Claude could delete a human step or a gate from the graph file and start again with no user
// action. Trust covers the ids of the human steps and gates as well as the gate commands.
test('dropping a human step or a gate needs TRUST again, also when no gate is left (re-review M6)', () => {
  const HG = '# Graph: g\n## build (agent)\n- helper: builder\n\n## test (gate)\n- after: build\n- run: npm test\n\n## ok (human)\n- after: test\n- say: Look.\n';
  const dir = project({ g: HG });
  assert.match(trustAndStart(dir), /Started/);
  cli(dir, ['next', 'g']);
  fs.writeFileSync(graphFile(dir), '# Graph: g\n## build (agent)\n- helper: builder\n');
  assert.match(cli(dir, ['next', 'g']), /graph file changed/i);
  const again = cli(dir, ['start', 'g']);
  assert.match(again, /TRUST GRAPH g/, 'no gate and no human step left, still asked');
  assert.doesNotMatch(again, /Started/);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/, 'the user agreed');
  // only the human step dropped, the commands unchanged
  const d2 = project({ g: HG });
  trustAndStart(d2);
  cli(d2, ['stop', 'g']);
  fs.writeFileSync(graphFile(d2), HG.replace(/\n## ok \(human\)[\s\S]*$/, '\n'));
  assert.match(cli(d2, ['start', 'g']), /TRUST GRAPH g/);
  // a graph with a human step and no commands: its first start fixes what later edits are compared with
  const d3 = project({ g: SIMPLE });
  assert.match(cli(d3, ['start', 'g']), /Started/, 'no commands: no trust needed the first time');
  cli(d3, ['stop', 'g']);
  fs.writeFileSync(graphFile(d3), SIMPLE.replace(/## decide \(human\)\n- after: measure\n- say: [^\n]*\n/, '').replace('- after: decide\n', '- after: measure\n'));
  assert.match(cli(d3, ['start', 'g']), /TRUST GRAPH g/, 'the human step was removed');
  // adding an agent step changes nothing the user guards
  const d4 = project({ g: SIMPLE });
  cli(d4, ['start', 'g']); cli(d4, ['stop', 'g']);
  fs.appendFileSync(graphFile(d4), '\n## extra (agent)\n- helper: checker\n');
  assert.match(cli(d4, ['start', 'g']), /Started/);
});

// Re-review M8: stop then rerun left a run that could never progress (no active run, so no evidence was recorded).
test('rerun on a stopped run is refused and says to start again (re-review M8)', () => {
  const dir = project({ g: '# Graph: g\n## b (agent)\n- helper: builder\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  cli(dir, ['fail', 'g', 'b', 'a']); cli(dir, ['next', 'g']); cli(dir, ['fail', 'g', 'b', 'b']);
  cli(dir, ['stop', 'g']);
  const r = cli(dir, ['rerun', 'g', 'b']);
  assert.match(r, /stopped/i);
  assert.match(r, /graph start g/);
  assert.equal(st(dir).steps.b.state, 'failed', 'nothing changed');
  assert.ok(st(dir).stopped);
});

// Re-review low (a): fail, stop and rerun from another session while the owner is live are refused, like next.
test('fail, stop and rerun from a non-owner session are refused while the owner is live (re-review, low)', () => {
  const dir = project({ g: '# Graph: g\n## b (agent)\n- helper: builder\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  for (const args of [['fail', 'g', 'b', 'nope'], ['stop', 'g'], ['rerun', 'g', 'b']]) {
    assert.match(cli(dir, args, 'gr-2'), /another session[\s\S]*graph takeover g/i, args.join(' '));
  }
  assert.equal(st(dir).steps.b.state, 'running');
  assert.ok(!st(dir).stopped);
  assert.equal(st(dir).owner, SID);
  assert.match(cli(dir, ['fail', 'g', 'b', 'mine']), /retry once/i, 'the owner still can');
});

test('a graph with no steps cannot start (re-review, low)', () => {
  const dir = project({ empty: '# Graph: empty\n' });
  assert.match(cli(dir, ['check', 'empty']), /at least one step/);
  assert.match(cli(dir, ['start', 'empty']), /cannot start/);
});

test('gate commands with shell operators are refused by the graph check', () => {
  const dir = project({ g: '# Graph: g\n## c (gate)\n- run: npm test && curl x | sh\n' });
  assert.match(cli(dir, ['check', 'g']), /one simple command/);
});

test('names: graph names and step ids are checked by every command (review M5)', () => {
  const dir = project({ g: SIMPLE });
  for (const args of [['start', '../x'], ['next', 'Bad'], ['stop', '../x'], ['status', '..'], ['rerun', '../x', 'a'], ['takeover', '../x']]) {
    assert.match(cli(dir, args), /lower-case letters, digits and dashes/, args.join(' '));
  }
  cli(dir, ['start', 'g']);
  assert.match(cli(dir, ['fail', 'g', '../x', 'why']), /no running step|step id/i);
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'x.json')));
  const wrong = project({ g: '# Graph: other\n## a (agent)\n- helper: builder\n' });
  assert.match(cli(wrong, ['check', 'g']), /"# Graph: g"/);
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

test('a second live session is refused; takeover moves the run, interrupting only helper steps (review M3)', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  const n = cli(dir, ['next', 'g'], 'gr-2');
  assert.match(n, /another session/i);
  assert.match(n, /graph takeover g/);
  assert.equal(st(dir).owner, SID);
  assert.equal(st(dir).steps.measure.state, 'running');
  assert.match(cli(dir, ['takeover', 'g'], 'gr-2'), /interrupted in an earlier session: measure/i);
  assert.equal(st(dir).steps.measure.state, 'interrupted');
  assert.equal(st(dir).owner, 'gr-2');
  assert.match(cli(dir, ['rerun', 'g', 'measure'], 'gr-2'), /measure will run again/);
  assert.equal(st(dir).steps.measure.retries || 0, 0);
});

test('a waiting human step stays waiting across sessions; an idle owner is replaced; DONE works from any attended session (review M3)', () => {
  const dir = project({ g: '# Graph: g\n## ask (human)\n- say: Approve.\n\n## b (agent)\n- helper: builder\n- after: ask\n' });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  const s = st(dir); s.lastSeen = Date.now() - 31 * 60 * 1000; fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  const n = cli(dir, ['next', 'g'], 'gr-2');
  assert.doesNotMatch(n, /interrupted/i);
  assert.equal(st(dir).owner, 'gr-2');
  assert.equal(st(dir).steps.ask.state, 'running');
  hook(dir, 'UserPromptSubmit', { prompt: 'DONE ask' }, 'gr-3');
  assert.equal(st(dir).steps.ask.state, 'done');
});

test('helper evidence: only jspark-forge:<helper>, only from the run\'s session, each start used once (review M4)', () => {
  const A2 = '# Graph: g\n- max_parallel: 2\n## a (agent)\n- helper: builder\n## b (agent)\n- helper: builder\n';
  const dir = project({ g: A2 });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  helperStarted(dir, 'evil-plugin:builder');
  helperStarted(dir, 'builder');
  helperStarted(dir, 'jspark-forge:builder', 'other-session');
  assert.match(report(dir, 'a', {}), /no builder helper ran/);
  helperStarted(dir, 'jspark-forge:builder');
  assert.match(report(dir, 'a', {}), /a done/);
  assert.match(report(dir, 'b', {}), /no builder helper ran/, 'one helper start is evidence for one step');
});

test('the cap: never more running agent steps than max_parallel', () => {
  const G = '# Graph: g\n- max_parallel: 2\n## a (agent)\n- helper: builder\n## b (agent)\n- helper: builder\n## c (agent)\n- helper: builder\n## p (parallel)\n- steps: a, b, c\n';
  const dir = project({ g: G });
  cli(dir, ['start', 'g']);
  cli(dir, ['next', 'g']);
  const running = Object.values(st(dir).steps).filter(s => s.state === 'running').length;
  assert.equal(running, 2);
});

test('at 95 % plan usage helper steps wait, but human steps and gates are still handed out; unknown usage is said (review M5, low)', () => {
  const G = '# Graph: g\n- max_parallel: 2\n## a (agent)\n- helper: builder\n## h (human)\n- say: Look.\n## c (gate)\n- run: npm test\n';
  const dir = project({ g: G });
  trustAndStart(dir);
  const u = path.join(dir, '.jspark-forge', 'usage');
  fs.mkdirSync(u, { recursive: true });
  fs.writeFileSync(path.join(u, `${SID}.json`), JSON.stringify({ ts: Date.now(), five_hour_pct: 96, seven_day_pct: 10 }));
  const n = cli(dir, ['next', 'g']);
  assert.match(n, /Plan usage is at 96 %/);
  assert.equal(st(dir).steps.a.state, 'waiting');
  assert.equal(st(dir).steps.h.state, 'running');
  assert.equal(st(dir).steps.c.state, 'running');
  fs.rmSync(u, { recursive: true, force: true });
  assert.match(cli(dir, ['next', 'g']), /plan usage unknown: treated as under the limit/i);
  assert.equal(st(dir).steps.a.state, 'running');
});

test('parallel reports and helper starts are all recorded under the lock (review M5)', async () => {
  const N = 6;
  let G = `# Graph: g\n- max_parallel: ${N}\n`;
  for (let i = 0; i < N; i++) G += `## s${i} (agent)\n- helper: builder\n- gives: f${i}_path\n`;
  const dir = project({ g: G });
  cli(dir, ['start', 'g']); cli(dir, ['next', 'g']);
  const run = (args, input) => new Promise(res => {
    const p = spawn(process.execPath, [FORGE, ...args], { cwd: dir, env: env(dir), stdio: ['pipe', 'pipe', 'pipe'] });
    let o = ''; p.stdout.on('data', d => { o += d; }); p.on('close', () => res(o)); p.stdin.end(input || '');
  });
  await Promise.all(Array.from({ length: N }, (_, i) => run(['SubagentStart'], JSON.stringify({ session_id: SID, cwd: dir, agent_id: `a${i}`, agent_type: 'jspark-forge:builder' }))));
  assert.equal(st(dir).evidence.length, N);
  for (let i = 0; i < N; i++) fs.writeFileSync(path.join(dir, `r${i}.json`), JSON.stringify({ [`f${i}_path`]: 'README.md' }));
  const outs = await Promise.all(Array.from({ length: N }, (_, i) => run(['graph', 'done', 'g', `s${i}`, '--from', `r${i}.json`])));
  assert.equal(outs.filter(o => / done\./.test(o)).length, N, outs.join(''));
  assert.equal(Object.values(st(dir).steps).filter(v => v.state === 'done').length, N);
});

test('a held lock: the command waits, then says busy instead of running unlocked; a lock older than 10 s is taken over (low)', () => {
  const dir = project({ g: SIMPLE });
  cli(dir, ['start', 'g']);
  const lock = `${stateFile(dir)}.lock`;
  fs.writeFileSync(lock, 'someone-else');
  const t = Date.now();
  assert.match(cli(dir, ['next', 'g']), /busy.*try again/i);
  assert.ok(Date.now() - t >= 3000, 'it waited');
  assert.equal(st(dir).steps.measure.state, 'waiting', 'nothing ran unlocked');
  const old = (Date.now() - 20000) / 1000;
  fs.utimesSync(lock, old, old);
  assert.match(cli(dir, ['next', 'g']), /measure/);
  assert.equal(st(dir).steps.measure.state, 'running');
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
  const paths = require('../scripts/lib/paths');
  paths.unmarkOwn(dir);
  fs.rmSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true, force: true });
  fs.mkdirSync(paths.guestDir(dir), { recursive: true }); // set up as a guest (the same config folder as the CLI's)
  assert.ok(paths.isGuest(dir));
  assert.match(cli(dir, ['start', 'g']), /Build graphs are off in a repo you are reviewing/);
});
