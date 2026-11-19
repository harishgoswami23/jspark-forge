'use strict';
// Design 13 "Integration": a scripted session drives every hook event; the log shows one line kind per hook.
const test = require('node:test');
const assert = require('node:assert/strict');
const { project, claude, kinds, logText } = require('./lib');

test('every hook fires in a real Claude Code session', { timeout: 600000 }, () => {
  const dir = project('hookfire');
  const r = claude(dir, [
    'Do these in order with the tools named, then reply "done":',
    '1) Bash: echo hello',
    '2) Write: create notes.txt containing x',
    '3) Bash: cat does-not-exist.txt   (it fails; that is expected)',
    '4) Bash: git stash clear   (it will be blocked; that is expected; do not try anything else for it)',
    '5) Agent tool, subagent_type "general-purpose": ask it to run the bash command echo helper and report the output.',
  ].join('\n'), ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Write', 'Agent']);
  assert.equal(r.status, 0, r.err);
  const c = claude(dir, '/compact', ['--continue']);
  const k = kinds(dir);
  const want = { SessionStart: 'GROUNDING', UserPromptSubmit: 'USER', PostToolUse: 'BASH', 'PostToolUse (write)': 'WRITE',
    PostToolUseFailure: 'FAIL', PreToolUse: 'BLOCK', SubagentStart: 'AGENT+', SubagentStop: 'AGENT-', Stop: 'STOP',
    SessionEnd: 'END', 'save trigger': 'SAVE', PreCompact: 'COMPACT' };
  const missing = Object.entries(want).filter(([, kind]) => !k.has(kind)).map(([hook, kind]) => `${hook} (${kind})`);
  assert.deepEqual(missing, [], `missing: ${missing.join(', ')}\ncompact exit ${c.status}\n--- log ---\n${logText(dir)}`);
  assert.ok(!k.has('FORGE-ERROR'), logText(dir));
});
