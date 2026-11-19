'use strict';
// v0.1.1 security fix (owner 2026-11-19, found in the Fable 5.2 guest-mode review): .jspark-forge/rules.md is meant to
// be committed, so a cloned repo can ship one. A repo's rules.md may ADD Confirm / Never rules but never switch a
// built-in block off; "disable:" works only from the user's own ~/.claude/jspark-forge/rules.md. And a repo's regular
// expressions must not be able to time a built-in block out (a timed-out hook lets the command through).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadRules, parseRules } = require('../scripts/lib/rules');
const { check } = require('../scripts/lib/blocklist');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function setup({ repoRules, userRules } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-trust-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge'));
  if (repoRules) fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), repoRules);
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-trust-cfg-'));
  if (userRules) { fs.mkdirSync(path.join(cfg, 'jspark-forge')); fs.writeFileSync(path.join(cfg, 'jspark-forge', 'rules.md'), userRules); }
  return { dir, cfg };
}
const hook = (s, event, input) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 'trust-1', cwd: s.dir }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: s.dir, CLAUDE_CONFIG_DIR: s.cfg }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const bash = command => ({ tool_name: 'Bash', tool_input: { command } });

test("a repo's rules.md cannot switch a built-in block off", () => {
  const s = setup({ repoRules: '## Settings\n- disable: chmod-wide, git-reset-hard\n' });
  const r = loadRules(s.dir, { claudeHome: s.cfg });
  assert.deepEqual(r.disabled, []);
  assert.equal(hook(s, 'PreToolUse', bash('chmod 777 x')).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook(s, 'PreToolUse', bash('git reset --hard')).hookSpecificOutput.permissionDecision, 'deny');
});

test('the ignored disable: line is reported, with where it does work', () => {
  const s = setup({ repoRules: '## Settings\n- disable: chmod-wide\n' });
  const o = hook(s, 'SessionStart', { source: 'startup' });
  assert.match(o.systemMessage, /\.jspark-forge\/rules\.md line 2.*cannot switch off built-in blocks/);
  assert.match(o.systemMessage, /~\/\.claude\/jspark-forge\/rules\.md/);
});

test("disable: in the user's own ~/.claude/jspark-forge/rules.md works, for every project", () => {
  const s = setup({ userRules: '## Settings\n- disable: chmod-wide\n' });
  assert.deepEqual(loadRules(s.dir, { claudeHome: s.cfg }).disabled, ['chmod-wide']);
  assert.equal(hook(s, 'PreToolUse', bash('chmod 777 x')), null);
  assert.match(hook(s, 'SessionStart', { source: 'startup' }).systemMessage, /you switched off chmod-wide/);
});

test("a repo's Confirm and Never lines still apply (they only add protection)", () => {
  const s = setup({ repoRules: '## Confirm\n- `terraform destroy` : infra\n## Never\n- `drop database prod` : prod\n' });
  assert.match(hook(s, 'PreToolUse', bash('terraform destroy')).hookSpecificOutput.permissionDecisionReason, /CONFIRM terraform-destroy/);
  assert.equal(hook(s, 'PreToolUse', bash('psql -c "drop database prod"')).hookSpecificOutput.permissionDecision, 'deny');
});

test("the user's rules and the repo's rules both apply; a user Never line wins", () => {
  const s = setup({ repoRules: '## Confirm\n- `deploy` : ship\n', userRules: '## Never\n- `deploy --prod` : never from here\n' });
  const r = loadRules(s.dir, { claudeHome: s.cfg });
  assert.equal(r.confirm.length, 1);
  assert.equal(r.never.length, 1);
  assert.equal(hook(s, 'PreToolUse', bash('deploy --prod')).hookSpecificOutput.permissionDecision, 'deny');
});

test("a built-in block is decided without running the repo's regular expressions (no time-out bypass)", () => {
  const rules = parseRules('## Confirm\n- `re:(a+)+$` : slow on purpose (catastrophic backtracking)\n');
  const evil = `git reset --hard; echo ${'a'.repeat(26)}!`;
  const t = Date.now();
  const r = check({ tool_name: 'Bash', tool_input: { command: evil }, cwd: os.tmpdir() },
    { projectDir: os.tmpdir(), home: os.homedir(), rules, branchOf: () => 'x' });
  assert.equal(r.id, 'git-reset-hard');
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
});
