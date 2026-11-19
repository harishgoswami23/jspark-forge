'use strict';
// Design 9.3: .jspark-forge/rules.md, "Confirm" and "Never" lines (plain or re:), Settings incl. disable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRules, loadRules } = require('../scripts/lib/rules');
const { check } = require('../scripts/lib/blocklist');

const EXAMPLE = `# JSPARK Forge rules for this project
Lines under "Confirm" need a typed CONFIRM. Lines under "Never" are always refused.
Text in backticks is matched as written; start it with re: for a regular expression.

## Confirm
- \`terraform destroy\` : destroys cloud infrastructure
- \`re:kubectl\\s+delete\\s+(ns|namespace)\` : deletes a whole namespace

## Never
- \`drop database production\` : production database

## Settings
- notes: on
- statusline-segment: off
- disable: chmod-wide
`;

test('parses Confirm, Never and Settings from the design example', () => {
  const r = parseRules(EXAMPLE);
  assert.equal(r.errors.length, 0);
  assert.equal(r.confirm.length, 2);
  assert.equal(r.never.length, 1);
  assert.equal(r.confirm[0].id, 'terraform-destroy');
  assert.equal(r.confirm[0].reason, 'destroys cloud infrastructure');
  assert.equal(r.confirm[1].id, 're-1');
  assert.ok(r.confirm[1].re instanceof RegExp);
  assert.deepEqual(r.disabled, ['chmod-wide']);
  assert.equal(r.settings.notes, 'on');
  assert.equal(r.settings['statusline-segment'], 'off');
});

test('a malformed line is skipped and reported with its line number', () => {
  const r = parseRules('## Confirm\n- terraform destroy : no backticks\n- `re:([` : bad regex\n- `ok thing` : fine\n## Settings\n- colour: blue\n');
  assert.equal(r.confirm.length, 1);
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.errors.map(e => e.line), [2, 3, 6]);
});

test('defaults when the file is missing: notes on, segment on, nothing disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rules-'));
  const r = loadRules(dir);
  assert.equal(r.settings.notes, 'on');
  assert.equal(r.settings['statusline-segment'], 'on');
  assert.deepEqual(r.disabled, []);
});

test('loads .jspark-forge/rules.md and CRLF line endings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rules-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge'));
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), EXAMPLE.replace(/\n/g, '\r\n'));
  const r = loadRules(dir);
  assert.equal(r.confirm.length, 2);
  assert.equal(r.errors.length, 0);
});

const PROJECT = process.platform === 'win32' ? 'C:\\work\\proj' : '/work/proj';
const ctxWith = rules => ({ projectDir: PROJECT, home: os.homedir(), rules, branchOf: () => 'feature/x' });
const bash = command => ({ tool_name: 'Bash', tool_input: { command }, cwd: PROJECT });

test('a Confirm line asks for CONFIRM <id>; a Never line is a hard deny', () => {
  const rules = parseRules(EXAMPLE);
  const c = check(bash('terraform destroy -auto-approve'), ctxWith(rules));
  assert.equal(c.id, 'terraform-destroy');
  assert.equal(c.hard, false);
  assert.match(c.reason, /CONFIRM terraform-destroy/);
  assert.match(c.reason, /destroys cloud infrastructure/);
  const n = check(bash('psql -c "DROP DATABASE production"'), ctxWith(rules));
  assert.equal(n.hard, true);
  assert.match(n.reason, /Do not try an equivalent command; tell the user and stop\./);
});

test('regex rules match case-insensitively; plain rules match as written, case-insensitively', () => {
  const rules = parseRules(EXAMPLE);
  assert.equal(check(bash('KUBECTL  delete  namespace prod'), ctxWith(rules)).id, 're-1');
  assert.equal(check(bash('Terraform Destroy'), ctxWith(rules)).id, 'terraform-destroy');
  assert.equal(check(bash('terraform plan'), ctxWith(rules)), null);
});

test('user rules also apply to MCP tool inputs', () => {
  const rules = parseRules(EXAMPLE);
  const r = check({ tool_name: 'mcp__infra__run', tool_input: { cmd: 'terraform destroy' }, cwd: PROJECT }, ctxWith(rules));
  assert.equal(r.id, 'terraform-destroy');
});
