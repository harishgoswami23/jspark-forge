'use strict';
// v0.5.1 gaps, item 15: tests for things that were built but not tested: the README hook table against hooks.json,
// the "over 200 entries" line of decide.js, and resume under a second Claude config folder (account change).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const D = require('../scripts/lib/decisions');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');

test('the README hook table lists every event in hooks/hooks.json and no other', () => {
  const events = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks).sort();
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split(/\r?\n/);
  const start = readme.findIndex(l => /^##\s+Every hook, documented/.test(l));
  assert.ok(start >= 0, 'the section exists');
  const rows = [];
  for (let i = start + 1; i < readme.length && !/^##\s/.test(readme[i]); i++) {
    if (/^\|/.test(readme[i]) && !/^\|\s*(Hook|-)/.test(readme[i])) rows.push(readme[i].split('|')[1]);
  }
  const listed = rows.flatMap(cell => (cell.split('(')[0].match(/\b[A-Z][A-Za-z]+\b/g) || [])).sort();
  assert.deepEqual(listed, events);
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-built-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n'); g('add', 'a.txt'); g('commit', '-qm', 'init');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const cli = (dir, args) => spawnSync(process.execPath, [FORGE, ...args], { cwd: dir, encoding: 'utf8',
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'cfg') }) }).stdout;

test('decisions: more than 200 entries suggests an archive; 200 do not', () => {
  const dir = project();
  const f = path.join(dir, '.jspark-forge', 'decisions.md');
  let text = '';
  for (let i = 0; i < 200; i++) text = D.addEntry(text, { title: `Choice ${i}`, touches: [`src/p${i}/`] }).text;
  fs.writeFileSync(f, text);
  assert.doesNotMatch(cli(dir, ['decisions']), /Over 200 entries/);
  fs.writeFileSync(f, D.addEntry(text, { title: 'One more', touches: ['src/more/'] }).text);
  const out = cli(dir, ['decisions']);
  assert.match(out, /Over 200 entries: consider moving retired ones to an archive file to keep the file quick to read\./);
});

test('resume works under a second CLAUDE_CONFIG_DIR: the handoff is a project file, not an account file', () => {
  const dir = project();
  const cfgA = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-built-cfgA-'));
  const cfgB = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-built-cfgB-'));
  const hook = (cfg, sid, event, input) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: sid, cwd: dir, hook_event_name: event }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: cfg, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  hook(cfgA, 'aaaaaaaa-0001', 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'billing.ts') } });
  assert.ok(fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md')), 'saved in the project');
  assert.ok(!fs.existsSync(path.join(cfgA, 'jspark-forge', 'handoff.md')), 'not in the account folder');
  const r = hook(cfgB, 'bbbbbbbb-0002', 'SessionStart', { source: 'startup' });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Where we were/);
  assert.match(ctx, /src\/billing\.ts/);
  assert.match(ctx, /Continue\?/);
});
