'use strict';
// v0.5.1 gaps 1 and 2: a missing .jspark-forge/.gitignore is repaired (own projects only); briefs are shared like graphs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const setup = require('../scripts/lib/setup');
const paths = require('../scripts/lib/paths');

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gi-'));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@example.invalid'); git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n'); git(dir, 'add', 'a.txt'); git(dir, 'commit', '-qm', 'init');
  return dir;
}
const cfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gi-cfg-'));
const hook = (dir, config, event = 'SessionStart') => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
  input: JSON.stringify({ session_id: 'gi-0001', cwd: dir, source: 'startup', hook_event_name: event }),
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: config, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });

test('gap 1: an own project with no .jspark-forge/.gitignore gets the default one at session start', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  paths.markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Confirm\n');
  hook(dir, cfg());
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', '.gitignore'), 'utf8'), setup.GITIGNORE);
});

test('gap 1: an existing .gitignore is left alone at session start (custom line kept)', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  paths.markOwn(dir);
  const mine = '*\n!.gitignore\n!rules.md\n# mine\n';
  fs.writeFileSync(path.join(dir, '.jspark-forge', '.gitignore'), mine);
  hook(dir, cfg());
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', '.gitignore'), 'utf8'), mine);
});

test('gap 1: never in a guest repo', () => {
  const dir = project();
  const config = cfg();
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try { setup.writeGuest(dir, {}); } finally { if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old; }
  assert.equal(paths.isOwn(dir), false);
  hook(dir, config);
  assert.equal(fs.existsSync(path.join(dir, '.jspark-forge')), false, 'nothing written into a guest repo');
});

test('gap 2: briefs are in the default list and added to an older list, once, in its own line ending', () => {
  assert.match(setup.GITIGNORE, /^!briefs\/$/m);
  assert.match(setup.GITIGNORE, /^!briefs\/\*\.md$/m);
  const dir = project();
  const f = path.join(dir, '.jspark-forge');
  fs.mkdirSync(path.join(f, 'state'), { recursive: true });
  const old = '*\r\n!.gitignore\r\n!rules.md\r\n!graphs/\r\n!graphs/*.md\r\n';
  fs.writeFileSync(path.join(f, '.gitignore'), old);
  setup.shareGraphs(dir);
  const now = fs.readFileSync(path.join(f, '.gitignore'), 'utf8');
  assert.equal(now, `${old}!briefs/\r\n!briefs/*.md\r\n`);
  setup.shareGraphs(dir);
  assert.equal(fs.readFileSync(path.join(f, '.gitignore'), 'utf8'), now);
});

test('gap 2: tracked .jspark-forge/briefs/<name>.md still counts as state made here', () => {
  const make = extra => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gi-briefs-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
    fs.mkdirSync(path.join(dir, '.jspark-forge'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Confirm\n');
    for (const x of extra) { fs.mkdirSync(path.dirname(path.join(dir, '.jspark-forge', x)), { recursive: true }); fs.writeFileSync(path.join(dir, '.jspark-forge', x), 'x\n'); }
    g('add', '-A', '-f'); g('-c', 'user.email=someone@example.com', '-c', 'user.name=x', 'commit', '-qm', 'theirs');
    return dir;
  };
  assert.equal(setup.stateMadeHere(make(['graphs/ship.md', 'briefs/step-one.md'])), true);
  assert.equal(setup.stateMadeHere(make(['briefs/deep/x.md'])), false, 'one level only');
  assert.equal(setup.stateMadeHere(make(['briefs/x.txt'])), false, 'only .md');
});
