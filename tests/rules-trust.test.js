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
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
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

test("a slow repo regular expression cannot time out a built-in block (it runs under a time limit)", () => {
  const rules = parseRules('## Confirm\n- `re:(a+)+$` : slow on purpose (catastrophic backtracking)\n');
  rules.confirm = rules.confirm.map(r => Object.assign({}, r, { fromRepo: true })); // a project (repo) rule, as loadRules tags it
  const evil = `git reset --hard; echo ${'a'.repeat(26)}!`;
  const t = Date.now();
  const r = check({ tool_name: 'Bash', tool_input: { command: evil }, cwd: os.tmpdir() },
    { projectDir: os.tmpdir(), home: os.homedir(), rules, branchOf: () => 'x' });
  assert.equal(r.id, 'git-reset-hard');
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
});

// H3 (review): the user's own regular expressions always run, even when a built-in matched.
test("H3: a user's own regex Never rule still wins when a built-in also matches", () => {
  const s = setup({ userRules: '## Never\n- `re:deploy-?prod` : never from a laptop\n' });
  const o = hook(s, 'PreToolUse', bash('git reset --hard && ./deploy-prod.sh'));
  assert.equal(o.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /never from a laptop/);
  assert.ok(!/CONFIRM/.test(o.hookSpecificOutput.permissionDecisionReason), 'a hard Never, not a confirm');
});

// Fable verification N4 (2026-11-20): a project's regex rules always run, on the whole command, under a time limit.
const decision = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision) || null;
test('N4: a project regex Never rule still denies after a CONFIRM for a built-in in the same command', () => {
  const s = setup({ repoRules: '## Never\n- `re:deploy-prod` : never ship from here\n' });
  hook(s, 'UserPromptSubmit', { prompt: 'CONFIRM git-reset-hard' });
  assert.equal(decision(hook(s, 'PreToolUse', bash('git reset --hard && deploy-prod'))), 'deny');
});

test('N4: a project regex rule runs even when a disabled built-in also matched', () => {
  const s = setup({ repoRules: '## Never\n- `re:deploy-prod` : never ship from here\n', userRules: '## Settings\n- disable: secret-files\n' });
  assert.equal(decision(hook(s, 'PreToolUse', bash('echo x > .env && deploy-prod'))), 'deny');
});

test('N4: a project regex rule sees the end of a long command', () => {
  const s = setup({ repoRules: '## Never\n- `re:deploy-prod` : never ship from here\n' });
  assert.equal(decision(hook(s, 'PreToolUse', bash(`echo ${'a'.repeat(2100)} && deploy-prod`))), 'deny');
});

test('N4: a slow project regex is stopped in time and counts as a match to confirm, never a silent pass', () => {
  const rules = parseRules('## Never\n- `re:(a+)+$` : slow on purpose\n');
  rules.never = rules.never.map(r => Object.assign({}, r, { fromRepo: true }));
  const t = Date.now();
  const r = check({ tool_name: 'Bash', tool_input: { command: `echo ${'a'.repeat(40)}!` }, cwd: os.tmpdir() },
    { projectDir: os.tmpdir(), home: os.homedir(), rules, branchOf: () => 'x' });
  assert.ok(Date.now() - t < 1000, `${Date.now() - t} ms`);
  assert.ok(r && !r.hard, 'held for a CONFIRM');
  assert.match(r.plain, /too long to check/);
});

// Fable verification N6: two different confirmable blocks in one command are allowed once both are confirmed.
test('N6: two different blocks in one command: the message names both; both CONFIRMs allow it once', () => {
  const s = setup();
  const cmd = bash('git reset --hard && git push --force origin main');
  const first = hook(s, 'PreToolUse', cmd);
  assert.equal(decision(first), 'deny');
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /CONFIRM git-reset-hard/);
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /CONFIRM git-force-push-main/);
  hook(s, 'UserPromptSubmit', { prompt: 'CONFIRM git-reset-hard' });
  assert.equal(decision(hook(s, 'PreToolUse', cmd)), 'deny', 'one of two is not enough');
  hook(s, 'UserPromptSubmit', { prompt: 'CONFIRM git-force-push-main' });
  assert.equal(decision(hook(s, 'PreToolUse', cmd)), 'ask', 'the first CONFIRM was kept, not spent');
  assert.equal(decision(hook(s, 'PreToolUse', cmd)), 'deny', 'once only');
});

// M4 (review): a repo's slow regex must not hide the user's own rules when no built-in matches.
test("M4: a repo's slow regex cannot time out the user's own rule", () => {
  const s = setup({ repoRules: '## Never\n- `re:(a+)+$` : slow on purpose\n', userRules: '## Confirm\n- `terraform destroy` : infra\n' });
  const t = Date.now();
  const o = hook(s, 'PreToolUse', bash(`terraform destroy ${'a'.repeat(28)}!`));
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /CONFIRM terraform-destroy/);
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms (the hook limit is 3 s)`);
});
