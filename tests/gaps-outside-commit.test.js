'use strict';
// v0.5.1 gaps, item 9 (spec 168): a commit made outside Claude is noticed at the next handoff save and logged once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oc-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n'); g('add', 'a.txt'); g('commit', '-qm', 'first');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return { dir, g };
}
const env = dir => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'oc-0001' });
const save = dir => spawnSync(process.execPath, [FORGE, 'save'], { cwd: dir, encoding: 'utf8', env: env(dir) });
const hook = (dir, event, input) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir),
  input: JSON.stringify(Object.assign({ session_id: 'oc-0001', cwd: dir, source: 'startup' }, input)) });
const logText = dir => {
  const f = path.join(dir, '.jspark-forge', 'log');
  return fs.readdirSync(f).filter(n => n.endsWith('.log')).map(n => fs.readFileSync(path.join(f, n), 'utf8')).join('\n');
};
const commits = dir => logText(dir).split('\n').filter(l => /\sCOMMIT\s/.test(l));
const task = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'task.json'), 'utf8'));

test('a commit made outside Claude: one COMMIT line "(made outside Claude)" and the task\'s last commit', () => {
  const { dir, g } = project();
  save(dir); // the session's last known HEAD
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); g('add', 'b.txt'); g('commit', '-qm', 'second by hand');
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  save(dir);
  const c = commits(dir);
  assert.equal(c.length, 1, c.join('\n'));
  assert.match(c[0], new RegExp(`COMMIT ${sha}[0-9a-f]* second by hand \\(made outside Claude\\)$`));
  assert.equal(task(dir).lastCommit.subject, 'second by hand');
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8'), /last commit [0-9a-f]+ "second by hand"/);
  save(dir);
  assert.equal(commits(dir).length, 1, 'logged once');
});

test('a commit Claude made (seen by the hook) is not logged again as outside', () => {
  const { dir, g } = project();
  save(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); g('add', 'b.txt'); g('commit', '-qm', 'by claude');
  hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "by claude"' }, tool_response: { stdout: 'ok' } });
  save(dir);
  const c = commits(dir);
  assert.equal(c.length, 1, c.join('\n'));
  assert.doesNotMatch(c[0], /outside Claude/);
});

test('no commit, a branch switch, or a first save: nothing is logged', () => {
  const { dir, g } = project();
  save(dir);
  save(dir);
  g('checkout', '-qb', 'other');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n'); g('add', 'c.txt'); g('commit', '-qm', 'on other');
  save(dir); // on another branch: HEAD moved forward, but that is a branch switch, not a commit on the session's branch
  g('checkout', '-q', 'main');
  save(dir);
  assert.equal(commits(dir).length, 0, commits(dir).join('\n'));
});
