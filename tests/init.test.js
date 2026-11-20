'use strict';
// /jspark-forge:init (design 3.1, 7.4, 11; spec 5.9): creates the hidden folder with its own .gitignore and a
// starter rules.md, checks Node, never edits the root .gitignore, warns about a project-level status line,
// and suggests superpowers once if it is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INIT = path.join(__dirname, '..', 'scripts', 'init.js');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-init-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  fs.mkdirSync(project); fs.mkdirSync(claudeHome);
  return { project, claudeHome };
}
const init = (s, ...a) => spawnSync(process.execPath, [INIT, '--project', s.project, '--claude-home', s.claudeHome, ...a], { encoding: 'utf8' });

test('creates .jspark-forge/ with its own .gitignore and a starter rules.md', () => {
  const s = setup();
  const r = init(s);
  assert.equal(r.status, 0);
  const f = path.join(s.project, '.jspark-forge');
  assert.equal(fs.readFileSync(path.join(f, '.gitignore'), 'utf8'), '*\n!.gitignore\n!rules.md\n!launch.md\n!graphs/\n!graphs/*.md\n');
  const rules = fs.readFileSync(path.join(f, 'rules.md'), 'utf8');
  assert.match(rules, /^## Confirm$/m);
  assert.match(rules, /^## Never$/m);
  assert.match(rules, /^## Settings$/m);
  assert.match(r.stdout, /Created \.jspark-forge\//);
});

test('a second run keeps an edited rules.md and says the folder exists', () => {
  const s = setup();
  init(s);
  const rules = path.join(s.project, '.jspark-forge', 'rules.md');
  fs.writeFileSync(rules, '## Never\n- `my rule` : mine\n');
  const r = init(s);
  assert.equal(fs.readFileSync(rules, 'utf8'), '## Never\n- `my rule` : mine\n');
  assert.match(r.stdout, /already set up/i);
});

test('never touches the root .gitignore', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.project, '.gitignore'), 'node_modules\n');
  init(s);
  assert.equal(fs.readFileSync(path.join(s.project, '.gitignore'), 'utf8'), 'node_modules\n');
});

test('reports the Node version', () => {
  assert.match(init(setup()).stdout, new RegExp(`Node\\.js ${process.versions.node.replace(/\./g, '\\.')}: ok`));
});

test('warns when a project-level settings file sets its own status line', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.project, '.claude'));
  fs.writeFileSync(path.join(s.project, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'x' } }));
  assert.match(init(s).stdout, /this project sets its own status line.*plan-limit saves will not work here/i);
});

test('suggests superpowers once when it is missing, never again', () => {
  const s = setup();
  assert.match(init(s).stdout, /superpowers/);
  const s2 = { project: setup().project, claudeHome: s.claudeHome };
  assert.ok(!/superpowers/.test(init(s2).stdout));
});

test('says nothing about superpowers when it is installed', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.claudeHome, 'plugins', 'cache', 'claude-plugins-official', 'superpowers'), { recursive: true });
  assert.ok(!/superpowers/.test(init(s).stdout));
});

test('on first setup, says to commit rules.md and .gitignore with the project', () => {
  const r = init(setup());
  assert.match(r.stdout, /Commit \.jspark-forge\/rules\.md and \.jspark-forge\/\.gitignore with your project/);
});
