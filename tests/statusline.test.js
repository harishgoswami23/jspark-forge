'use strict';
// Design 7.1 (wrapper), 7.4 (install, disclosure, undo), owner 2026-11-19 (refreshInterval 30 when none).
// Never touches the real ~/.claude: every case uses --settings / --home in a temp folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const INSTALL = path.join(__dirname, '..', 'scripts', 'statusline', 'install.js');

function sandbox(statusLine, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sl-'));
  const settings = path.join(root, 'settings.json');
  const home = path.join(root, 'home');
  const obj = Object.assign({ model: 'opus', env: { FOO: 'bar' } }, extra);
  if (statusLine) obj.statusLine = statusLine;
  const before = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(settings, before);
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.jspark-forge', 'state'), { recursive: true });
  return { root, settings, home, before, project };
}
const install = (s, ...a) => spawnSync(process.execPath, [INSTALL, '--settings', s.settings, '--home', s.home, ...a], { encoding: 'utf8' });
const settingsOf = s => JSON.parse(fs.readFileSync(s.settings, 'utf8'));
function wrap(s, input = {}) {
  const stdin = JSON.stringify(Object.assign({ session_id: 'sess-1', workspace: { project_dir: s.project, current_dir: s.project },
    context_window: { used_percentage: 42 }, rate_limits: { five_hour: { used_percentage: 12, resets_at: 1795100000 } } }, input));
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(s.home, 'statusline.js')], { input: stdin, encoding: 'utf8', timeout: 10000 });
  return { out: r.stdout, ms: Date.now() - t };
}
const nodeEcho = text => ({ type: 'command', command: `node -e "process.stdout.write('${text}')"` });

test('install with no status line: wrapper set, refreshInterval 30 added, backup kept', () => {
  const s = sandbox(null);
  const r = install(s);
  assert.equal(r.status, 0);
  const sl = settingsOf(s).statusLine;
  assert.equal(sl.type, 'command');
  assert.match(sl.command, /^node ".*statusline\.js"$/);
  assert.equal(sl.refreshInterval, 30);
  assert.ok(fs.existsSync(path.join(s.home, 'statusline.js')));
  assert.ok(fs.readdirSync(s.home).some(f => /^settings\.backup-\d+\.json$/.test(f)));
  assert.equal(settingsOf(s).env.FOO, 'bar', 'other settings untouched');
});

test("install keeps the user's own padding and refreshInterval", () => {
  const s = sandbox(Object.assign(nodeEcho('mine'), { padding: 2, refreshInterval: 10 }));
  install(s);
  const sl = settingsOf(s).statusLine;
  assert.equal(sl.padding, 2);
  assert.equal(sl.refreshInterval, 10);
});

test('undo restores settings byte for byte (with and without an original status line)', () => {
  for (const orig of [null, nodeEcho('mine')]) {
    const s = sandbox(orig);
    install(s);
    const u = install(s, '--undo');
    assert.equal(u.status, 0);
    assert.equal(fs.readFileSync(s.settings, 'utf8'), s.before);
  }
});

test('undo after other edits restores only the status line and keeps the edits', () => {
  const s = sandbox(nodeEcho('mine'));
  install(s);
  const now = settingsOf(s); now.theme = 'dark';
  fs.writeFileSync(s.settings, JSON.stringify(now, null, 2) + '\n');
  install(s, '--undo');
  const after = settingsOf(s);
  assert.deepEqual(after.statusLine, nodeEcho('mine'));
  assert.equal(after.theme, 'dark');
});

test('installing twice changes nothing the second time but refreshes the wrapper copy', () => {
  const s = sandbox(null);
  install(s);
  const once = fs.readFileSync(s.settings, 'utf8');
  fs.writeFileSync(path.join(s.home, 'statusline.js'), '// stale');
  const r = install(s);
  assert.match(r.stdout, /already/i);
  assert.equal(fs.readFileSync(s.settings, 'utf8'), once);
  assert.ok(fs.readFileSync(path.join(s.home, 'statusline.js'), 'utf8').length > 100);
});

test('a settings file that is not valid JSON is left alone', () => {
  const s = sandbox(null);
  fs.writeFileSync(s.settings, '{ broken');
  const r = install(s);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(s.settings, 'utf8'), '{ broken');
});

test('wrapper: original output byte for byte, then the JSPARK Forge note', () => {
  const s = sandbox(nodeEcho('\\x1b[32mmine\\x1b[0m'));
  install(s);
  fs.writeFileSync(path.join(s.project, '.jspark-forge', 'state', 'handoff.json'), JSON.stringify({ status: 'open', savedAt: Date.now() - 3 * 60000 }));
  // The original command gets 2 s (by design); a cold Node start on a busy CI machine once took longer, so a run that
  // timed out is tried once more (CI 2026-11-20, Windows, Node 18).
  let r = wrap(s);
  if (!r.out.includes('mine')) r = wrap(s);
  assert.equal(r.out, '\x1b[32mmine\x1b[0m · JSPARK Forge saved 3m ago');
});

test('wrapper: no original -> the note alone; no handoff yet -> "JSPARK Forge on"', () => {
  const s = sandbox(null);
  install(s);
  assert.equal(wrap(s).out, 'JSPARK Forge on');
});

test('wrapper: in a project without .jspark-forge/ it adds nothing and writes nothing', () => {
  const s = sandbox(nodeEcho('mine'));
  install(s);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sl-other-'));
  assert.equal(wrap(s, { workspace: { project_dir: other } }).out, 'mine');
  assert.deepEqual(fs.readdirSync(other), []);
});

test('wrapper writes .jspark-forge/usage/<session>.json with the figures', () => {
  const s = sandbox(null);
  install(s);
  wrap(s);
  const u = JSON.parse(fs.readFileSync(path.join(s.project, '.jspark-forge', 'usage', 'sess-1.json'), 'utf8'));
  assert.equal(u.context_pct, 42);
  assert.equal(u.five_hour_pct, 12);
  assert.equal(u.seven_day_pct, null);
  assert.ok(Date.now() - u.ts < 10000);
});

test('wrapper: a failing original prints only the note; a hanging one is cut at 2 s', () => {
  const s = sandbox({ type: 'command', command: 'node -e "process.exit(3)"' });
  install(s);
  assert.equal(wrap(s).out, 'JSPARK Forge on');
  const h = sandbox({ type: 'command', command: 'node -e "setTimeout(()=>{},5000)"' });
  install(h);
  const r = wrap(h);
  assert.equal(r.out, 'JSPARK Forge on');
  assert.ok(r.ms < 3500, `${r.ms} ms`);
});

test('wrapper: statusline-segment: off in rules.md hides the note', () => {
  const s = sandbox(nodeEcho('mine'));
  install(s);
  fs.writeFileSync(path.join(s.project, '.jspark-forge', 'rules.md'), '## Settings\n- statusline-segment: off\n');
  assert.equal(wrap(s).out, 'mine');
});

test('wrapper keeps working when the plugin folder is gone (it runs from its own copy)', () => {
  const s = sandbox(nodeEcho('mine'));
  install(s);
  const cfg = JSON.parse(fs.readFileSync(path.join(s.home, 'statusline.json'), 'utf8'));
  assert.ok(!JSON.stringify(cfg).includes('scripts/statusline'), 'config does not point into the plugin');
  assert.equal(wrap(s).out, 'mine · JSPARK Forge on');
});

test('--status prints the current status line command for the disclosure', () => {
  const s = sandbox(nodeEcho('mine'));
  const r = install(s, '--status');
  assert.match(r.stdout, /node -e/);
  assert.equal(fs.readFileSync(s.settings, 'utf8'), s.before, '--status changes nothing');
  const n = sandbox(null);
  assert.match(install(n, '--status').stdout, /none/);
});
