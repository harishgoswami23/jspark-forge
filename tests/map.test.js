'use strict';
// v0.3 code map layer (design-v0.3 section 1): detection by use, a locked background refresh that records the commit it
// indexed, "as of" on every map answer (current / behind with changed files / different history), decisions on map
// answers in their own shown set, the tip when no engine is installed, and /check. A fake engine keeps it offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-cbm.js');
const TOOL = 'mcp__codebase-memory__search_graph';

function project({ space = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-map-'));
  const dir = space ? path.join(base, 'My Project') : base;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'function alpha () {}\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const sh = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const commit = (dir, file, text, msg) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', msg);
};
const envFor = (dir, extra = {}) => Object.assign({}, process.env, {
  CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ATTENDED: '1', JSPARK_FORGE_MAP_CMD: JSON.stringify([process.execPath, FAKE]),
  FAKE_CBM_LOG: path.join(dir, '..', `${path.basename(dir)}-fake.log`) }, extra);
const hook = (dir, event, input, extra) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: envFor(dir, extra),
    input: JSON.stringify(Object.assign({ session_id: 'map-1', cwd: dir, source: 'startup' }, input)) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const ctxOf = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';
const mapAnswer = (dir, text = 'results: 1\n  src/a.js 1-1', extra) => ctxOf(hook(dir, 'PostToolUse', { tool_name: TOOL, tool_input: { name_pattern: 'alpha' }, tool_response: text }, extra));
const mapState = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'map.json'), 'utf8')); } catch { return {}; } };
const runs = dir => { try { return fs.readFileSync(envFor(dir).FAKE_CBM_LOG, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const waitFor = (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']); } return false; };
const lockOf = dir => path.join(dir, '.jspark-forge', 'state', 'map.lock');
// A hook may have started a background refresh: let it finish, then run one in the foreground.
const refreshNow = (dir, extra) => {
  for (let i = 0; i < 5; i++) {
    waitFor(() => !fs.existsSync(lockOf(dir)), 10000);
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'map-refresh.js'), dir], { encoding: 'utf8', env: envFor(dir, extra) });
    if (!/already running/.test(r.stdout)) return r;
  }
  return { status: 1, stdout: 'still running' };
};

test('off until an engine tool is used: no map lines anywhere; the first engine call switches it on', () => {
  const dir = project();
  assert.ok(!/Code map/.test(ctxOf(hook(dir, 'SessionStart', {}))));
  assert.ok(!/Code map/.test(ctxOf(hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.js') } }))));
  mapAnswer(dir);
  assert.match(mapState(dir).prefix, /^mcp__codebase-memory__$/);
});

test('the refresh records the full commit read before indexing, only on success', () => {
  const dir = project();
  const head = sh(dir, 'rev-parse', 'HEAD');
  assert.equal(refreshNow(dir).status, 0);
  const st = mapState(dir);
  assert.equal(st.sha, head);
  assert.ok(st.indexedAt > 0);
  assert.equal(runs(dir), 1);
  commit(dir, 'src/b.js', 'x', 'more');
  refreshNow(dir, { FAKE_CBM_EXIT: '3' });
  assert.equal(mapState(dir).sha, head, 'a failed run keeps the old commit');
  assert.match(mapState(dir).lastError, /exit 3|failed/);
});

test('one refresh at a time: a second trigger while one runs leaves a pending re-run, never two at once', () => {
  const dir = project();
  const { spawn } = require('node:child_process');
  const a = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'map-refresh.js'), dir], { env: envFor(dir, { FAKE_CBM_MS: '1500' }) });
  waitFor(() => fs.existsSync(lockOf(dir)), 3000);
  const b = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'map-refresh.js'), dir], { encoding: 'utf8', env: envFor(dir) });
  assert.match(b.stdout, /already running/);
  assert.ok(waitFor(() => !fs.existsSync(lockOf(dir)) && runs(dir) >= 2, 10000));
  a.kill();
  assert.equal(runs(dir), 2, 'the pending re-run happened once, after the first');
  const times = fs.readFileSync(envFor(dir).FAKE_CBM_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l).at);
  assert.ok(times[1] - times[0] >= 1400, 'never overlapped');
});

test('a missing engine records the error and backs off', () => {
  const dir = project();
  refreshNow(dir, { JSPARK_FORGE_MAP_CMD: JSON.stringify([path.join(dir, 'no-such-engine.exe')]) });
  const st = mapState(dir);
  assert.ok(st.lastError);
  assert.ok(st.nextTryAt > Date.now(), 'backs off');
});

test('a hook that starts a refresh returns at once (the refresh runs in the background)', () => {
  const dir = project();
  mapAnswer(dir);
  commit(dir, 'src/c.js', 'x', 'add c');
  const t = Date.now();
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "add c"' } }, { FAKE_CBM_MS: '3000' });
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms`);
  assert.ok(waitFor(() => mapState(dir).sha === sh(dir, 'rev-parse', 'HEAD'), 10000), 'the background refresh finished');
});

test('every map answer says how fresh it is: current, or behind with the changed files', () => {
  const dir = project();
  mapAnswer(dir);
  refreshNow(dir);
  assert.match(mapAnswer(dir), /Code map current \(as of [0-9a-f]{7}\)/);
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'function alpha () { return 2 }\n');
  fs.writeFileSync(path.join(dir, 'src', 'new.js'), 'x');
  const c = mapAnswer(dir);
  assert.match(c, /read these changed files before relying on it: .*src\/a\.js/);
  assert.match(c, /src\/new\.js/);
  commit(dir, 'src/a.js', 'function alpha () { return 3 }\n', 'change a');
  const behind = mapAnswer(dir, 'other text');
  assert.match(behind, /Code map as of [0-9a-f]{7} \(\d{4}-\d\d-\d\d \d\d:\d\d\); HEAD is 1 commit ahead/);
  assert.match(behind, /Say "as of [0-9a-f]{7}"/);
});

test('the changed-file list is repeated only when it changes', () => {
  const dir = project();
  mapAnswer(dir); refreshNow(dir);
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'changed\n');
  assert.match(mapAnswer(dir), /src\/a\.js/);
  const again = mapAnswer(dir);
  assert.ok(!/src\/a\.js/.test(again), again);
  assert.match(again, /as of/);
});

test('a different history (rebase, other branch) is said plainly, with no commit count', () => {
  const dir = project();
  mapAnswer(dir); refreshNow(dir);
  sh(dir, 'checkout', '-q', '--orphan', 'other'); sh(dir, 'commit', '-qm', 'unrelated');
  assert.match(mapAnswer(dir), /indexed on a different history/);
});

test('decisions on map answers: from files in the answer that exist, in their own shown set', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), '## D-001 Alpha must stay pure\n- Kind: rule\n- Touches: src/a.js\n- Status: active\n');
  mapAnswer(dir, 'no files in this answer'); refreshNow(dir);
  const c = mapAnswer(dir, 'results: 1\n  src/a.js 1-1\n  src/ghost.js 3-4');
  assert.match(c, /D-001 Alpha must stay pure/);
  const edit = ctxOf(hook(dir, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.js') } }));
  assert.match(edit, /D-001/, 'a map answer does not use up the note before an edit');
});

test('Claude indexing through the engine tool counts as a refresh (the next answer is "current")', () => {
  const dir = project();
  const ok = '{"project":"x","nodes":6,"edges":5,"status":"indexed"}';
  hook(dir, 'PostToolUse', { tool_name: 'mcp__codebase-memory__index_repository', tool_input: { repo_path: dir }, tool_response: ok });
  assert.equal(mapState(dir).sha, sh(dir, 'rev-parse', 'HEAD'));
  assert.match(mapAnswer(dir, 'no files'), /Code map current/);
  const failed = project();
  hook(failed, 'PostToolUse', { tool_name: 'mcp__codebase-memory__index_repository', tool_input: {}, tool_response: 'error: repo_path not found' });
  assert.ok(!mapState(failed).sha, 'a failed index is not recorded');
});

test('guest repos: no map layer', () => {
  const dir = project();
  require('../scripts/lib/paths').unmarkOwn(dir);
  fs.rmSync(path.join(dir, '.jspark-forge'), { recursive: true, force: true });
  assert.equal(mapAnswer(dir), '');
});

test('a project path with a space works', () => {
  const dir = project({ space: true });
  mapAnswer(dir);
  assert.equal(refreshNow(dir).status, 0);
  assert.match(mapAnswer(dir), /Code map current/);
});

test('the tip names the engine once, in an own project with code, when it is not installed', () => {
  const dir = project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-map-home-'));
  const extra = { CLAUDE_CONFIG_DIR: home, USERPROFILE: home, HOME: home, JSPARK_FORGE_AUTO_STATUSLINE: 'off' };
  const first = hook(dir, 'SessionStart', {}, extra).systemMessage || '';
  assert.match(first, /codebase-memory-mcp/);
  assert.match(first, /github\.com\/DeusData\/codebase-memory-mcp/);
  assert.ok(!/codebase-memory-mcp/.test(hook(dir, 'SessionStart', {}, extra).systemMessage || ''), 'once');
});

test('forge.js map status and /check show a map that is behind or failing', () => {
  const dir = project();
  mapAnswer(dir); refreshNow(dir);
  commit(dir, 'src/d.js', 'x', 'add d');
  const st = spawnSync(process.execPath, [FORGE, 'map', 'status'], { cwd: dir, encoding: 'utf8', env: envFor(dir) }).stdout;
  assert.match(st, /1 commit behind/);
  refreshNow(dir, { FAKE_CBM_EXIT: '2' });
  const check = spawnSync(process.execPath, [FORGE, 'check'], { cwd: dir, encoding: 'utf8', env: envFor(dir) }).stdout;
  assert.match(check, /code map/i);
  assert.match(check, /refresh now\?/);
});
