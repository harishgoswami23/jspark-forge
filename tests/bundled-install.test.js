'use strict';
// v0.5 fix: the two engines are installed once into <claude home>/jspark-forge/engines/<name>-<pin>/ by a detached
// installer (scripts/mcp/install.js) and started with Node directly, not through npx. A first start that was cut
// short used to leave a half-written npx folder that broke every later start for good. A fake installer (a small Node
// script passed through JSPARK_FORGE_BUNDLED_INSTALL_CMD) stands in for npm, so nothing here uses npm or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const bundled = require('../scripts/lib/bundled');
process.env.JSPARK_FORGE_NODE_MAJOR = '20';

const ENGINE_SRC = `const fs = require('fs');
if (process.env.FAKE_OUT) fs.writeFileSync(process.env.FAKE_OUT, JSON.stringify(process.argv.slice(2)));
console.log('fake-engine says hi');
process.exit(Number(process.env.FAKE_EXIT || 0));
`;
// Gets (engine folder, <pkg>@<pin>) like npm would; writes node_modules/<pkg>/package.json with a bin and the bin
// script. FAKE_INSTALL_SLEEP (ms), FAKE_INSTALL_FAIL (stderr text, exit 1), FAKE_COUNT (a line per run),
// FAKE_BIN_FORM ('string' or 'object').
const INSTALL_SRC = `const fs = require('fs');
const path = require('path');
const [dir, spec] = process.argv.slice(2);
const pkg = spec.slice(0, spec.lastIndexOf('@'));
if (process.env.FAKE_COUNT) fs.appendFileSync(process.env.FAKE_COUNT, 'run' + String.fromCharCode(10));
setTimeout(() => {
  if (process.env.FAKE_INSTALL_FAIL) { process.stderr.write(process.env.FAKE_INSTALL_FAIL); process.exit(1); }
  const pd = path.join(dir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(pd, { recursive: true });
  const rel = process.env.FAKE_BIN_FORM === 'object' ? 'lib/main.js' : 'bin.js';
  const bin = process.env.FAKE_BIN_FORM === 'object' ? { 'some-name': rel } : rel;
  fs.writeFileSync(path.join(pd, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0', bin }));
  fs.mkdirSync(path.dirname(path.join(pd, rel)), { recursive: true });
  fs.writeFileSync(path.join(pd, rel), fs.readFileSync(process.env.FAKE_ENGINE_SRC, 'utf8'));
}, Number(process.env.FAKE_INSTALL_SLEEP || 0));
`;

function setup({ space = false, frontEnd = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-install-'));
  const home = path.join(base, 'home');
  const project = path.join(base, space ? 'my project' : 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  if (frontEnd) fs.writeFileSync(path.join(project, 'package.json'), '{"dependencies":{"react":"18.0.0"}}');
  const engine = path.join(base, 'fake-engine.js');
  const inst = path.join(base, 'fake-install.js');
  fs.writeFileSync(engine, ENGINE_SRC);
  fs.writeFileSync(inst, INSTALL_SRC);
  const s = { base, home, project, out: path.join(base, 'args.json'), counter: path.join(base, 'count.txt') };
  s.env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: project, FAKE_OUT: s.out,
    FAKE_COUNT: s.counter, FAKE_ENGINE_SRC: engine, JSPARK_FORGE_BUNDLED_INSTALL_CMD: JSON.stringify([process.execPath, inst]) });
  delete s.env.JSPARK_FORGE_BUNDLED_CMD; delete s.env.JSPARK_FORGE_CODE_MAP; delete s.env.JSPARK_FORGE_PLAYWRIGHT;
  return s;
}
const recordOf = s => bundled.read(s.home, s.project);
const counted = s => { try { return fs.readFileSync(s.counter, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const marker = (s, name = 'codebase-memory') => path.join(bundled.engineDir(s.home, name), 'installed.json');
const sleep = ms => new Promise(res => setTimeout(res, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return fn(); }
const runSync = (s, args) => spawnSync(process.execPath, [bundled.LAUNCHER, ...args], { encoding: 'utf8', env: s.env, cwd: s.project });
function launch(s, args) {
  const child = spawn(process.execPath, [bundled.LAUNCHER, ...args], { env: s.env, cwd: s.project, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const done = new Promise(res => child.on('close', status => res({ status, stdout, stderr })));
  return { child, done };
}

test('the engine folders and the install command (no npx)', () => {
  const saved = process.env.JSPARK_FORGE_BUNDLED_INSTALL_CMD;
  delete process.env.JSPARK_FORGE_BUNDLED_INSTALL_CMD;
  try {
    const home = path.join(os.tmpdir(), 'h');
    assert.equal(bundled.engineDir(home, 'codebase-memory'), path.join(home, 'jspark-forge', 'engines', 'codebase-memory-mcp-0.12.1'));
    assert.equal(bundled.engineDir(home, 'playwright'), path.join(home, 'jspark-forge', 'engines', 'playwright-mcp-0.0.86'));
    const c = bundled.installCommand(home, 'playwright');
    if (c === null) assert.equal(process.platform, 'win32');
    else {
      assert.ok(c[0] === 'npm' || (c[0] === process.execPath && fs.existsSync(c[1])), c[0]);
      assert.deepEqual(c.slice(-7), ['install', '--prefix', bundled.engineDir(home, 'playwright'), '--no-audit', '--no-fund', '--no-save', '@playwright/mcp@0.0.86']);
    }
    assert.equal(bundled.npxCommand, undefined, 'the npx path is gone');
  } finally { if (saved === undefined) delete process.env.JSPARK_FORGE_BUNDLED_INSTALL_CMD; else process.env.JSPARK_FORGE_BUNDLED_INSTALL_CMD = saved; }
});

test('first start with no engine folder: the installer runs, the marker appears, the engine starts with Node, mode ends run', async () => {
  const s = setup();
  const r = await launch(s, ['codebase-memory']).done;
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'fake-engine says hi\n', 'only the engine writes to stdout');
  const m = JSON.parse(fs.readFileSync(marker(s), 'utf8'));
  assert.equal(m.pkg, 'codebase-memory-mcp');
  assert.equal(m.pin, '0.12.1');
  assert.ok(m.at);
  assert.equal(counted(s), 1);
  assert.equal(recordOf(s)['codebase-memory'].mode, 'run');
  assert.equal(recordOf(s)['codebase-memory'].exit, null);
  const r2 = await launch(s, ['codebase-memory']).done;
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(counted(s), 1, 'the second start does not install again');
});

test('the regression: a half-written engine folder (no marker) is cleaned and installed again', async () => {
  const s = setup();
  const dir = bundled.engineDir(s.home, 'codebase-memory');
  const left = path.join(dir, 'node_modules', 'codebase-memory-mcp', 'leftover.txt');
  fs.mkdirSync(path.dirname(left), { recursive: true });
  fs.writeFileSync(left, 'half');
  const r = await launch(s, ['codebase-memory']).done;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-engine says hi/);
  assert.equal(fs.existsSync(left), false, 'cleaned');
  assert.ok(fs.existsSync(marker(s)));
  assert.equal(counted(s), 1);
});

test('a complete-looking folder without a marker is never used', async () => {
  const s = setup();
  const pd = path.join(bundled.engineDir(s.home, 'codebase-memory'), 'node_modules', 'codebase-memory-mcp');
  fs.mkdirSync(pd, { recursive: true });
  fs.writeFileSync(path.join(pd, 'package.json'), '{"bin":"bin.js"}');
  fs.writeFileSync(path.join(pd, 'bin.js'), 'console.log("poisoned")');
  const r = await launch(s, ['codebase-memory']).done;
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /poisoned/);
  assert.equal(counted(s), 1);
});

test('the launcher is killed while it waits: the detached installer still finishes, the next start does not install', async () => {
  const s = setup();
  s.env.FAKE_INSTALL_SLEEP = '3000';
  const { child, done } = launch(s, ['codebase-memory']);
  assert.ok(await until(() => counted(s) === 1), 'the installer started');
  assert.ok(await until(() => (recordOf(s)['codebase-memory'] || {}).mode === 'installing'), 'recorded as installing');
  child.kill('SIGKILL');
  await done;
  assert.equal(fs.existsSync(marker(s)), false, 'not finished yet');
  assert.ok(await until(() => fs.existsSync(marker(s)), 20000), 'the installer survived the launcher');
  const r = await launch(s, ['codebase-memory']).done;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-engine says hi/);
  assert.equal(counted(s), 1, 'no second install');
});

test('a failing install: no marker, the reason is recorded, the launcher exits non-zero, a second start tries again', async () => {
  const s = setup();
  s.env.FAKE_INSTALL_FAIL = 'npm error code E404 no such package';
  const r = await launch(s, ['codebase-memory']).done;
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(marker(s)), false);
  const rec = recordOf(s)['codebase-memory'];
  assert.ok(rec.exit, 'failure recorded');
  assert.match(rec.exit.reason, /E404 no such package/);
  assert.equal(counted(s), 1);
  const r2 = await launch(s, ['codebase-memory']).done;
  assert.notEqual(r2.status, 0);
  assert.equal(counted(s), 2, 'tried again');
  delete s.env.FAKE_INSTALL_FAIL;
  const r3 = await launch(s, ['codebase-memory']).done;
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(recordOf(s)['codebase-memory'].exit, null);
});

test('the recorded reason is the last 300 characters of the installer stderr', async () => {
  const s = setup();
  s.env.FAKE_INSTALL_FAIL = `${'x'.repeat(500)}THE-END`;
  await launch(s, ['codebase-memory']).done;
  const reason = recordOf(s)['codebase-memory'].exit.reason;
  assert.equal(reason.length, 300);
  assert.match(reason, /THE-END$/);
});

test('two launchers at once: one install', async () => {
  const s = setup();
  s.env.FAKE_INSTALL_SLEEP = '1500';
  const [ra, rb] = await Promise.all([launch(s, ['codebase-memory']).done, launch(s, ['codebase-memory']).done]);
  assert.equal(ra.status, 0, ra.stderr);
  assert.equal(rb.status, 0, rb.stderr);
  assert.match(ra.stdout, /fake-engine says hi/);
  assert.match(rb.stdout, /fake-engine says hi/);
  assert.equal(counted(s), 1);
});

test('a lock whose process is gone does not block the installer', async () => {
  const s = setup();
  fs.mkdirSync(path.join(s.home, 'jspark-forge', 'engines'), { recursive: true });
  fs.writeFileSync(path.join(s.home, 'jspark-forge', 'engines', 'codebase-memory-mcp-0.12.1.lock'), JSON.stringify({ pid: 2147483000, at: Date.now() }));
  const r = await launch(s, ['codebase-memory']).done;
  assert.equal(r.status, 0, r.stderr);
  assert.equal(counted(s), 1);
});

test('pass-through while not installed: exit 1, one stderr line, the installer started; once installed the arguments arrive unchanged', async () => {
  const s = setup({ space: true });
  const args = ['cli', 'say "hi" there', '{"repo_path":"C:/a b/c"}', 'C:\\Users\\Admin User\\x'];
  const r = runSync(s, ['codebase-memory', ...args]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.trim(), 'jspark-forge: the engine is still being installed');
  assert.ok(await until(() => fs.existsSync(marker(s))), 'the installer ran');
  assert.equal(counted(s), 1);
  const ok = runSync(s, ['codebase-memory', ...args]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.out, 'utf8')), args);
  assert.equal(counted(s), 1);
  s.env.FAKE_EXIT = '5';
  assert.equal(runSync(s, ['codebase-memory', 'x']).status, 5, 'the engine exit code is passed on');
});

for (const form of ['string', 'object']) {
  test(`the bin comes from the installed package.json (${form} form)`, async () => {
    const s = setup({ frontEnd: true });
    s.env.FAKE_BIN_FORM = form;
    const r = await launch(s, ['playwright']).done;
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fake-engine says hi/);
    const pd = path.join(bundled.engineDir(s.home, 'playwright'), 'node_modules', '@playwright', 'mcp');
    assert.equal(typeof JSON.parse(fs.readFileSync(path.join(pd, 'package.json'), 'utf8')).bin, form === 'string' ? 'string' : 'object');
    assert.equal(bundled.binPath(s.home, 'playwright'), path.join(pd, form === 'string' ? 'bin.js' : path.join('lib', 'main.js')));
  });
}
