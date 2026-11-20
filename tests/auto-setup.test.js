'use strict';
// Owner 2026-11-19: no setup step. Install the plugin and it works.
// - First session in a git project: .jspark-forge/ is created automatically, with one line saying so.
// - Not a git project: nothing is created.
// - Status line: if the user has none, JSPARK Forge adds its own (once per machine, with the undo command);
//   if the user has their own, it is never touched: a one-time tip points to /jspark-forge:init.
// Every test points CLAUDE_CONFIG_DIR (Claude Code's own setting) at a temp folder: the real ~/.claude is never used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');

function config(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cfg-'));
  if (settings !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return dir;
}
function gitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auto-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}
function start(dir, cfg, event = 'SessionStart') {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'auto-0001', cwd: dir, source: 'startup', prompt: 'hi' }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: cfg }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const settingsOf = cfg => JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));

test('first session in a git project switches JSPARK Forge on by itself', () => {
  const dir = gitProject();
  const o = start(dir, config({}));
  const f = path.join(dir, '.jspark-forge');
  assert.equal(fs.readFileSync(path.join(f, '.gitignore'), 'utf8'), '*\n!.gitignore\n!rules.md\n!launch.md\n!graphs/\n!graphs/*.md\n');
  assert.ok(fs.existsSync(path.join(f, 'rules.md')));
  assert.match(o.systemMessage, /JSPARK Forge is on in this project/);
  assert.match(o.hookSpecificOutput.additionalContext, /^JSPARK Forge grounding rule:/, 'works from the first session');
});

test('the "is on" line appears only the first time', () => {
  const dir = gitProject(); const cfg = config({});
  start(dir, cfg);
  const o = start(dir, cfg);
  assert.ok(!o.systemMessage || !/is on in this project/.test(o.systemMessage));
});

test('a folder that is not a git project is left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-nogit-'));
  assert.equal(start(dir, config({})), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('also switches on at the first prompt (plugin installed mid-session)', () => {
  const dir = gitProject();
  start(dir, config({}), 'UserPromptSubmit');
  assert.ok(fs.existsSync(path.join(dir, '.jspark-forge', 'rules.md')));
});

test('no status line of their own: JSPARK Forge adds one, says how to undo, once per machine', () => {
  const cfg = config({ model: 'opus' });
  const o = start(gitProject(), cfg);
  const sl = settingsOf(cfg).statusLine;
  assert.match(sl.command, /jspark-forge[\\/]+statusline\.js/);
  assert.equal(sl.refreshInterval, 30);
  assert.equal(settingsOf(cfg).model, 'opus', 'other settings kept');
  assert.ok(fs.existsSync(path.join(cfg, 'jspark-forge', 'statusline.js')));
  assert.match(o.systemMessage, /added a status line/);
  assert.match(o.systemMessage, /\/jspark-forge:init --undo-statusline/);
  // a second project on the same machine: no second install, no repeat message
  const o2 = start(gitProject(), cfg);
  assert.ok(!/added a status line/.test(o2.systemMessage || ''));
});

test('no settings file at all counts as "no status line"', () => {
  const cfg = config(undefined);
  start(gitProject(), cfg);
  assert.match(settingsOf(cfg).statusLine.command, /statusline\.js/);
});

test('their own status line is never touched; a one-time tip points to /jspark-forge:init', () => {
  const own = { type: 'command', command: 'bash ~/my-statusline.sh' };
  const cfg = config({ statusLine: own });
  const before = fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8');
  const o = start(gitProject(), cfg);
  assert.equal(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'), before);
  assert.match(o.systemMessage, /you have your own status line/i);
  assert.match(o.systemMessage, /\/jspark-forge:init/);
  const o2 = start(gitProject(), cfg);
  assert.ok(!/your own status line/i.test(o2.systemMessage || ''), 'tip shown once');
});

test('a user who undid the status line does not get it added back', () => {
  const cfg = config({});
  start(gitProject(), cfg);
  spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'statusline', 'install.js'), '--undo',
    '--settings', path.join(cfg, 'settings.json'), '--home', path.join(cfg, 'jspark-forge')]);
  assert.equal(settingsOf(cfg).statusLine, undefined);
  start(gitProject(), cfg);
  assert.equal(settingsOf(cfg).statusLine, undefined);
});

test('superpowers tip: once per machine, and not when it is installed', () => {
  const cfg = config({});
  assert.match(start(gitProject(), cfg).systemMessage, /superpowers@jspark-forge/);
  assert.ok(!/superpowers/.test(start(gitProject(), cfg).systemMessage || ''));
  const cfg2 = config({});
  fs.mkdirSync(path.join(cfg2, 'plugins', 'cache', 'm', 'superpowers'), { recursive: true });
  assert.ok(!/superpowers/.test(start(gitProject(), cfg2).systemMessage || ''));
});

test('superpowers installed twice (another marketplace + ours): one-time note saying which copy to remove', () => {
  const cfg = config({ enabledPlugins: { 'superpowers@claude-plugins-official': true, 'superpowers@jspark-forge': true, 'jspark-forge@jspark-forge': true } });
  const o = start(gitProject(), cfg);
  assert.match(o.systemMessage, /superpowers is installed twice/);
  assert.match(o.systemMessage, /\/plugin uninstall superpowers@claude-plugins-official/);
  assert.ok(!/installed twice/.test(start(gitProject(), cfg).systemMessage || ''), 'once');
});

test('one copy of superpowers, or a disabled second copy: no note', () => {
  const one = config({ enabledPlugins: { 'superpowers@jspark-forge': true } });
  assert.ok(!/installed twice/.test(start(gitProject(), one).systemMessage || ''));
  const off = config({ enabledPlugins: { 'superpowers@claude-plugins-official': false, 'superpowers@jspark-forge': true } });
  assert.ok(!/installed twice/.test(start(gitProject(), off).systemMessage || ''));
});

// Fable verification (M6 follow-up): the git calls of automatic setup share one time budget, so a slow git can never
// push the hook past its 10 s limit. Out of budget, a git call fails at once (and failures after a remote is known
// mean guest, review M6).
test('setup git calls share one budget; out of budget they fail at once without starting git', () => {
  const setup = require('../scripts/lib/setup');
  assert.ok(setup.SETUP_BUDGET_MS <= 7000, 'budget leaves room inside the 10 s hook limit');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-budget-'));
  setup.startBudget(0);
  const t = Date.now();
  const r = setup.git(dir, ['--version']);
  assert.equal(r.ok, false);
  assert.equal(r.failed, true);
  assert.ok(Date.now() - t < 50, `${Date.now() - t} ms`);
  setup.startBudget(Infinity);
  assert.equal(setup.git(dir, ['--version']).ok, true);
});
