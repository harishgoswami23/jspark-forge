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
