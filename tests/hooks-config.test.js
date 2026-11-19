'use strict';
// Design section 3 "Matchers and timeouts" and section 13 "Hook config".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const only = ev => { assert.equal(hooks[ev].length, 1, `${ev}: one entry`); return hooks[ev][0]; };
const matches = (matcher, tool) => new RegExp(`^(?:${matcher})$`).test(tool);

test('every design hook event is registered, in exec form with node and forge.js', () => {
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop',
    'PreCompact', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
  assert.deepEqual(Object.keys(hooks).sort(), [...events].sort());
  for (const ev of events) {
    const h = only(ev).hooks[0];
    assert.equal(h.type, 'command');
    assert.equal(h.command, 'node');
    assert.equal(h.args[0], '${CLAUDE_PLUGIN_ROOT}/scripts/forge.js');
    assert.ok(h.args[1], `${ev}: event argument`);
    assert.ok(Number.isInteger(h.timeout), `${ev}: own timeout`);
  }
});

test('PostToolUse matcher covers the writing/state tools and excludes Read, Grep, Glob', () => {
  const m = only('PostToolUse').matcher;
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'Agent', 'mcp__db__query']) {
    assert.ok(matches(m, t), `should match ${t}`);
  }
  for (const t of ['Read', 'Grep', 'Glob']) assert.ok(!matches(m, t), `must not match ${t}`);
});

test('PreToolUse timeout is 3 s and SessionEnd 1 s', () => {
  assert.equal(only('PreToolUse').hooks[0].timeout, 3);
  assert.equal(only('SessionEnd').hooks[0].timeout, 1);
});

test('SessionStart matcher covers startup, resume, clear and compact', () => {
  const m = only('SessionStart').matcher;
  for (const s of ['startup', 'resume', 'clear', 'compact']) assert.ok(matches(m, s));
});

test('plugin.json names the plugin jspark-forge, MIT, no reserved words', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(p.name, 'jspark-forge');
  assert.equal(p.license, 'MIT');
  assert.ok(!/claude|anthropic/i.test(p.name));
});
