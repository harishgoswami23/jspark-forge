'use strict';
// Fable verification pass (2026-11-20), N1, N2, N7: commands inside $( ), backticks and script blocks are checked,
// but text that is only data (single quotes, quoted heredoc bodies, PowerShell literal here-strings) is not; deep
// nesting cannot make the check slow. Expectation: 'id' = typed confirm, 'id!' = hard deny, null = allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../scripts/lib/blocklist');

const WIN = process.platform === 'win32';
const PROJECT = WIN ? 'C:\\work\\proj' : '/work/proj';
const HOME = WIN ? 'C:\\Users\\dev' : '/home/dev';
const ctx = o => ({ projectDir: PROJECT, home: HOME, rules: null, branchOf: () => 'feature/x', quarantine: !!o.quarantine });
const run = (tool, command, o = {}) => {
  const r = check({ tool_name: tool, tool_input: { command }, cwd: PROJECT }, ctx(o));
  return r ? (r.hard ? `${r.id}!` : r.id) : null;
};
const bash = (c, o) => run('Bash', c, o);
const ps = (c, o) => run('PowerShell', c, o);
const Q = { quarantine: true };

// Claude Code's standard commit form.
const commit = body => `git commit -m "$(cat <<'EOF'\n${body}\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"`;

test('N1: a commit message is data, not commands', () => {
  assert.equal(bash(commit('docs: rm -rf ~ is never allowed')), null);
  assert.equal(bash(commit('git reset --hard is now held')), null);
  assert.equal(bash(commit('make the build faster\nnpm install runs once')), null);
  assert.equal(bash(commit('make the build faster\nnpm install runs once'), Q), null);
  assert.equal(bash(commit("don't run rm -rf ~ (ever")), null);
  assert.equal(bash("git commit -m 'docs: mention `rm -rf ~`'"), null);
  assert.equal(bash("grep '$(npm install)' docs", Q), null);
  assert.equal(bash("cat > notes.txt <<'EOF'\nrm -rf ~\ngit reset --hard\nEOF"), null);
  assert.equal(bash('git commit -F - <<EOF\nmake things faster\nEOF', Q), null);
  assert.equal(bash("cat <<-'EOF'\n\trm -rf ~\n\tEOF"), null);
  assert.equal(bash('echo "\\$(npm install)"', Q), null);
});

test('N1: what follows a commit message is still checked', () => {
  assert.equal(bash(commit("don't (ever) do this") + ' && git reset --hard'), 'git-reset-hard');
  assert.equal(bash(commit('fine') + ' && rm -rf ~'), 'rm-rf-outside!');
  assert.equal(bash("cat > n.txt <<'EOF'\nnotes\nEOF\ngit reset --hard"), 'git-reset-hard');
});

test('commands inside substitutions are still held', () => {
  assert.equal(bash('echo $(npm install)', Q), 'guest-quarantine');
  assert.equal(bash('echo "$(npm install)"', Q), 'guest-quarantine');
  assert.equal(bash('echo "`make`"', Q), 'guest-quarantine');
  assert.equal(bash('echo $(rm -rf ~)'), 'rm-rf-outside!');
  assert.equal(bash('echo $(echo $(rm -rf ~))'), 'rm-rf-outside!');
  assert.equal(bash('cat <(rm -rf ~)'), 'rm-rf-outside!');
  assert.equal(bash('cat <<EOF\n$(npm install)\nEOF', Q), 'guest-quarantine');
});

test('N7: assignment-only commands run their substitutions', () => {
  assert.equal(bash('out=$(npm test)', Q), 'guest-quarantine');
  assert.equal(bash('X=$(rm -rf ~)'), 'rm-rf-outside!');
  assert.equal(bash('X=`git reset --hard`'), 'git-reset-hard');
  assert.equal(bash('X=$(git status)'), null);
});

test('N7: install/build commands inside shell keywords and wrappers are held in a guest repo', () => {
  for (const c of ['if [ -f package.json ]; then npm install; fi', 'for d in a b; do make; done', 'while true; do npm test; done',
    '! npm test', 'timeout 60 npm install', 'timeout -s KILL 5m make', 'eval npm install', 'eval "npm install"',
    'find . -name package.json -execdir npm install \\;', 'cat build.sh | bash', 'pwsh build.ps1', 'conda env create -f environment.yml',
    'docker image build .', 'until make; do sleep 1; done']) {
    assert.equal(bash(c, Q), 'guest-quarantine', c);
  }
  for (const c of ['if [ -f x ]; then cat x; fi', 'timeout 5 git status', 'find . -name "*.js"', 'conda env list', 'docker image ls',
    'eval "git status"', 'echo hi | cat']) {
    assert.equal(bash(c, Q), null, c);
  }
  assert.equal(bash('if true; then rm -rf ~; fi'), 'rm-rf-outside!', 'keywords never hide a built-in block');
  assert.equal(bash('find . -exec rm -rf ~ \\;'), 'rm-rf-outside!');
});

test('N7: PowerShell forms that run the repo are held', () => {
  for (const c of ['gc build.ps1 | iex', 'Get-Content x.ps1 -Raw | Invoke-Expression', 'Start-Process cmd -ArgumentList "/c npm install"',
    'Start-Process npm -ArgumentList install', 'pwsh ./build.ps1']) {
    assert.equal(ps(c, Q), 'guest-quarantine', c);
  }
  for (const c of ['gc package.json', 'Start-Process notepad', 'Get-ChildItem | Select-Object Name']) assert.equal(ps(c, Q), null, c);
});

test('N2: deep nesting is fast and cannot hide a block', () => {
  let t = Date.now();
  assert.equal(bash(`echo '${'$('.repeat(400)}' ; rm -rf ~`), 'rm-rf-outside!');
  assert.ok(Date.now() - t < 500, `quoted nesting took ${Date.now() - t} ms`);
  t = Date.now();
  const r = bash(`echo ${'$('.repeat(400)}rm -rf ~${')'.repeat(400)}`);
  assert.ok(r && r.endsWith('!'), `deep nesting gives a hard deny, got ${r}`);
  assert.ok(Date.now() - t < 500, `nesting took ${Date.now() - t} ms`);
  t = Date.now();
  assert.ok(bash(`echo ${'$(echo '.repeat(300)}x${')'.repeat(300)}`).endsWith('!'));
  assert.ok(bash(`echo ${'"$('.repeat(300)}`), 'unterminated nesting is denied too');
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  assert.equal(bash(`echo ${'$(echo '.repeat(4)}x${')'.repeat(4)}`), null);
});

test('through the PreToolUse hook: the standard commit passes, a hidden block still denies', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync, execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sub-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  const pre = command => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'forge.js'), 'PreToolUse'], {
      encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
      input: JSON.stringify({ session_id: 'sub-1', cwd: dir, tool_name: 'Bash', tool_input: { command } }) });
    const o = r.stdout ? JSON.parse(r.stdout) : null;
    return (o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision) || null; // a commit may get only the notes reminder
  };
  assert.equal(pre(commit('fix: rm -rf ~ and git reset --hard are now held')), null);
  assert.equal(pre(commit('fine') + ' && rm -rf ~'), 'deny');
  assert.equal(pre(`echo ${'$('.repeat(50)}x${')'.repeat(50)}`), 'deny');
});

test('PowerShell: literal text is data; script blocks and $( ) are commands', () => {
  assert.equal(ps("git commit -m @'\ndon't rm -rf ~ or git reset --hard\nnpm install\n'@", Q), null);
  assert.equal(ps("Write-Output '$(npm install)'", Q), null);
  assert.equal(ps('Write-Output "$(npm install)"', Q), 'guest-quarantine');
  assert.equal(ps('git commit -m @"\nfine $(npm install)\n"@', Q), 'guest-quarantine');
  assert.equal(ps('& { npm install }', Q), 'guest-quarantine');
  assert.equal(ps('if ($true) { npm install }', Q), 'guest-quarantine');
  assert.equal(ps('foreach ($x in 1..2) { npm test }', Q), 'guest-quarantine');
  assert.equal(ps('1..2 | % { npm test }', Q), 'guest-quarantine');
  assert.equal(ps('Get-ChildItem | Where-Object { $_.Length -gt 1 }', Q), null);
  assert.equal(ps("git commit -m @'\nok\n'@; git reset --hard"), 'git-reset-hard');
  const t = Date.now();
  assert.ok(ps(`Write-Output ${'$('.repeat(400)}x${')'.repeat(400)}`).endsWith('!'));
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
});
