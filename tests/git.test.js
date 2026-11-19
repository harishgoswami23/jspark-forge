'use strict';
// headBranch: the current branch read from .git files, no git process (SessionStart and force-push checks).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { headBranch } = require('../scripts/lib/git');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a'), 'a'); g('add', 'a'); g('commit', '-qm', 'i');
  return { dir, g };
}

test('reads the branch, and follows a checkout', () => {
  const { dir, g } = repo();
  assert.equal(headBranch(dir), 'main');
  g('checkout', '-qb', 'feature/x');
  assert.equal(headBranch(dir), 'feature/x');
});

test('works from a subfolder of the repo', () => {
  const { dir } = repo();
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  assert.equal(headBranch(path.join(dir, 'src', 'deep')), 'main');
});

test('works in a linked worktree (.git is a file)', () => {
  const { dir, g } = repo();
  const wt = path.join(os.tmpdir(), `forge-wt-${process.pid}-${Date.now()}`);
  g('worktree', 'add', '-q', '-b', 'wt-branch', wt);
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile());
  assert.equal(headBranch(wt), 'wt-branch');
});

test('detached HEAD and non-repos give null', () => {
  const { dir, g } = repo();
  g('checkout', '-q', '--detach');
  assert.equal(headBranch(dir), null);
  assert.equal(headBranch(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-nogit-'))), null);
});
