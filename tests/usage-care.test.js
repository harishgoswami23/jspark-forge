'use strict';
// v0.6 token care, part 2 (owner 2026-11-21, plan A): helper habits. Helpers were the second-largest cost measured
// (15 builders, 790 steps, about 132k tokens re-read per step). Every helper is told how to keep its conversation
// small; the main session is told to give helpers small jobs; the builder runs the whole suite once, at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const SID = 'abababab-0000-0000-0000-000000000000';

function project(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-care-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  if (rules) fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), rules);
  return dir;
}
function hook(dir, event, input) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-care-home-'));
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home }),
    input: JSON.stringify(Object.assign({ session_id: SID, cwd: dir, hook_event_name: event }, input)) });
  const o = r.stdout ? JSON.parse(r.stdout) : null;
  return o && o.hookSpecificOutput ? o.hookSpecificOutput.additionalContext || '' : '';
}
const HELPER = /JSPARK Forge usage care[^\n]*\n1\. [^\n]*only the tests[^\n]*whole suite once[^\n]*\n2\. [^\n]*totals and the failing lines[^\n]*\n3\. [^\n]*part of a file[^\n]*\n4\. [^\n]*short/;

test('every helper is told the four usage-care habits when it starts', () => {
  const dir = project();
  for (const type of ['jspark-forge:builder', 'jspark-forge:checker', 'general-purpose']) {
    assert.match(hook(dir, 'SubagentStart', { agent_id: `a-${type}`, agent_type: type }), HELPER, type);
  }
});

test('the helper text is short: under 600 characters (it is re-read on every step of the helper)', () => {
  const t = require('../scripts/lib/handoff').usageCare();
  assert.ok(t.length < 600, String(t.length));
});

test('the main session is told to give helpers small jobs and to keep long output out of the conversation', () => {
  const ctx = hook(project(), 'SessionStart', { source: 'startup' });
  assert.match(ctx, /JSPARK Forge usage care: [^\n]*one task[^\n]*checker[^\n]*totals/);
  assert.ok((ctx.match(/JSPARK Forge usage care/g) || []).length === 1);
});

test('"- usage-care: off" switches both texts off', () => {
  const dir = project('## Settings\n- usage-care: off\n');
  assert.doesNotMatch(hook(dir, 'SubagentStart', { agent_id: 'a1', agent_type: 'jspark-forge:builder' }), /usage care/);
  assert.doesNotMatch(hook(dir, 'SessionStart', { source: 'startup' }), /usage care/);
});

test('the builder file: changed-area tests while working, the whole suite once before the end, totals only', () => {
  const t = fs.readFileSync(path.join(ROOT, 'agents', 'builder.md'), 'utf8');
  assert.doesNotMatch(t, /passes\. Run the whole suite\./);
  assert.match(t, /tests of what you changed/);
  assert.match(t, /whole suite once/);
  assert.match(t, /totals/);
});

test('the checker file says it is the one to run long suites, and reports totals and failures only', () => {
  const t = fs.readFileSync(path.join(ROOT, 'agents', 'checker.md'), 'utf8');
  assert.match(t, /totals and the failing/);
});

test('the template and the README name the switch', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'templates', 'rules.md'), 'utf8'), /^Example: - usage-care: off$/m);
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /usage-care: off/);
});
