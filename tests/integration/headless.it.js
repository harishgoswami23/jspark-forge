'use strict';
// Design 13 / spec 7 v0.1 acceptance: "a claude -p run with a handoff present is never stalled", and the reply
// mentions the parked task in one line (design 8, show-and-wait instruction, last sentence).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PLUGIN, project, claude } = require('./lib');

test('a claude -p run with an open handoff does its own task and names the parked one', { timeout: 600000 }, () => {
  const dir = project('headless', { files: { 'docs/plan.md': '# Billing export\n- [x] add the CSV model\n- [ ] write the export route\n- [ ] add the button\n' } });
  // An open handoff, made the way the hooks make it: a plan file written, then a reply finished.
  const hook = (ev, input) => spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'forge.js'), ev], {
    input: JSON.stringify(Object.assign({ session_id: 'old-session-0001', cwd: dir }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'docs', 'plan.md') } });
  hook('Stop', {});
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8'), /Billing export/);

  const r = claude(dir, 'Create hello.txt containing the single word hi. Then reply in one short paragraph.',
    ['--permission-mode', 'acceptEdits', '--allowedTools', 'Write']);
  assert.equal(r.status, 0, r.err);
  assert.ok(fs.existsSync(path.join(dir, 'hello.txt')), `not done (stalled?):\n${r.out}`);
  assert.equal(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8').trim(), 'hi');
  assert.match(r.out, /billing export/i, `parked task not mentioned:\n${r.out}`);
  assert.ok(!/continue\?\s*$/i.test(r.out.trim()), `asked to continue instead of doing the task:\n${r.out}`);
});
