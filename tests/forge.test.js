'use strict';
// Design sections 3 ("Hook rules") and 6: the dispatcher logs one line per event, fails open, prints nothing
// on PreCompact (design 16, deviation 1), and writes nothing in a project without .jspark-forge/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');

function project({ init = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hook-'));
  if (init) fs.mkdirSync(path.join(dir, '.jspark-forge'));
  return dir;
}
function run(dir, event, input) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(Object.assign({
    session_id: 'a1b2c3d4-0000-0000-0000-000000000000', cwd: dir, hook_event_name: event,
  }, input));
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir });
  return spawnSync(process.execPath, [FORGE, event], { input: stdin, env, encoding: 'utf8' });
}
function logText(dir) {
  const logDir = path.join(dir, '.jspark-forge', 'log');
  if (!fs.existsSync(logDir)) return '';
  return fs.readdirSync(logDir).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('');
}

test('writes nothing and prints nothing in a project without .jspark-forge/', () => {
  const dir = project({ init: false });
  const r = run(dir, 'UserPromptSubmit', { prompt: 'hello' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('UserPromptSubmit logs USER with the prompt, redacted', () => {
  const dir = project();
  const r = run(dir, 'UserPromptSubmit', { prompt: 'deploy with token=abc123secret please' });
  assert.equal(r.status, 0);
  const t = logText(dir);
  assert.match(t, /\[a1b2c3d4\]\s+USER  deploy with token=/);
  assert.ok(!t.includes('abc123secret'));
});

test('PostToolUse Edit logs EDIT with the path relative to the project', () => {
  const dir = project();
  run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.ts') } });
  assert.match(logText(dir), /EDIT  src\/a\.ts/);
});

test('PostToolUse Write logs WRITE; NotebookEdit logs EDIT', () => {
  const dir = project();
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'b.md') } });
  run(dir, 'PostToolUse', { tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(dir, 'n.ipynb') } });
  const t = logText(dir);
  assert.match(t, /WRITE b\.md/);
  assert.match(t, /EDIT  n\.ipynb/);
});

test('PostToolUse Bash logs "description :: command"; PowerShell logs PS; MCP logs the tool name', () => {
  const dir = project();
  run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test -- save_chart', description: 'run unit tests' } });
  run(dir, 'PostToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } });
  run(dir, 'PostToolUse', { tool_name: 'mcp__db__query', tool_input: { sql: 'select 1' } });
  const t = logText(dir);
  assert.match(t, /BASH  run unit tests :: npm test -- save_chart/);
  assert.match(t, /PS    Get-ChildItem/);
  assert.match(t, /MCP   mcp__db__query/);
});

test('a call inside a helper is logged as [session/agent]', () => {
  const dir = project();
  run(dir, 'PostToolUse', { agent_id: '9f8e7d6c-1111', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'x.js') } });
  assert.match(logText(dir), /\[a1b2c3d4\/9f8e7d6c\] EDIT  x\.js/);
});

test('helper start and stop log AGENT+ and AGENT- with the agent type', () => {
  const dir = project();
  run(dir, 'SubagentStart', { agent_id: '9f8e7d6c', agent_type: 'Explore' });
  run(dir, 'SubagentStop', { agent_id: '9f8e7d6c', agent_type: 'Explore' });
  const t = logText(dir);
  assert.match(t, /AGENT\+ Explore/);
  assert.match(t, /AGENT- Explore/);
});

test('PostToolUseFailure logs FAIL with the tool and the error', () => {
  const dir = project();
  run(dir, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'exit code 1' });
  assert.match(logText(dir), /FAIL  Bash :: npm test :: exit code 1/);
});

test('Stop, PreCompact and SessionEnd log STOP, COMPACT and END', () => {
  const dir = project();
  run(dir, 'Stop', {});
  run(dir, 'PreCompact', { trigger: 'manual' });
  run(dir, 'SessionEnd', { reason: 'logout' });
  const t = logText(dir);
  assert.match(t, /STOP/);
  assert.match(t, /COMPACT manual/);
  assert.match(t, /END   logout/);
});

test('PreCompact prints nothing (any output there is rejected and shown as an error)', () => {
  const dir = project();
  const r = run(dir, 'PreCompact', { trigger: 'auto' });
  assert.equal(r.stdout, '');
});

test('bad input fails open: exit 0, no output, one FORGE-ERROR line', () => {
  const dir = project();
  const r = run(dir, 'Stop', '{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(logText(dir), /FORGE-ERROR/);
});

test('an unknown event exits 0 and prints nothing', () => {
  const dir = project();
  const r = run(dir, 'SomethingNew', {});
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('SessionStart rotates old day files', () => {
  const dir = project();
  const logDir = path.join(dir, '.jspark-forge', 'log');
  fs.mkdirSync(logDir);
  fs.writeFileSync(path.join(logDir, '2020-01-01.log'), '10:00:00 [aaaa]               STOP  \n');
  run(dir, 'SessionStart', { source: 'startup' });
  assert.ok(!fs.existsSync(path.join(logDir, '2020-01-01.log')));
  assert.match(fs.readFileSync(path.join(logDir, 'summary.md'), 'utf8'), /## 2020-01-01/);
});

// ---- Step 2: block list through the dispatcher (design 9.2) ----
const STOP = 'Do not try an equivalent command; tell the user and stop.';
const decision = r => { assert.equal(r.status, 0); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null; };
const preBash = (dir, command, extra = {}) => run(dir, 'PreToolUse', Object.assign({ tool_name: 'Bash', tool_input: { command } }, extra));

test('PreToolUse denies a listed command with the stop sentence and logs BLOCK', () => {
  const dir = project();
  const h = decision(preBash(dir, 'git reset --hard HEAD~2'));
  assert.equal(h.hookEventName, 'PreToolUse');
  assert.equal(h.permissionDecision, 'deny');
  assert.ok(h.permissionDecisionReason.includes(STOP));
  assert.match(h.permissionDecisionReason, /CONFIRM git-reset-hard/);
  assert.match(logText(dir), /BLOCK git-reset-hard :: git reset --hard HEAD~2/);
});

test('PreToolUse prints nothing for an allowed command', () => {
  const dir = project();
  assert.equal(preBash(dir, 'npm test').stdout, '');
});

test('typed CONFIRM turns the next matching call into ask, once', () => {
  const dir = project();
  const p = run(dir, 'UserPromptSubmit', { prompt: 'CONFIRM git-reset-hard' });
  assert.match(JSON.parse(p.stdout).hookSpecificOutput.additionalContext, /git-reset-hard/);
  const first = decision(preBash(dir, 'git reset --hard'));
  assert.equal(first.permissionDecision, 'ask');
  assert.match(first.permissionDecisionReason, /git reset --hard|uncommitted/);
  assert.equal(decision(preBash(dir, 'git reset --hard')).permissionDecision, 'deny');
  const t = logText(dir);
  assert.match(t, /CONFIRM git-reset-hard granted/);
  assert.match(t, /CONFIRM git-reset-hard used/);
});

test('a token from another session does not apply', () => {
  const dir = project();
  run(dir, 'UserPromptSubmit', { prompt: 'CONFIRM chmod-wide', session_id: 'other-session' });
  assert.equal(decision(preBash(dir, 'chmod 777 x')).permissionDecision, 'deny');
});

test('a hard deny ignores tokens', () => {
  const dir = project();
  run(dir, 'UserPromptSubmit', { prompt: 'CONFIRM rm-rf-outside' });
  const h = decision(preBash(dir, 'rm -rf ~'));
  assert.equal(h.permissionDecision, 'deny');
  assert.ok(!/CONFIRM/.test(h.permissionDecisionReason));
});

test('editing .env is denied; .env.example is allowed', () => {
  const dir = project();
  const deny = decision(run(dir, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.env') } }));
  assert.equal(deny.permissionDecision, 'deny');
  assert.equal(run(dir, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.env.example') } }).stdout, '');
});

test('blocks fire inside helpers too (agent_id present)', () => {
  const dir = project();
  const h = decision(preBash(dir, 'git stash clear', { agent_id: '9f8e7d6c' }));
  assert.equal(h.permissionDecision, 'deny');
  assert.match(logText(dir), /\[a1b2c3d4\/9f8e7d6c\] BLOCK git-stash-drop/);
});

test('rules.md Never and Confirm lines apply; SessionStart reports malformed lines and an ignored disable:', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'),
    '## Confirm\n- `terraform destroy` : destroys infra\n- broken line\n## Never\n- `drop database prod` : prod\n## Settings\n- disable: chmod-wide\n');
  assert.equal(decision(preBash(dir, 'terraform destroy')).permissionDecision, 'deny');
  assert.match(decision(preBash(dir, 'terraform destroy')).permissionDecisionReason, /CONFIRM terraform-destroy/);
  assert.equal(decision(preBash(dir, 'psql -c "drop database prod"')).permissionDecision, 'deny');
  // v0.1.1: a project's rules.md cannot switch a built-in off (it may come from a cloned repo).
  assert.equal(decision(preBash(dir, 'chmod 777 x')).permissionDecision, 'deny');
  const s = JSON.parse(run(dir, 'SessionStart', { source: 'startup' }).stdout);
  assert.match(s.systemMessage, /rules\.md line 3/);
  assert.match(s.systemMessage, /line 7 skipped \(a project's rules\.md cannot switch off built-in blocks/);
});
