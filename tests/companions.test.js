'use strict';
// v0.5 design section 3: frontend-design and Chrome DevTools are added once per machine, in the background, when
// JSPARK Forge came from its marketplace. Every test uses its own temp home and a fake command; the real
// `claude plugin install` is never run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const companions = require('../scripts/lib/companions');
const setup = require('../scripts/lib/setup');

process.env.JSPARK_FORGE_AUTO_STATUSLINE = 'off';
const RUNNER = path.join(__dirname, '..', 'scripts', 'companion-install.js');
const FD = 'frontend-design@claude-plugins-official';
const DT = 'chrome-devtools-mcp@claude-plugins-official';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const wait = async (cond, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const MARKETS = { 'jspark-forge': { source: {} }, 'claude-plugins-official': { source: {} } };

function home(markets = MARKETS) {
  const h = tmp('forge-comp-');
  fs.mkdirSync(path.join(h, 'plugins'), { recursive: true });
  if (markets) fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), JSON.stringify(markets));
  return h;
}
// A fake `claude`: appends its arguments to a log, waits `sleep` ms, exits with `code`.
function fake({ code = 0, sleep = 0 } = {}) {
  const dir = tmp('forge-comp-fake-');
  const log = path.join(dir, 'calls.log');
  const js = path.join(dir, 'fake.js');
  fs.writeFileSync(js, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
setTimeout(() => process.exit(${code}), ${sleep});\n`);
  const cmd = JSON.stringify([process.execPath, js, 'plugin', 'install']);
  const calls = () => { try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  return { cmd, calls };
}
function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const back = () => { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } };
  try { const r = fn(); if (r && r.then) return r.finally(back); back(); return r; } catch (e) { back(); throw e; }
}
const results = h => readJson(path.join(h, 'jspark-forge', 'companions.json')) || {};
const stateOf = h => readJson(path.join(h, 'jspark-forge', 'state.json')) || {};
const both = h => () => results(h)['frontend-design'] && results(h)['chrome-devtools-mcp'];
const on = (cmd, fn) => withEnv({ JSPARK_FORGE_AUTO_SETUP: undefined, JSPARK_FORGE_COMPANION_CMD: cmd }, fn);

test('LIST names the two companions', () => {
  assert.deepEqual(companions.LIST.map(c => c.id), [FD, DT]);
});

test('first start from the marketplace: both installs start, one line names both, flags are set', async () => {
  const h = home(); const f = fake();
  await on(f.cmd, async () => {
    const st = {};
    const lines = companions.ensure(h, st);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^JSPARK Forge is adding frontend-design and chrome-devtools-mcp \(for UI work\); they load the next time Claude Code starts\. Remove any time: \/plugin uninstall /);
    assert.ok(lines[0].includes(FD) && lines[0].includes(DT));
    assert.ok(st.companions['frontend-design'] && st.companions['chrome-devtools-mcp']);
    assert.ok(stateOf(h).companions['frontend-design'], 'flag is on disk before the install finishes');
    assert.ok(await wait(both(h)));
    assert.equal(results(h)['frontend-design'].ok, true);
    assert.equal(results(h)['chrome-devtools-mcp'].ok, true);
    const calls = f.calls();
    assert.ok(calls.includes(`plugin install ${FD}`), calls.join('|'));
    assert.ok(calls.includes(`plugin install ${DT}`), calls.join('|'));
  });
});

test('second start: nothing starts, no line', async () => {
  const h = home(); const f = fake();
  await on(f.cmd, async () => {
    companions.ensure(h, {});
    assert.ok(await wait(() => f.calls().length === 2));
    const before = f.calls();
    assert.deepEqual(companions.ensure(h, stateOf(h)), []);
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(f.calls(), before);
  });
});

test('an installed companion is not installed again but its flag is still set', async () => {
  const h = home(); const f = fake();
  fs.writeFileSync(path.join(h, 'plugins', 'installed_plugins.json'), JSON.stringify({ [FD]: [] }));
  await on(f.cmd, async () => {
    const st = {};
    const lines = companions.ensure(h, st);
    assert.ok(st.companions['frontend-design'], 'flag set');
    assert.ok(!lines[0].includes('frontend-design'), lines[0]);
    assert.ok(await wait(() => f.calls().length === 1));
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(f.calls(), [`plugin install ${DT}`]);
  });
});

test('a companion removed later stays removed', async () => {
  const h = home(); const f = fake();
  await on(f.cmd, async () => {
    const st = { companions: { 'frontend-design': 1, 'chrome-devtools-mcp': 1 } };
    assert.deepEqual(companions.ensure(h, st), []);
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(f.calls(), []);
  });
});

test('a failed install is recorded with its reason', async () => {
  const h = home(); const f = fake({ code: 1 });
  await on(f.cmd, async () => {
    companions.ensure(h, {});
    assert.ok(await wait(both(h)));
    const r = results(h)['frontend-design'];
    assert.equal(r.ok, false);
    assert.match(r.reason, /exit code 1/);
    assert.ok(r.at);
  });
});

test('a command that cannot start is recorded, nothing thrown', async () => {
  const h = home();
  await on(JSON.stringify([path.join(os.tmpdir(), 'forge-no-such-program-xyz')]), async () => {
    assert.doesNotThrow(() => companions.ensure(h, {}));
    assert.ok(await wait(both(h)));
    assert.equal(results(h)['frontend-design'].ok, false);
    assert.ok(results(h)['frontend-design'].reason);
  });
});

test('claude not found on PATH: recorded by the runner', async () => {
  const h = home(); const empty = tmp('forge-comp-path-');
  const env = Object.assign({}, process.env, { PATH: empty, Path: empty });
  delete env.JSPARK_FORGE_COMPANION_CMD;
  const p = spawn(process.execPath, [RUNNER, h, 'frontend-design'], { env, stdio: 'ignore', windowsHide: true });
  await new Promise(r => p.on('close', r));
  const r = results(h)['frontend-design'];
  assert.equal(r.ok, false);
  assert.match(r.reason, /claude was not found/);
});

test('the hook call returns before the runner finishes', async () => {
  const h = home(); const f = fake({ sleep: 2000 });
  await on(f.cmd, async () => {
    const t0 = Date.now();
    companions.ensure(h, {});
    assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
    assert.deepEqual(results(h), {}, 'not finished yet');
    assert.ok(await wait(both(h), 25000));
  });
});

test('not from the marketplace, claude-plugins-official unknown, or JSPARK_FORGE_AUTO_SETUP=off: nothing starts, no flag', async () => {
  const f = fake();
  const cases = [
    [home(null), undefined],
    [home({ 'jspark-forge': {} }), undefined],
    [home({ 'claude-plugins-official': {} }), undefined],
    [home(), 'off'],
  ];
  for (const [h, off] of cases) {
    await withEnv({ JSPARK_FORGE_AUTO_SETUP: off, JSPARK_FORGE_COMPANION_CMD: f.cmd }, async () => {
      const st = {};
      assert.deepEqual(companions.ensure(h, st), []);
      assert.equal(st.companions, undefined);
      assert.equal(stateOf(h).companions, undefined);
    });
  }
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(f.calls(), []);
});

test('two starts at once run each install once', async () => {
  const h = home(); const f = fake();
  const code = `require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'lib', 'companions.js'))}).ensure(${JSON.stringify(h)}, {});`;
  const env = Object.assign({}, process.env, { JSPARK_FORGE_COMPANION_CMD: f.cmd });
  delete env.JSPARK_FORGE_AUTO_SETUP;
  const run = () => new Promise(r => spawn(process.execPath, ['-e', code], { env, stdio: 'ignore' }).on('close', r));
  await Promise.all([run(), run()]);
  assert.ok(await wait(both(h)));
  await new Promise(r => setTimeout(r, 300));
  const calls = f.calls();
  for (const id of [FD, DT]) assert.ok(calls.filter(c => c === `plugin install ${id}`).length <= 2, calls.join('|'));
  assert.equal(calls.length, 2, calls.join('|'));
  assert.ok(readJson(path.join(h, 'jspark-forge', 'companions.json')));
  assert.ok(readJson(path.join(h, 'jspark-forge', 'state.json')));
});

test('machineMessages: the line comes with the other start-up lines and the flags are saved', async () => {
  const h = home(); const f = fake();
  fs.writeFileSync(path.join(h, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  await on(f.cmd, async () => {
    const msgs = setup.machineMessages(h);
    assert.ok(msgs.some(m => /is adding frontend-design and chrome-devtools-mcp/.test(m)), msgs.join('|'));
    assert.ok(stateOf(h).companions['chrome-devtools-mcp']);
    assert.ok(await wait(() => f.calls().length === 2));
    assert.ok(!setup.machineMessages(h).some(m => /is adding/.test(m)));
  });
});

test('a flag set before the status-line block is still saved (old fault: changed = !!st.statusline)', () => {
  // settings.json that does not parse: the status-line block runs but decides nothing, so st.statusline stays unset.
  const h = home(null);
  fs.writeFileSync(path.join(h, 'settings.json'), '{ not json');
  withEnv({ JSPARK_FORGE_AUTO_STATUSLINE: undefined, JSPARK_FORGE_AUTO_SETUP: 'off' }, () => setup.machineMessages(h));
  const st = stateOf(h);
  assert.equal(st.statusline, undefined);
  assert.ok(st.guestsPrunedAt, 'the prune stamp, set before the status-line block, is saved');
});
