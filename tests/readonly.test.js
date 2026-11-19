'use strict';
// v0.1.1 read-only sources (spec 5.2b): an old system you migrate from, listed in rules.md "## Sources" as
// "- readonly: <path> : <why>", can be read but never changed: any write, move or copy into it, delete, sed -i, or a
// git command that changes it is a hard deny (no CONFIRM). Acceptance: >= 5 positive / >= 5 negative, Bash and PowerShell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { check } = require('../scripts/lib/blocklist');
const { parseRules } = require('../scripts/lib/rules');

const WIN = process.platform === 'win32';
const PROJECT = WIN ? 'C:\\work\\proj' : '/work/proj';
const HOME = WIN ? 'C:\\Users\\dev' : '/home/dev';
const rules = parseRules('## Sources\n- readonly: ../legacy-app : migrating from, never edit\n- readonly: vendor/old\n');
const ctx = () => ({ projectDir: PROJECT, home: HOME, rules, branchOf: () => 'feature/x' });
const run = (tool, input) => { const r = check(Object.assign({ tool_name: tool, cwd: PROJECT }, input), ctx()); return r ? (r.hard ? `${r.id}!` : r.id) : null; };
const bash = c => run('Bash', { tool_input: { command: c } });
const ps = c => run('PowerShell', { tool_input: { command: c } });
const edit = (f, tool = 'Edit') => run(tool, { tool_input: { file_path: path.resolve(PROJECT, f) } });
const RO = 'readonly-source!';

test('rules.md "## Sources": readonly lines with an optional reason; a bad line is reported', () => {
  assert.deepEqual(rules.readonly.map(r => [r.path, r.reason]), [['../legacy-app', 'migrating from, never edit'], ['vendor/old', '']]);
  const bad = parseRules('## Sources\n- something else\n');
  assert.equal(bad.errors.length, 1);
});

const BASH_POS = ['echo x > ../legacy-app/a.txt', 'rm -rf ../legacy-app/old', 'mv notes.txt ../legacy-app/', 'cp a.txt ../legacy-app/b.txt',
  "sed -i 's/a/b/' ../legacy-app/f.c", 'git -C ../legacy-app commit -am x', 'printf x | tee ../legacy-app/t.txt', 'rm vendor/old/x.js',
  'touch ../legacy-app/new.txt', 'git -C ../legacy-app checkout -- .'];
const BASH_NEG = ['cat ../legacy-app/a.txt', 'grep -r foo ../legacy-app', 'git -C ../legacy-app log --oneline', 'cp ../legacy-app/a.txt .',
  'ls ../legacy-app', 'diff ../legacy-app/a.c src/a.ts', 'echo x > src/new.ts'];
for (const c of BASH_POS) test(`Bash refuses: ${c}`, () => assert.equal(bash(c), RO));
for (const c of BASH_NEG) test(`Bash allows: ${c}`, () => assert.notEqual(bash(c), RO));

const PS_POS = ["Set-Content ../legacy-app/a.txt 'x'", 'Remove-Item ../legacy-app/x -Recurse', 'Move-Item a.txt ../legacy-app/',
  'Copy-Item a.txt ../legacy-app/a.txt', 'New-Item ../legacy-app/n.txt', "'x' | Out-File -FilePath vendor/old/o.txt"];
const PS_NEG = ['Get-Content ../legacy-app/a.txt', 'Select-String foo ../legacy-app/a.c', 'Copy-Item ../legacy-app/a.txt ./copy.txt',
  'Get-ChildItem ../legacy-app', "Set-Content src/new.ts 'x'"];
for (const c of PS_POS) test(`PowerShell refuses: ${c}`, () => assert.equal(ps(c), RO));
for (const c of PS_NEG) test(`PowerShell allows: ${c}`, () => assert.notEqual(ps(c), RO));

test('Edit, Write and NotebookEdit inside a read-only source are refused; elsewhere allowed', () => {
  assert.equal(edit('../legacy-app/a.c'), RO);
  assert.equal(edit('vendor/old/x.js', 'Write'), RO);
  assert.equal(run('NotebookEdit', { tool_input: { notebook_path: path.resolve(PROJECT, '../legacy-app/n.ipynb') } }), RO);
  assert.equal(edit('src/a.ts'), null);
  assert.equal(edit('vendor/new/x.js'), null);
});

test('the reason names the source, says why, and how to allow edits; no CONFIRM offer', () => {
  const r = check({ tool_name: 'Edit', tool_input: { file_path: path.resolve(PROJECT, '../legacy-app/a.c') }, cwd: PROJECT }, ctx());
  assert.match(r.reason, /\.\.\/legacy-app/);
  assert.match(r.reason, /There is no good reason to edit the source during a migration/);
  assert.match(r.reason, /remove its "readonly:" line from rules\.md/);
  assert.ok(!/CONFIRM/.test(r.reason));
});

test('a read-only source inside the project wins over rm-rf-outside (which would allow an inside folder)', () => {
  assert.equal(bash('rm -rf vendor/old'), RO);
});

// ---- through the hooks ----
const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project(sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ro-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), `## Sources\n${sources}`);
  require('../scripts/lib/paths').markOwn(dir); // the marker inside .git that setup writes (review H1)
  return dir;
}
const hook = (dir, event, input = {}) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }),
    input: JSON.stringify(Object.assign({ session_id: 'ro-1', cwd: dir, source: 'startup' }, input)) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};

test('a typed CONFIRM does not unlock a read-only source', () => {
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-legacy-'));
  const dir = project(`- readonly: ${legacy.split(String.fromCharCode(92)).join('/')} : old app\n`);
  hook(dir, 'UserPromptSubmit', { prompt: 'CONFIRM readonly-source' });
  const o = hook(dir, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(legacy, 'x.txt') } });
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
});

test('a missing read-only path is reported at session start; the rule is kept', () => {
  const dir = project('- readonly: ../does-not-exist-anywhere : gone\n');
  assert.match(hook(dir, 'SessionStart').systemMessage, /read-only source \.\.\/does-not-exist-anywhere was not found \(the rule is kept\)/);
});

test('the handoff names each read-only source and its commit', () => {
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-legacy-'));
  const g = (...a) => execFileSync('git', a, { cwd: legacy, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(legacy, 'a.c'), 'x');
  g('add', '-A'); g('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'old');
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: legacy, encoding: 'utf8' }).trim();
  const dir = project(`- readonly: ${legacy.split(String.fromCharCode(92)).join('/')} : old app\n`);
  hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'new.ts') } });
  const h = fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
  assert.match(h, new RegExp(`^Source: .*forge-legacy-[^ ]* @ ${sha} \\(read-only\\)$`, 'm'));
});
