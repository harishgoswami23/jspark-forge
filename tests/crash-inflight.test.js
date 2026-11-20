'use strict';
// v0.5.1 crash recovery, Part B: know what was in flight (state/inflight-<session>.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const A = 'aaaaaaaa-0000-0000-0000-000000000000';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-inflt-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  require('../scripts/lib/paths').markOwn(dir);
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt'); g('commit', '-qm', 'init');
  return dir;
}
function run(dir, event, input = {}, sid = A) {
  const stdin = JSON.stringify(Object.assign({ session_id: sid, cwd: dir, hook_event_name: event }, input));
  return spawnSync(process.execPath, [FORGE, event], { input: stdin, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
}
const file = (dir, sid = A) => path.join(dir, '.jspark-forge', 'state', `inflight-${sid}`); // one small file per call, in this folder
const list = (dir, sid = A) => {
  let names = [];
  try { names = fs.readdirSync(file(dir, sid)).filter(n => /.json$/.test(n)); } catch { return []; }
  const out = [];
  for (const n of names) { try { out.push(JSON.parse(fs.readFileSync(path.join(file(dir, sid), n), 'utf8'))); } catch { /* a damaged file */ } }
  return out.sort((a, b) => a.at - b.at);
};
const pre = (dir, tool, tool_input, extra = {}, sid = A) => run(dir, 'PreToolUse', Object.assign({ tool_name: tool, tool_input }, extra), sid);
const post = (dir, tool, tool_input, extra = {}, sid = A) => run(dir, 'PostToolUse', Object.assign({ tool_name: tool, tool_input }, extra), sid);

test('an allowed Bash call is recorded as in flight, with its start time and no helper', () => {
  const dir = repo();
  const t0 = Date.now();
  pre(dir, 'Bash', { command: 'npm run build', description: 'Build the bundle' }, { tool_use_id: 'toolu_1' });
  const l = list(dir);
  assert.equal(l.length, 1);
  assert.equal(l[0].tool, 'Bash');
  assert.match(l[0].what, /Build the bundle/);
  assert.match(l[0].what, /npm run build/);
  assert.ok(l[0].at >= t0 - 1000 && l[0].at <= Date.now());
  assert.equal(l[0].agent, null);
});

test('PowerShell, Write, Edit, NotebookEdit and Agent calls are recorded; Read and Grep are not', () => {
  const dir = repo();
  pre(dir, 'PowerShell', { command: 'Get-ChildItem' });
  pre(dir, 'Write', { file_path: path.join(dir, 'src', 'a.js') });
  pre(dir, 'Edit', { file_path: path.join(dir, 'src', 'b.js') });
  pre(dir, 'NotebookEdit', { notebook_path: path.join(dir, 'n.ipynb') });
  pre(dir, 'Agent', { subagent_type: 'jspark-forge:builder', description: 'build it' });
  pre(dir, 'Read', { file_path: path.join(dir, 'a.txt') });
  pre(dir, 'Grep', { pattern: 'x' });
  const l = list(dir);
  assert.deepEqual(l.map(e => e.tool), ['PowerShell', 'Write', 'Edit', 'NotebookEdit', 'Agent']);
  assert.match(l[1].what, /a\.js$/);
  assert.match(l[4].what, /jspark-forge:builder/);
});

test('a helper call carries its agent id; a long command is cut to 200 characters', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'echo ' + 'x'.repeat(600) }, { agent_id: 'agent-123' });
  const e = list(dir)[0];
  assert.equal(e.agent, 'agent-123');
  assert.ok(e.what.length <= 260, `what is ${e.what.length} long`); // the command part is cut to 200 (a description may come before it)
  assert.ok(!e.what.includes('x'.repeat(201)));
});

test('secrets in the command are redacted like log lines', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" https://x.invalid && echo sk-abcdefghijkl123456' });
  const e = list(dir)[0];
  assert.doesNotMatch(e.what, /abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(e.what, /sk-abcdefghijkl/);
  assert.match(e.what, /redacted/);
});

test('a blocked call is not recorded', () => {
  const dir = repo();
  const r = pre(dir, 'Bash', { command: 'git push --force origin main' });
  assert.match(r.stdout, /deny/);
  assert.equal(list(dir).length, 0);
});

test('PostToolUse clears the entry by tool_use_id', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'sleep 1' }, { tool_use_id: 'toolu_a' });
  pre(dir, 'Bash', { command: 'sleep 1' }, { tool_use_id: 'toolu_b' });
  post(dir, 'Bash', { command: 'sleep 1' }, { tool_use_id: 'toolu_b' });
  const l = list(dir);
  assert.equal(l.length, 1);
  assert.equal(l[0].id, 'toolu_a');
});

test('without a tool_use_id the oldest entry with the same tool and text is cleared', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'npm test' });
  pre(dir, 'Bash', { command: 'npm run lint' });
  pre(dir, 'Bash', { command: 'npm test' });
  post(dir, 'Bash', { command: 'npm test' });
  const l = list(dir);
  assert.deepEqual(l.map(e => e.what), ['npm run lint', 'npm test']);
});

test('PostToolUseFailure clears the entry too', () => {
  const dir = repo();
  pre(dir, 'Write', { file_path: path.join(dir, 'x.js') }, { tool_use_id: 'toolu_w' });
  run(dir, 'PostToolUseFailure', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'x.js') }, tool_use_id: 'toolu_w', error: 'boom' });
  assert.equal(list(dir).length, 0);
});

test('Stop empties the session folder', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'npm run dev' });
  pre(dir, 'Agent', { subagent_type: 'x' }, { agent_id: 'h1' });
  assert.equal(list(dir).length, 2);
  run(dir, 'Stop', {});
  assert.ok(!fs.existsSync(file(dir)));
});

test('a damaged inflight file never breaks the hooks', () => {
  const dir = repo();
  fs.mkdirSync(file(dir), { recursive: true });
  fs.writeFileSync(path.join(file(dir), 'junk.json'), '\0\0\0{not json');
  fs.writeFileSync(`${file(dir)}.json`, '{{{'); // and a damaged old-style file
  const r = pre(dir, 'Bash', { command: 'npm test' });
  assert.equal(r.status, 0);
  assert.equal(list(dir).length, 1);
  assert.equal(post(dir, 'Bash', { command: 'npm test' }).status, 0);
});

test('the sessions keep separate files', () => {
  const dir = repo();
  const B = 'bbbbbbbb-0000-0000-0000-000000000000';
  pre(dir, 'Bash', { command: 'one' }, {}, A);
  pre(dir, 'Bash', { command: 'two' }, {}, B);
  assert.equal(list(dir, A)[0].what, 'one');
  assert.equal(list(dir, B)[0].what, 'two');
});

// ---- crash review S1-S3 ----
const { spawn } = require('node:child_process');
const runAsync = (dir, event, input, sid = A) => new Promise(resolve => {
  const p = spawn(process.execPath, [FORGE, event], { env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  p.on('close', resolve);
  p.stdin.end(JSON.stringify(Object.assign({ session_id: sid, cwd: dir, hook_event_name: event }, input)));
});

test('S2: 8 parallel PreToolUse calls are all recorded; 8 parallel PostToolUse calls leave none', async () => {
  const dir = repo();
  const ids = Array.from({ length: 8 }, (_, i) => `toolu_p${i}`);
  await Promise.all(ids.map((id, i) => runAsync(dir, 'PreToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: `sleep ${i}` } })));
  assert.equal(list(dir).length, 8);
  await Promise.all(ids.map((id, i) => runAsync(dir, 'PostToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: `sleep ${i}` } })));
  assert.equal(list(dir).length, 0);
});

test('S2: each call is one small file in the session folder, named by its tool_use_id (a counter and pid without one)', () => {
  const dir = repo();
  pre(dir, 'Bash', { command: 'one' }, { tool_use_id: 'toolu_zz' });
  pre(dir, 'Bash', { command: 'two' });
  const names = fs.readdirSync(file(dir)).filter(n => n.endsWith('.json')).sort();
  assert.equal(names.length, 2);
  assert.ok(names.includes('toolu_zz.json'), names.join());
  assert.ok(!fs.existsSync(`${file(dir)}.json`), 'no single list file any more');
});

test('S2: an old-style inflight-<session>.json is read once when newer than 7 days and ignored when older', () => {
  const crash = require('../scripts/lib/inflight');
  const dir = repo();
  const old = `${file(dir)}.json`;
  fs.writeFileSync(old, JSON.stringify([{ tool: 'Bash', what: 'old style', at: Date.now() - 1000, agent: null, id: null }]));
  assert.deepEqual(crash.read(dir, A).map(e => e.what), ['old style']);
  const t = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(old, t, t);
  assert.deepEqual(crash.read(dir, A), []);
});

test('S1: an Agent call is recorded in flight and the handler adds no decision output for it', () => {
  const dir = repo();
  const r = pre(dir, 'Agent', { subagent_type: 'jspark-forge:builder', description: 'build it', prompt: 'do the thing' }, { tool_use_id: 'toolu_ag' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'no decision, no context: the call passes through');
  assert.equal(list(dir).length, 1);
  assert.equal(list(dir)[0].tool, 'Agent');
});

test('S3: the in-flight file is flushed to the disk when added, not when removed', () => {
  const inflight = require('../scripts/lib/inflight');
  const dir = repo();
  const real = fs.fsyncSync; let n = 0;
  fs.fsyncSync = fd => { n++; return real(fd); };
  try {
    inflight.add(dir, { session_id: A, tool_name: 'Bash', tool_use_id: 'toolu_f', tool_input: { command: 'x' } }, []);
    assert.ok(n >= 1, 'added with a flush');
    n = 0;
    inflight.remove(dir, { session_id: A, tool_name: 'Bash', tool_use_id: 'toolu_f', tool_input: { command: 'x' } }, []);
    assert.equal(n, 0, 'removed without a flush');
  } finally { fs.fsyncSync = real; }
});

test('S6: a secret that straddles the 200-character cut is redacted before the cut', () => {
  const dir = repo();
  const secret = 'sk-' + 'a'.repeat(40);
  pre(dir, 'Bash', { command: `${'x'.repeat(190)} ${secret}` });
  assert.doesNotMatch(list(dir)[0].what, /sk-a/);
});

test('S9: the stored text of a Write path is cut to 300 characters', () => {
  const dir = repo();
  pre(dir, 'Write', { file_path: path.join(dir, 'p'.repeat(500) + '.js') });
  assert.ok(list(dir)[0].what.length <= 300);
});
