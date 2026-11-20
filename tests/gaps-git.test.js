'use strict';
// v0.5.1 gaps 3: the handoff counts files (not git status lines), and says when a repo has no commits yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { gitInfo } = require('../scripts/lib/git');
const handoff = require('../scripts/lib/handoff');
const paths = require('../scripts/lib/paths');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function repo({ commit = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gg-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
  if (commit) { fs.writeFileSync(path.join(dir, 'a'), 'a'); g('add', 'a'); g('commit', '-qm', 'i'); }
  return dir;
}
const many = (dir, folder, n) => {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, folder, `f${i}.txt`), String(i));
};

test('gap 3: an untracked folder counts every file in it, not one line', () => {
  const dir = repo();
  many(dir, 'newdir', 30);
  fs.writeFileSync(path.join(dir, 'a'), 'changed');
  const g = gitInfo(dir);
  assert.equal(g.dirty, 31);
  assert.ok(!g.capped && !g.approx);
});

test('gap 3: the .jspark-forge folder is still not counted', () => {
  const dir = repo();
  many(dir, '.jspark-forge/state', 5);
  assert.equal(gitInfo(dir).dirty, 0);
});

test('gap 3: counting stops at 2000 and says so', () => {
  const dir = repo();
  many(dir, 'big', 2105);
  const g = gitInfo(dir);
  assert.equal(g.dirty, 2000);
  assert.equal(g.capped, true);
  const head = handoff.render({ asOf: new Date(2026, 10, 21, 9, 0), reason: 'stop', git: g, task: 't' }).split('\n')[1];
  assert.match(head, /2000\+ files not committed/);
});

test('gap 3: when the full count times out, today\'s count is used and called "about"', () => {
  const dir = repo();
  many(dir, 'newdir', 12);
  const g = gitInfo(dir, { fullTimeoutMs: 1 });
  assert.equal(g.approx, true);
  assert.equal(g.dirty, 1, 'the folder is one status line, as before');
  const head = handoff.render({ asOf: new Date(2026, 10, 21, 9, 0), reason: 'stop', git: g, task: 't' }).split('\n')[1];
  assert.match(head, /about 1 file not committed/);
});

test('gap 3: a repo with no commit says so in the handoff header', () => {
  const dir = repo({ commit: false });
  many(dir, 'src', 7);
  const g = gitInfo(dir);
  assert.equal(g.noCommits, true);
  assert.equal(g.head, null);
  assert.equal(g.dirty, 7);
  const head = handoff.render({ asOf: new Date(2026, 10, 21, 9, 0), reason: 'stop', git: g, task: 't' }).split('\n')[1];
  assert.match(head, /no commits yet in this repo \(7 files untracked\)/);
  assert.doesNotMatch(head, /not committed/);
});

function ownRepo(commit) {
  const dir = repo({ commit });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  paths.markOwn(dir);
  return dir;
}
const start = (dir, config) => spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8',
  input: JSON.stringify({ session_id: 'gg-0001', cwd: dir, source: 'startup' }),
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: config, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
const TIP = 'JSPARK Forge: this repo has no commits yet, so a crash or a bad edit cannot be undone. Ask Claude to make a first commit.';

test('gap 3: session start in an own repo with no commits tells the user once a day', () => {
  const dir = ownRepo(false);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gg-cfg-'));
  const first = JSON.parse(start(dir, config).stdout);
  assert.ok(first.systemMessage.split('\n').includes(TIP));
  const second = JSON.parse(start(dir, config).stdout);
  assert.ok(!String(second.systemMessage || '').includes('no commits yet'), 'once a day');
  const tips = JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'tips.json'), 'utf8'));
  assert.ok(tips.noCommitsTold);
});

test('gap 3: no tip when the repo has a commit', () => {
  const dir = ownRepo(true);
  const o = JSON.parse(start(dir, fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gg-cfg-'))).stdout);
  assert.ok(!String(o.systemMessage || '').includes('no commits yet'));
});
