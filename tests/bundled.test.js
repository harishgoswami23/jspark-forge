'use strict';
// v0.5 launcher for the two bundled MCP servers (plan Task 2): pins, off switches, the npx command without a shell,
// the record file and the three launcher modes. A fake engine (a small Node script) is passed through
// JSPARK_FORGE_BUNDLED_CMD, so nothing here touches npx or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const bundled = require('../scripts/lib/bundled');
const uitip = require('../scripts/lib/uitip');

const tmp = (name = 'forge-bundled-') => fs.mkdtempSync(path.join(os.tmpdir(), name));
// A fake engine: writes its arguments (JSON) to FAKE_OUT, prints one line, exits with FAKE_EXIT (default 0).
const FAKE_SRC = `const fs = require('fs');
if (process.env.FAKE_OUT) fs.writeFileSync(process.env.FAKE_OUT, JSON.stringify(process.argv.slice(2)));
console.log('fake-engine says hi');
process.exit(Number(process.env.FAKE_EXIT || 0));
`;
function setup({ space = false, frontEnd = false } = {}) {
  const base = tmp();
  const home = path.join(base, 'home');
  const project = path.join(base, space ? 'my project' : 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  if (frontEnd) fs.writeFileSync(path.join(project, 'package.json'), '{"dependencies":{"react":"18.0.0"}}');
  const fake = path.join(base, 'fake-engine.js');
  fs.writeFileSync(fake, FAKE_SRC);
  const out = path.join(base, 'args.json');
  const cmd = JSON.stringify({ 'codebase-memory': [process.execPath, fake], playwright: [process.execPath, fake] });
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: project,
    JSPARK_FORGE_BUNDLED_CMD: cmd, FAKE_OUT: out });
  delete env.JSPARK_FORGE_CODE_MAP; delete env.JSPARK_FORGE_PLAYWRIGHT;
  return { base, home, project, env, out };
}
const recordOf = home => { try { return JSON.parse(fs.readFileSync(path.join(home, 'jspark-forge', 'bundled.json'), 'utf8')); } catch { return {}; } };
const runLauncher = (s, args, opts = {}) => spawnSync(process.execPath, [bundled.LAUNCHER, ...args],
  Object.assign({ encoding: 'utf8', env: s.env, cwd: s.project }, opts));
// Talks newline-delimited JSON-RPC to the launcher's empty server, then closes stdin.
function talk(s, name, messages) {
  const r = runLauncher(s, [name], { input: messages.map(m => JSON.stringify(m)).join('\n') + '\n' });
  return { status: r.status, stderr: r.stderr, replies: r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)) };
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const emptyServerChecks = (s, name, mode) => {
  const t = talk(s, name, [INIT, { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'ping' },
    { jsonrpc: '2.0', id: 4, method: 'resources/list' }]);
  assert.equal(t.status, 0, t.stderr);
  assert.equal(t.replies.length, 4, 'no reply to the notification');
  assert.equal(t.replies[0].id, 1);
  assert.equal(t.replies[0].result.protocolVersion, '2025-03-26');
  assert.deepEqual(t.replies[0].result.capabilities, { tools: {} });
  assert.equal(t.replies[0].result.serverInfo.name, `jspark-forge-${name}`);
  assert.equal(t.replies[0].result.serverInfo.version, require('../.claude-plugin/plugin.json').version);
  assert.deepEqual(t.replies[1].result, { tools: [] });
  assert.deepEqual(t.replies[2].result, {});
  assert.equal(t.replies[3].error.code, -32601);
  assert.equal(recordOf(s.home)[name].mode, mode);
};
const restoreEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

test('server mode starts the pinned package', () => {
  const saved = process.env.JSPARK_FORGE_BUNDLED_CMD;
  delete process.env.JSPARK_FORGE_BUNDLED_CMD;
  try {
    assert.deepEqual(bundled.command('codebase-memory').slice(-2), ['-y', 'codebase-memory-mcp@0.12.1']);
    assert.deepEqual(bundled.command('playwright').slice(-2), ['-y', '@playwright/mcp@0.0.86']);
    assert.deepEqual(bundled.command('playwright', ['--x']).slice(-3), ['-y', '@playwright/mcp@0.0.86', '--x']);
    assert.equal(bundled.SERVERS['codebase-memory'].env, 'JSPARK_FORGE_CODE_MAP');
    assert.equal(bundled.SERVERS.playwright.setting, 'playwright');
  } finally { restoreEnv('JSPARK_FORGE_BUNDLED_CMD', saved); }
});

test('the override takes a JSON object and appends extra arguments', () => {
  const saved = process.env.JSPARK_FORGE_BUNDLED_CMD;
  process.env.JSPARK_FORGE_BUNDLED_CMD = JSON.stringify({ playwright: ['a', 'b'] });
  try { assert.deepEqual(bundled.command('playwright', ['c']), ['a', 'b', 'c']); } finally { restoreEnv('JSPARK_FORGE_BUNDLED_CMD', saved); }
});

test('stdio passes through; the record says run, exit null, and stays null after exit code 0', () => {
  const s = setup();
  const r = runLauncher(s, ['codebase-memory']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-engine says hi/);
  const rec = recordOf(s.home)['codebase-memory'];
  assert.equal(rec.mode, 'run');
  assert.equal(rec.pin, '0.12.1');
  assert.equal(rec.exit, null);
  assert.ok(rec.startedAt);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.out, 'utf8')), []);
});

test('a failing start is recorded (exit code 3) and the launcher exits 3', () => {
  const s = setup({ frontEnd: true });
  s.env.FAKE_EXIT = '3';
  const r = runLauncher(s, ['playwright']);
  assert.equal(r.status, 3);
  assert.equal(recordOf(s.home).playwright.exit.reason, 'exit code 3');
  assert.equal(recordOf(s.home).playwright.exit.code, 3);
});

test('a command that does not exist is recorded and names it (no network, npx missing)', () => {
  const s = setup();
  const missing = path.join(s.base, 'no-such-program');
  s.env.JSPARK_FORGE_BUNDLED_CMD = JSON.stringify({ 'codebase-memory': [missing] });
  const r = runLauncher(s, ['codebase-memory']);
  assert.notEqual(r.status, 0);
  const rec = recordOf(s.home)['codebase-memory'];
  assert.ok(rec.exit, 'exit recorded');
  assert.match(rec.exit.reason, /no-such-program/);
  assert.match(r.stderr, /no-such-program/);
});

test('off by env: an empty server, record mode off', () => {
  const s = setup();
  s.env.JSPARK_FORGE_CODE_MAP = 'off';
  emptyServerChecks(s, 'codebase-memory', 'off');
  assert.equal(fs.existsSync(s.out), false, 'the engine never ran');
});

test('off by rules.md (- code-map: off under ## Settings)', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.project, '.jspark-forge'));
  fs.writeFileSync(path.join(s.project, '.jspark-forge', 'rules.md'), '## Settings\n- code-map: off\n');
  assert.equal(bundled.mode('codebase-memory', s.project), 'off');
  assert.equal(bundled.mode('playwright', s.project), 'no-frontend');
  emptyServerChecks(s, 'codebase-memory', 'off');
});

test('playwright in a project with no front end: an empty server, mode no-frontend', () => {
  const s = setup();
  emptyServerChecks(s, 'playwright', 'no-frontend');
  assert.equal(fs.existsSync(s.out), false);
});

test('playwright in a project with a front end runs the engine; off by env wins over it', () => {
  const s = setup({ frontEnd: true });
  assert.equal(bundled.mode('playwright', s.project), 'run');
  const r = runLauncher(s, ['playwright']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(recordOf(s.home).playwright.mode, 'run');
  const saved = process.env.JSPARK_FORGE_PLAYWRIGHT;
  process.env.JSPARK_FORGE_PLAYWRIGHT = 'off';
  try { assert.equal(bundled.mode('playwright', s.project), 'off'); } finally { restoreEnv('JSPARK_FORGE_PLAYWRIGHT', saved); }
});

test('the empty server exits cleanly when stdin closes at once', () => {
  const s = setup();
  s.env.JSPARK_FORGE_CODE_MAP = 'off';
  const r = runLauncher(s, ['codebase-memory'], { input: '' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hasFrontEnd: dependencies or files', () => {
  const d = tmp();
  assert.equal(uitip.hasFrontEnd(d), false);
  fs.writeFileSync(path.join(d, 'package.json'), '{"devDependencies":{"vite":"5"}}');
  assert.equal(uitip.hasFrontEnd(d), true);
  const e = tmp();
  fs.mkdirSync(path.join(e, 'src'));
  fs.writeFileSync(path.join(e, 'src', 'App.tsx'), '');
  assert.equal(uitip.hasFrontEnd(e), true);
});

test('pass-through hands the engine exactly the arguments (JSON, a folder with a space)', () => {
  const s = setup({ space: true });
  const json = '{"repo_path":"C:/a b/c"}';
  const r = runLauncher(s, ['codebase-memory', 'cli', '--quiet', 'index_repository', json]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.out, 'utf8')), ['cli', '--quiet', 'index_repository', json]);
  assert.deepEqual(recordOf(s.home), {}, 'pass-through is not recorded');
});

test('pass-through keeps arguments with quotes, backslashes and spaces unchanged', () => {
  const s = setup({ space: true });
  const args = ['say "hi" there', '{"a":"b \\"c\\""}', 'C:\\Users\\Admin User\\x', 'trailing\\'];
  const r = runLauncher(s, ['codebase-memory', ...args]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.out, 'utf8')), args);
});

test('pass-through passes the engine exit code on; off says "switched off" and exits 1', () => {
  const s = setup();
  s.env.FAKE_EXIT = '5';
  assert.equal(runLauncher(s, ['playwright', 'x']).status, 5);
  const o = setup();
  o.env.JSPARK_FORGE_CODE_MAP = 'off';
  const r = runLauncher(o, ['codebase-memory', 'cli']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /switched off/);
  assert.equal(r.stdout, '');
});

test('an unknown server name is one stderr line and exit 1', () => {
  const s = setup();
  const r = runLauncher(s, ['nonsense']);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.equal(r.stdout, '');
});

test('stopping the launcher stops the engine too', async () => {
  const s = setup();
  const slow = path.join(s.base, 'slow.js');
  fs.writeFileSync(slow, "console.log('up'); setTimeout(() => {}, 15000);"); // ends by itself: on Windows a killed launcher cannot pass the signal on
  s.env.JSPARK_FORGE_BUNDLED_CMD = JSON.stringify({ 'codebase-memory': [process.execPath, slow] });
  const child = spawn(process.execPath, [bundled.LAUNCHER, 'codebase-memory'], { env: s.env, cwd: s.project, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(res => child.stdout.once('data', res));
  const done = new Promise(res => child.on('exit', (code, sig) => res({ code, sig })));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  const r = await done;
  clearTimeout(timer);
  assert.notEqual(r.sig, 'SIGKILL', 'the launcher had to be killed');
});

test('npxCommand never needs a shell: its first element is an existing file or "npx"', () => {
  const c = bundled.npxCommand();
  if (c === null) { assert.equal(process.platform, 'win32'); return; }
  assert.ok(Array.isArray(c));
  assert.ok(c[0] === 'npx' || fs.existsSync(c[0]), c[0]);
  if (c.length === 2) { assert.equal(c[0], process.execPath); assert.ok(fs.existsSync(c[1]), c[1]); }
});

test('record and read: atomic, shape kept, merges per server, never throws', () => {
  const home = tmp();
  bundled.record(home, 'playwright', { pin: '0.0.86', mode: 'run', startedAt: 1, exit: null });
  bundled.record(home, 'codebase-memory', { pin: '0.12.1', mode: 'off', startedAt: 2, exit: null });
  bundled.record(home, 'playwright', { exit: { code: 1, at: 3, reason: 'exit code 1' } });
  const r = bundled.read(home);
  assert.equal(r.playwright.mode, 'run');
  assert.equal(r.playwright.exit.reason, 'exit code 1');
  assert.equal(r['codebase-memory'].mode, 'off');
  assert.deepEqual(bundled.read(path.join(home, 'nope')), {});
  fs.writeFileSync(path.join(home, 'jspark-forge', 'bundled.json'), '{not json');
  assert.deepEqual(bundled.read(home), {});
  assert.doesNotThrow(() => bundled.record(path.join(home, 'jspark-forge', 'bundled.json'), 'x', {})); // a file where a folder should be
});

test('.mcp.json declares both servers through the launcher', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(j), ['mcpServers']);
  assert.deepEqual(j.mcpServers, {
    'codebase-memory': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp/run.js', 'codebase-memory'] },
    playwright: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp/run.js', 'playwright'] },
  });
  assert.ok(fs.existsSync(bundled.LAUNCHER));
  assert.equal(bundled.LAUNCHER, path.join(ROOT, 'scripts', 'mcp', 'run.js'));
});

// v0.5 review M2: the folder the session is in must not decide what code the launcher runs.
test('every child the launcher starts runs in a neutral folder with NoDefaultCurrentDirectoryInExePath set', () => {
  const s = setup({ frontEnd: true });
  const probe = path.join(s.base, 'probe.js');
  fs.writeFileSync(probe, "require('fs').appendFileSync(process.env.PROBE_OUT, JSON.stringify({ cwd: process.cwd(), nd: process.env.NoDefaultCurrentDirectoryInExePath, proj: process.env.CLAUDE_PROJECT_DIR }) + String.fromCharCode(10));");
  s.env.JSPARK_FORGE_BUNDLED_CMD = JSON.stringify({ 'codebase-memory': [process.execPath, probe], playwright: [process.execPath, probe] });
  s.env.PROBE_OUT = path.join(s.base, 'probe.out');
  assert.equal(runLauncher(s, ['codebase-memory']).status, 0);
  assert.equal(runLauncher(s, ['playwright', 'cli', 'x']).status, 0);
  const lines = fs.readFileSync(s.env.PROBE_OUT, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  const want = fs.realpathSync(path.join(s.home, 'jspark-forge'));
  for (const l of lines) {
    assert.equal(fs.realpathSync(l.cwd), want, 'the cwd is the neutral folder');
    assert.notEqual(fs.realpathSync(l.cwd), fs.realpathSync(s.project));
    assert.equal(l.nd, '1');
    assert.equal(l.proj, s.project, 'the project is still passed on through CLAUDE_PROJECT_DIR');
  }
});
