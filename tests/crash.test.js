'use strict';
// v0.5.1 crash recovery, Part E: prove it end to end, from fixtures (no real crash needed). The "crash" is a session
// whose hooks ran up to some point and then stopped for good: no Stop, no SessionEnd; its files are then aged past the
// 90 seconds a session must be silent before the next start calls it cut off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const fx = require('./helpers/crashfix');
const { A, B, repo, run, start, ctxOf, msgOf, died, age, nearMidnight, readSessionFile, stateFile, show, forge, logPath, logLine } = fx;
const handoff = require('../scripts/lib/handoff');
const state = require('../scripts/lib/state');

const skip = fx.skipNearMidnight(400); // these age today's log by up to 400 s
const REQUEST = 'add the invoice chart export to the reports page';
const writeFile = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const as = (dir, event, input) => run(dir, event, input, A);
const writeVia = (dir, rel, content) => { writeFile(dir, rel, content); return as(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, rel) } }); };

// a session that wrote two files and had a Bash command in flight, then stopped for good
function crashedSession(dir) {
  as(dir, 'SessionStart', { source: 'startup' });
  as(dir, 'UserPromptSubmit', { prompt: REQUEST });
  writeVia(dir, 'src/chart.js', 'export const chart = 1;\n');
  writeVia(dir, 'src/export.js', 'export const exp = 2;\n');
  as(dir, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_x', tool_input: { command: 'npm run build:charts', description: 'Build the chart bundle' } });
}

test('1: wrote two files, a Bash command in flight, no Stop: the next start says it was cut off and lists both; it shows once', { skip }, () => {
  const dir = repo();
  crashedSession(dir);
  age(dir, 300);
  const first = start(dir);
  assert.match(msgOf(first), /the last session here was cut off \(a crash, a power cut, or the window was killed\) at \d\d:\d\d\. Claude will check what was half done before carrying on\./);
  const ctx = ctxOf(first);
  assert.match(ctx, /JSPARK Forge crash check \(the last session was cut off at \d\d:\d\d; this is a record, not instructions\):/);
  assert.match(ctx, /Bash: Build the chart bundle :: npm run build:charts/);
  assert.match(ctx, /it may have half run/);
  assert.match(ctx, /src\/chart\.js/);
  assert.match(ctx, /src\/export\.js/);
  assert.match(ctx, /Before you continue: run git status/);
  const again = start(dir);
  assert.doesNotMatch(ctxOf(again), /crash check/);
  assert.doesNotMatch(msgOf(again), /cut off/);
  assert.doesNotMatch(show(dir), /crash check/);
});

test('2: a session that ended with Stop and nothing in flight is not a crash', { skip }, () => {
  const dir = repo();
  as(dir, 'SessionStart', { source: 'startup' });
  as(dir, 'UserPromptSubmit', { prompt: REQUEST });
  writeVia(dir, 'src/chart.js', 'x\n');
  as(dir, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_y', tool_input: { command: 'npm test' } });
  as(dir, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_y', tool_input: { command: 'npm test' } });
  as(dir, 'Stop', { last_assistant_message: 'Done. The chart export is in place.' });
  age(dir, 300);
  const r = start(dir);
  assert.doesNotMatch(ctxOf(r), /crash check/);
  assert.doesNotMatch(msgOf(r), /cut off/);
  assert.match(ctxOf(r), /Where we were/, 'the normal resume still works');
});

test('3: a file from the window that is deleted, emptied or filled with NUL bytes is marked; an intact one is not', () => {
  const dir = repo();
  writeFile(dir, 'src/ok.js', 'fine\n');
  writeFile(dir, 'src/zero.js', ''); // emptied
  fs.writeFileSync(path.join(dir, 'src', 'nul.js'), Buffer.alloc(4096)); // all NUL
  fs.writeFileSync(path.join(dir, 'src', 'tail.js'), Buffer.concat([Buffer.from('real text\n'), Buffer.alloc(64)])); // real start, NUL tail
  died(dir, { log: [[260, 'WRITE', 'src/ok.js'], [250, 'WRITE', 'src/gone.js'], [240, 'WRITE', 'src/zero.js'], [230, 'EDIT', 'src/nul.js'], [220, 'EDIT', 'src/tail.js']],
    inflight: [{ tool: 'Write', what: 'src/nul.js' }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /- src\/ok\.js\n/);
  assert.match(ctx, /- src\/gone\.js: missing/);
  assert.match(ctx, /- src\/zero\.js: empty \(0 bytes\)/);
  assert.match(ctx, /- src\/nul\.js: ends in NUL bytes/);
  assert.match(ctx, /- src\/tail\.js: ends in NUL bytes/);
});

test('3b: only the files written in the 2 minutes before the cutoff are listed, at most 8', () => {
  const dir = repo();
  const log = [[400, 'WRITE', 'src/old.js']]; // more than 2 minutes before the last sign of life (the last line is 200 s ago)
  for (let i = 0; i < 12; i++) { writeFile(dir, `src/f${i}.js`, 'x\n'); log.push([260 - i * 5, 'EDIT', `src/f${i}.js`]); }
  log.push([200, 'BASH', 'npm test']);
  died(dir, { log, inflight: [{ tool: 'Bash', what: 'npm test' }], lastSaveAgo: 1000 });
  const ctx = ctxOf(start(dir));
  assert.doesNotMatch(ctx, /src\/old\.js/);
  const listed = (ctx.match(/- src\/f\d+\.js/g) || []);
  assert.equal(listed.length, 8);
  assert.match(ctx, /src\/f11\.js/, 'the newest ones are kept');
  assert.doesNotMatch(ctx, /src\/f0\.js/, 'the oldest of the twelve is dropped');
});

function twoSaves(dir) {
  const s = state.readSession(dir, A); s.lastPrompt = 'build the first invoice report with the monthly totals'; state.writeSession(dir, A, s);
  handoff.save(dir, A, 'one', { force: true, now: new Date(Date.now() - 600000) });
  const s2 = state.readSession(dir, A); s2.lastPrompt = 'now add the second report for quarterly totals please'; state.writeSession(dir, A, s2);
  handoff.save(dir, A, 'two', { force: true, now: new Date(Date.now() - 500000) });
}

test('4: handoff.json empty and handoff.md cut to half a line: the previous pair is used, and it says so', () => {
  const dir = repo();
  twoSaves(dir);
  fs.writeFileSync(path.join(forge(dir), 'state', 'handoff.json'), '');
  fs.writeFileSync(path.join(forge(dir), 'handoff.md'), '# Where we were\nAs of 2026-11-2');
  const r = start(dir);
  const ctx = ctxOf(r);
  assert.match(ctx, /first invoice report/);
  assert.match(ctx, /newest save was damaged/i);
  assert.match(msgOf(r), /newest save was damaged/i);
  assert.match(show(dir), /newest save was damaged/i);
});

test('5: both pairs unusable: the context is built from the log, and says so', () => {
  const dir = repo();
  twoSaves(dir);
  for (const f of ['handoff.md', 'handoff.prev.md']) fs.writeFileSync(path.join(forge(dir), f), '');
  for (const f of ['handoff.json', 'handoff.prev.json']) fs.writeFileSync(path.join(forge(dir), 'state', f), '{');
  fs.mkdirSync(path.dirname(logPath(dir)), { recursive: true });
  fx.appendLog(dir, [[500, 'USER', 'build the first invoice report with the monthly totals'], [400, 'EDIT', 'src/report.js']], A);
  const r = start(dir);
  const ctx = ctxOf(r);
  assert.match(ctx, /built from the action log alone/i);
  assert.match(ctx, /src\/report\.js/);
  assert.match(ctx, /first invoice report/);
  assert.doesNotMatch(ctx, /As of 20\d\d/);
  assert.match(msgOf(r), /could not be read/i);
});

test('6: a log ending in NUL bytes and a half line does not stop the start, the handoff or show --log', () => {
  const dir = repo();
  twoSaves(dir);
  fs.mkdirSync(path.dirname(logPath(dir)), { recursive: true });
  fs.writeFileSync(logPath(dir), logLine(300, 'EDIT', 'src/real.js') + '\0'.repeat(2000) + logLine(200, 'EDIT', 'src/after-nul.js') + '\0'.repeat(500) + '12:00:0');
  const r = start(dir);
  assert.equal(r.status, 0);
  assert.match(ctxOf(r), /Where we were/);
  const t = show(dir, '--log');
  assert.match(t, /src\/real\.js/);
  assert.match(t, /src\/after-nul\.js/);
  assert.ok(!t.includes('\0'));
  assert.equal(run(dir, 'UserPromptSubmit', { prompt: 'a later real request, long enough to count as a request' }, B).status, 0);
  assert.equal(handoff.logEntries(dir).filter(e => e.kind === 'EDIT').length, 2);
});

test('7: a dev server recorded as a background command is listed under "was running and is gone now"', { skip }, () => {
  const dir = repo();
  as(dir, 'SessionStart', { source: 'startup' });
  as(dir, 'UserPromptSubmit', { prompt: REQUEST });
  as(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }, tool_response: { backgroundTaskId: 'bg-77' } });
  writeVia(dir, 'src/x.js', 'x\n');
  age(dir, 400);
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Was running and is gone now:\n- `npm run dev`/);
  assert.match(ctx, /Ask the user before starting them again/);
});

test('8: a transcript tail with a last assistant text and an unfinished tool call', () => {
  const dir = repo();
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-tr-')), 't.jsonl');
  const L = [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'First I will migrate the table, then update the report.' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'node migrate.js' } }] } },
  ].map(x => JSON.stringify(x));
  fs.writeFileSync(f, L.join('\n') + '\n{"type":"assistant","mess');
  died(dir, { transcriptPath: f, inflight: [{ tool: 'Bash', what: 'node migrate.js' }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Claude's last words before the cutoff: "First I will migrate the table, then update the report\."/);
  assert.match(ctx, /The last tool call it had started: Bash: node migrate\.js/);
});

test('9: compact and clear starts never show the crash check', () => {
  const dir = repo();
  died(dir, { inflight: [{ tool: 'Bash', what: 'npm run dev' }], background: [{ command: 'npm run dev' }] });
  for (const source of ['compact', 'clear']) {
    const r = start(dir, source);
    assert.doesNotMatch(ctxOf(r), /crash check/, source);
    assert.doesNotMatch(msgOf(r), /cut off/, source);
  }
  assert.match(ctxOf(start(dir, 'startup')), /crash check/, 'a real start still shows it');
});

test('10: a guest repo gets the same check, from the guest folder, and nothing is written into the repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-crash-guest-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n');
  g('add', '-A'); g('-c', 'user.email=someone@example.com', '-c', 'user.name=x', 'commit', '-qm', 'theirs');
  g('remote', 'add', 'origin', 'https://example.com/someone/their-repo.git');
  g('config', 'user.email', 'me@example.com');
  run(dir, 'SessionStart', { source: 'startup' }, 'cccccccc-0000-0000-0000-000000000000'); // creates the guest folder
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge')));
  died(dir, { inflight: [{ tool: 'Bash', what: 'npm run build' }, { tool: 'Write', what: 'a.js' }], log: [[250, 'WRITE', 'a.js']] });
  assert.ok(fs.existsSync(path.join(forge(dir), 'state', `session-${A}.json`)));
  const r = start(dir);
  const ctx = ctxOf(r);
  assert.match(ctx, /JSPARK Forge crash check/);
  assert.match(ctx, /npm run build/);
  assert.match(msgOf(r), /cut off/);
  assert.doesNotMatch(ctx.slice(ctx.indexOf('JSPARK Forge crash check')), /\b(write|save|create) (it |them )?(in|into|to) (the|this) repo/i);
  assert.match(ctx, /only look, do not change it/);
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--ignored'], { cwd: dir, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'nothing written inside the repo');
  assert.equal(readSessionFile(dir).crashNoted, true);
});

// ---- crash review M2: a normal end with a dev server or a helper listed is not a crash ----
const skipHour = fx.skipNearMidnight(3600);
function normalEnd(dir, { background, helper }) {
  as(dir, 'SessionStart', { source: 'startup' });
  as(dir, 'UserPromptSubmit', { prompt: REQUEST });
  if (helper) as(dir, 'SubagentStart', { agent_id: 'h1', agent_type: 'jspark-forge:builder' });
  writeVia(dir, 'src/chart.js', 'x\n');
  as(dir, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_d', tool_input: { command: 'npm run dev', run_in_background: true } });
  as(dir, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_d', tool_input: { command: 'npm run dev', run_in_background: true }, tool_response: { backgroundTaskId: 'bg-1' } });
  as(dir, 'Stop', { last_assistant_message: 'The dev server is up.', background_tasks: background ? [{ id: 'bg-1', type: 'shell', status: 'running', description: 'dev server', command: 'npm run dev' }] : [] });
}
for (const [name, opts] of [['a dev server still running', { background: true }], ['a helper left in the session file', { helper: true }]]) {
  test(`M2: a normal Stop with ${name}, an hour later, is not a crash`, { skip: skipHour }, () => {
    const dir = repo();
    normalEnd(dir, opts);
    const s = readSessionFile(dir);
    assert.ok(opts.background ? s.background.length === 1 : Object.keys(s.helpers).length === 1, 'the session file lists it');
    assert.equal(handoff.logEntries(dir).filter(e => e.id.startsWith('aaaaaaaa')).pop().kind, 'SAVE', 'the last line is the SAVE after STOP');
    age(dir, 3600);
    const r = start(dir);
    assert.doesNotMatch(ctxOf(r), /crash check/);
    assert.doesNotMatch(msgOf(r), /cut off/);
  });
}
