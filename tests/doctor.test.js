'use strict';
// v0.1.1 health check (spec 5.13c, pulled forward): `forge.js doctor` says in plain words whether JSPARK Forge works,
// one line per check, each problem with the one step that fixes it; it changes nothing. `forge.js status` says what is
// saved now. Skills: /jspark-forge:doctor, /jspark-forge:status, /jspark-forge:upgrade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-doc-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const cfg = (settings) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-doc-cfg-'));
  if (settings) fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(settings));
  return d;
};
const run = (dir, home, ...args) => spawnSync(process.execPath, [FORGE, ...args], { cwd: dir, encoding: 'utf8', timeout: 60000,
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home }) }).stdout;
const tree = d => { const out = []; const walk = p => { for (const n of fs.readdirSync(p)) { const f = path.join(p, n); const s = fs.statSync(f); out.push(`${path.relative(d, f)}:${s.isDirectory() ? 'd' : s.size}:${s.mtimeMs}`); if (s.isDirectory()) walk(f); } }; walk(d); return out.sort().join('\n'); };
const WRAPPED = home => ({ statusLine: { type: 'command', command: `node "${path.join(home, 'jspark-forge', 'statusline.js').replace(/\\/g, '/')}"`, refreshInterval: 30 } });

test('doctor: a healthy project passes every check and says so in one summary line', () => {
  const dir = project();
  const home = cfg();
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(WRAPPED(home)));
  fs.mkdirSync(path.join(home, 'jspark-forge'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'statusline', 'wrapper.js'), path.join(home, 'jspark-forge', 'statusline.js'));
  fs.writeFileSync(path.join(home, 'jspark-forge', 'bundled.json'), JSON.stringify({ 'codebase-memory': { mode: 'run', exit: null } }));
  fs.mkdirSync(path.join(home, 'plugins'));
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'frontend-design chrome-devtools-mcp');
  // SessionEnd has 1 s, so 0.9 s counts as slow: two Node starts that slow happen when the whole suite runs beside
  // this test. A result whose only problem is hook speed is run once more; any other problem fails at once.
  let out = run(dir, home, 'doctor');
  const onlySlow = o => /^JSPARK Forge doctor: \d+ ok, 1 to fix/.test(o) && /^FIX\s+Hooks: too slow/m.test(o);
  if (onlySlow(out)) out = run(dir, home, 'doctor');
  assert.match(out.split('\n')[0], /^JSPARK Forge doctor: \d+ ok, 0 to fix/);
  for (const what of ['Node.js', 'Plugin files', 'Hooks', 'Git', 'Project', 'Rules', 'Status line']) assert.match(out, new RegExp(`^ok\\s+${what}`, 'm'), what);
  assert.match(out, /Hooks: \d+ answer in time/);
});

test('doctor changes nothing: the project and the config folder are byte-for-byte the same', () => {
  const dir = project(); const home = cfg({ theme: 'dark' });
  const before = [tree(dir), tree(home)];
  run(dir, home, 'doctor');
  assert.deepEqual([tree(dir), tree(home)], before);
});

test('doctor: each problem is a FIX line with the step that fixes it', () => {
  const dir = project(); const home = cfg({ statusLine: { type: 'command', command: 'my-status' } });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Confirm\n- `re:([` : bad regex\n');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), '# Where we were\n');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'handoff.json'), '{not json');
  const out = run(dir, home, 'doctor');
  assert.match(out.split('\n')[0], /[1-9]\d* to fix/);
  assert.match(out, /^FIX\s+Rules: .*line 2.*Fix: /m);
  assert.match(out, /^FIX\s+Handoff: .*Fix: /m);
  assert.match(out, /^FIX\s+Status line: your own\b.*80 % and 95 %.*Fix: \/jspark-forge:init/m);
});

test('doctor: no status line at all is a FIX; outside a project the project checks say how it switches on', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-doc-plain-'));
  const out = run(plain, cfg(), 'doctor');
  assert.match(out, /^FIX\s+Status line: none/m);
  assert.match(out, /^ok\s+Node\.js/m);
  assert.match(out, /Project: JSPARK Forge is not on in this folder/);
});

test('status: last save, what is waiting, and usage as of when', () => {
  const dir = project(); const home = cfg();
  const f = path.join(dir, '.jspark-forge');
  fs.writeFileSync(path.join(f, 'handoff.md'), '# Where we were\n');
  fs.writeFileSync(path.join(f, 'state', 'handoff.json'), JSON.stringify({ status: 'open', savedAt: Date.now() - 3 * 60000, task: 'Add export', step: { n: 4, m: 10 } }));
  fs.writeFileSync(path.join(f, 'state', 'waiting.json'), JSON.stringify({ items: [{ id: 'w1', question: 'Ship it?', askedAt: Date.now() - 2 * 3600000, session: 's', options: [] }] }));
  fs.mkdirSync(path.join(f, 'usage'));
  fs.writeFileSync(path.join(f, 'usage', 's.json'), JSON.stringify({ ts: Date.now() - 60000, context_pct: 41, five_hour_pct: 62, seven_day_pct: 30 }));
  const out = run(dir, home, 'status');
  assert.match(out, /Handoff: saved 3m ago: "Add export", step 4 of 10/);
  assert.match(out, /Waiting on you: 1 \(oldest 2h\)/);
  assert.match(out, /Usage: context 41 %, 5-hour 62 %, 7-day 30 % \(as of 1m ago\)/);
});

test('the doctor, status and upgrade skills run the script; upgrade asks first and ends with doctor', () => {
  const read = n => fs.readFileSync(path.join(ROOT, 'skills', n, 'SKILL.md'), 'utf8');
  assert.match(read('doctor'), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" doctor/);
  assert.match(read('status'), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" status/);
  const u = read('upgrade');
  assert.match(u, /^disable-model-invocation: true$/m);
  assert.match(u, /claude plugin update jspark-forge@jspark-forge/);
  assert.match(u, /\/jspark-forge:doctor/);
});

test('doctor: one slow start on a busy machine is not "too slow" (best of two tries per hook)', () => {
  const doc = require('../scripts/lib/doctor');
  let calls = 0;
  const fake = () => { calls++; return calls === 1 ? { ms: 5000, ok: true } : { ms: 50, ok: true }; };
  const r = doc.timeHook({ event: 'SessionEnd', timeout: 1000 }, fake);
  assert.equal(r.slow, false, 'the second, normal try counts');
  assert.equal(r.ms, 50);
  const slow = doc.timeHook({ event: 'SessionEnd', timeout: 1000 }, () => ({ ms: 950, ok: true }));
  assert.equal(slow.slow, true, 'consistently near the limit is flagged');
});

// ---- v0.5 (#7): auto-update, code map, Playwright and UI companions ----
const bundledLib = require('../scripts/lib/bundled');
const writeIn = (home, rel, obj) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const runningRec = () => ({ mode: 'run', startedAt: Date.now(), exit: null });
const withFront = dir => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '18.0.0' } }));
const doctorOut = (dir, home, extraEnv) => spawnSync(process.execPath, [FORGE, 'doctor'], { cwd: dir, encoding: 'utf8', timeout: 120000,
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home }, extraEnv) }).stdout;
const noOff = { JSPARK_FORGE_CODE_MAP: '', JSPARK_FORGE_PLAYWRIGHT: '' };
const flagged = (home, names) => writeIn(home, 'jspark-forge/state.json', { companions: Object.fromEntries(names.map(n => [n, 1])) });
const market = (home, autoUpdate) => writeIn(home, 'plugins/known_marketplaces.json', { 'jspark-forge': Object.assign({ source: { source: 'github', repo: 'x/y' } }, autoUpdate === undefined ? {} : { autoUpdate }) });
const installPlugins = (home, names) => writeIn(home, 'plugins/installed_plugins.json', { plugins: Object.fromEntries(names.map(n => [`${n}@claude-plugins-official`, [{}]])) });

test('issue #7: the map engine never started -> a FIX line, and the summary does not say "0 to fix"', () => {
  const dir = project(); const home = cfg();
  const out = doctorOut(dir, home, noOff);
  assert.match(out, /^FIX\s+Code map: the engine has not started\. Fix: restart Claude Code; if it stays, update Claude Code\.$/m);
  assert.doesNotMatch(out.split('\n')[0], / 0 to fix/);
});

test('doctor: auto-update on, off, and not from the marketplace', () => {
  const dir = project();
  let home = cfg(); market(home, true);
  assert.match(doctorOut(dir, home, noOff), /^ok\s+Auto-update: on$/m);
  home = cfg(); market(home, false);
  assert.match(doctorOut(dir, home, noOff), /^FIX\s+Auto-update: off, so new JSPARK Forge versions do not arrive\. Fix: \/plugin \u2192 Marketplaces \u2192 jspark-forge \u2192 turn on auto-update\.$/m);
  home = cfg();
  assert.match(doctorOut(dir, home, noOff), /^ok\s+Auto-update: not installed from the jspark-forge marketplace \(a local copy updates by hand\)$/m);
});

for (const [label, name, pin, front] of [['Code map', 'codebase-memory', '0.12.1', false], ['Playwright', 'playwright', '0.0.86', true]]) {
  test(`doctor: ${label} running, off by choice, no record, exit recorded`, () => {
    const dir = project(); if (front) withFront(dir);
    let home = cfg(); writeIn(home, 'jspark-forge/bundled.json', { [name]: runningRec() });
    const pkg = bundledLib.SERVERS[name].pkg;
    assert.match(doctorOut(dir, home, noOff), new RegExp(`^ok\\s+${label}: engine running \\(${pkg.replace(/[/@]/g, '\\$&')} ${pin.replace(/\./g, '\\.')}\\)$`, 'm'));
    home = cfg();
    const envOff = Object.assign({}, noOff, { [bundledLib.SERVERS[name].env]: 'off' });
    assert.match(doctorOut(dir, home, envOff), new RegExp(`^ok\\s+${label}: off by your choice$`, 'm'));
    home = cfg();
    assert.match(doctorOut(dir, home, noOff), new RegExp(`^FIX\\s+${label}: the engine has not started\\. Fix: restart Claude Code; if it stays, update Claude Code\\.$`, 'm'));
    home = cfg(); writeIn(home, 'jspark-forge/bundled.json', { [name]: Object.assign(runningRec(), { exit: { code: 1, at: 1, reason: 'exit code 1' } }) });
    assert.match(doctorOut(dir, home, noOff), new RegExp(`^FIX\\s+${label}: the engine did not start \\(exit code 1\\)\\. Fix: check the network and that antivirus has not quarantined it, then restart Claude Code\\.$`, 'm'));
  });
}

test('doctor: Playwright is off here when the project has no front end', () => {
  const dir = project(); const home = cfg();
  assert.match(doctorOut(dir, home, noOff), /^ok\s+Playwright: off here \(no front end in this project\)$/m);
});

test('doctor: two code map engines is a FIX naming the one to remove', () => {
  const dir = project(); const home = cfg();
  writeIn(home, 'jspark-forge/bundled.json', { 'codebase-memory': runningRec() });
  writeIn(home, '.claude.json', { mcpServers: { 'codebase-memory-mcp': { command: 'x' } } });
  const out = doctorOut(dir, home, noOff);
  assert.match(out, /^FIX\s+Code map: two engines \(JSPARK Forge's and your own codebase-memory-mcp\)\. Fix: remove yours with: claude mcp remove codebase-memory-mcp$/m);
});

test('doctor: UI companions in every state', () => {
  const dir = project();
  let home = cfg(); installPlugins(home, ['frontend-design', 'chrome-devtools-mcp']);
  assert.match(doctorOut(dir, home, noOff), /^ok\s+UI companions: frontend-design and chrome-devtools-mcp installed$/m);
  home = cfg(); installPlugins(home, ['chrome-devtools-mcp']); flagged(home, ['frontend-design', 'chrome-devtools-mcp']);
  assert.match(doctorOut(dir, home, noOff), /^ok\s+UI companions: frontend-design is being added; it loads the next time Claude Code starts$/m);
  home = cfg(); installPlugins(home, ['chrome-devtools-mcp']); flagged(home, ['frontend-design', 'chrome-devtools-mcp']);
  writeIn(home, 'jspark-forge/companions.json', { 'frontend-design': { at: 1, ok: false, reason: 'no network' } });
  assert.match(doctorOut(dir, home, noOff), /^FIX\s+UI companions: frontend-design could not be added \(no network\)\. Fix: \/plugin install frontend-design@claude-plugins-official$/m);
  home = cfg(); installPlugins(home, ['chrome-devtools-mcp']); flagged(home, ['frontend-design', 'chrome-devtools-mcp']);
  writeIn(home, 'jspark-forge/companions.json', { 'frontend-design': { at: 1, ok: true } });
  assert.match(doctorOut(dir, home, noOff), /^ok\s+UI companions: frontend-design not installed \(add: \/plugin install frontend-design@claude-plugins-official\)$/m);
  home = cfg(); installPlugins(home, ['chrome-devtools-mcp']);
  assert.match(doctorOut(dir, home, noOff), /^ok\s+UI companions: frontend-design not added yet \(JSPARK Forge adds it at the next start from its marketplace; or: \/plugin install frontend-design@claude-plugins-official\)$/m);
});

test('a healthy v0.5 machine: every new line is ok', () => {
  const dir = project(); withFront(dir);
  const home = cfg();
  writeIn(home, 'settings.json', WRAPPED(home));
  fs.mkdirSync(path.join(home, 'jspark-forge'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'statusline', 'wrapper.js'), path.join(home, 'jspark-forge', 'statusline.js'));
  writeIn(home, 'jspark-forge/bundled.json', { 'codebase-memory': runningRec(), playwright: runningRec() });
  market(home, true);
  installPlugins(home, ['frontend-design', 'chrome-devtools-mcp']);
  let out = doctorOut(dir, home, noOff);
  if (/^FIX\s+Hooks: too slow/m.test(out)) out = doctorOut(dir, home, noOff);
  console.log(out);
  assert.match(out.split('\n')[0], /^JSPARK Forge doctor: \d+ ok, 0 to fix/);
  for (const what of ['Auto-update: on', 'Code map: engine running', 'Playwright: engine running', 'UI companions: frontend-design and chrome-devtools-mcp installed']) assert.match(out, new RegExp(`^ok\\s+${what}`, 'm'), what);
});

test('doctor still changes nothing with the v0.5 checks on a full home', () => {
  const dir = project(); withFront(dir); const home = cfg({ theme: 'dark' });
  writeIn(home, 'jspark-forge/bundled.json', { 'codebase-memory': runningRec() });
  market(home); flagged(home, ['frontend-design']);
  const before = [tree(dir), tree(home)];
  doctorOut(dir, home, noOff);
  assert.deepEqual([tree(dir), tree(home)], before);
});

test("the doctor's own hook run never switches anything on", () => {
  const dir = project(); const home = cfg({ theme: 'dark' });
  writeIn(home, 'plugins/known_marketplaces.json', { 'jspark-forge': { source: {} }, 'claude-plugins-official': { source: {} } });
  const settings = fs.readFileSync(path.join(home, 'settings.json'), 'utf8');
  doctorOut(dir, home, { JSPARK_FORGE_AUTO_SETUP: '' });
  assert.equal(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'), settings);
  assert.equal(fs.existsSync(path.join(home, 'jspark-forge', 'companions.json')), false);
  assert.equal(fs.existsSync(path.join(home, 'jspark-forge', 'state.json')), false);
});
