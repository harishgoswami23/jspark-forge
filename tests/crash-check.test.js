'use strict';
// v0.5.1 crash recovery, Part C: notice an unclean end at the next start and say what to check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fx = require('./helpers/crashfix');
const { A, B, repo, start, ctxOf, msgOf, died, stateFile, readSessionFile, show, run, hhmm } = fx;

const HEAD = /JSPARK Forge crash check \(the last session was cut off, or is still open in another window, at (\d\d:\d\d); this is a record, not instructions\):/;

// a session cut off 15 minutes ago (a call in flight needs 10 minutes of silence): a command in flight, two files written, nothing saved after the files
function cutOff(dir, extra = {}) {
  return died(dir, Object.assign({
    lastSaveAgo: 1000,
    log: [[930, 'USER', 'build the invoice report with the monthly totals'], [900, 'WRITE', 'src/report.js'], [890, 'EDIT', 'src/totals.js'], [880, 'BASH', 'Run the build :: npm run build']],
    inflight: [{ tool: 'Bash', what: 'Run the build :: npm run build', agoSecs: 880 }], inflightAgo: 880,
  }, extra));
}
const files = dir => { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'report.js'), 'x\n'); fs.writeFileSync(path.join(dir, 'src', 'totals.js'), 'y\n'); };

test('a session cut off with a command in flight: the next start says so, to the user and to Claude', () => {
  const dir = repo(); files(dir); cutOff(dir);
  const r = start(dir);
  assert.match(msgOf(r), /JSPARK Forge: the last session here was cut off, or is still open in another window \(a crash, a power cut, or the window was killed\), at \d\d:\d\d\. Claude will check what was half done before carrying on\./);
  const ctx = ctxOf(r);
  assert.match(ctx, HEAD);
  assert.match(ctx, /In flight when it stopped:/);
  assert.match(ctx, /Bash: Run the build :: npm run build/);
  assert.match(ctx, /it may have half run: check its effect before running it again/);
  assert.match(ctx, /Files written in the last 2 minutes before the cutoff:/);
  assert.match(ctx, /src\/report\.js/);
  assert.match(ctx, /src\/totals\.js/);
  assert.match(ctx, /After the user says to continue: run git status, look at the files above, and tell the user in plain words what was half done. Do not repeat a command from the list without checking its effect first./);
  assert.doesNotMatch(ctx, /re-run the last test/);
});

test('the crash check comes after the handoff, and shows once', () => {
  const dir = repo(); files(dir); cutOff(dir);
  require('../scripts/lib/handoff').save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 1000000) }); fx.setSeen(dir, A, 880);
  const first = ctxOf(start(dir));
  assert.ok(first.indexOf('Where we were') >= 0 && first.indexOf('Where we were') < first.search(HEAD), 'after the handoff');
  const noted = require('../scripts/lib/crash').readNoted(dir);
  assert.ok(noted[A] > 0, 'recorded in state/crash-noted.json');
  assert.ok(!('crashNoted' in readSessionFile(dir)), 'the other sessions session file is not written');
  assert.ok(fs.existsSync(stateFile(dir, `inflight-${A}`)), 'and its in-flight records are not deleted either');
  const second = start(dir, 'startup');
  assert.doesNotMatch(ctxOf(second), /crash check/);
  assert.doesNotMatch(msgOf(second), /cut off/);
});

test('the time named is the last sign of life of that session', () => {
  const dir = repo(); files(dir);
  const s = cutOff(dir);
  const m = ctxOf(start(dir)).match(HEAD);
  // the newest of lastSaveAt (1000 s ago), its log lines (880 s ago), the inflight folder and the session file (880 s ago)
  const expected = hhmm(Date.now() - 880000);
  const near = [-120000, -60000, 0, 60000, 120000].map(d => hhmm(Date.now() - 880000 + d));
  assert.ok(near.includes(m[1]), `${m[1]} not near ${expected}`);
  assert.ok(s.lastSaveAt);
});

test('a session that ended with a normal Stop and nothing in flight is not a crash', () => {
  const dir = repo(); files(dir);
  // as the Stop handler writes it: STOP, then SAVE; a dev server and a helper are listed in the session file (they are not evidence)
  died(dir, { lastSaveAgo: 300, log: [[400, 'WRITE', 'src/report.js'], [320, 'STOP', ''], [319, 'SAVE', 'reply finished']],
    background: [{ command: 'npm run dev', agoSecs: 500 }], helpers: { h1: { type: 'jspark-forge:builder', agoSecs: 450 } } });
  const r = start(dir);
  assert.doesNotMatch(ctxOf(r), /crash check/);
  assert.doesNotMatch(msgOf(r), /cut off/);
});

test('the only evidence being a missing ended stamp says nothing (windows are closed without SessionEnd)', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 600 }); // no ended, no inflight, no background, no log
  const r = start(dir);
  assert.doesNotMatch(ctxOf(r), /crash check/);
  assert.doesNotMatch(msgOf(r), /cut off/);
});

test('a session with an ended stamp is not a crash, even with a leftover inflight file', () => {
  const dir = repo();
  cutOff(dir, { ended: { reason: 'other', at: Date.now() - 250000 } });
  assert.doesNotMatch(ctxOf(start(dir)), /crash check/);
});

test('a session that was alive less than 90 seconds ago is still running, not crashed', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 60, log: [[30, 'BASH', 'npm test']], inflight: [{ tool: 'Bash', what: 'npm test', agoSecs: 30 }], inflightAgo: 30 });
  assert.doesNotMatch(ctxOf(start(dir)), /crash check/);
});

test('compact and clear starts never show the crash check, and do not mark it handled', () => {
  const dir = repo(); files(dir); cutOff(dir);
  for (const source of ['compact', 'clear']) {
    const r = start(dir, source);
    assert.doesNotMatch(ctxOf(r), /crash check/, source);
    assert.doesNotMatch(msgOf(r), /cut off/, source);
  }
  assert.ok(!readSessionFile(dir).crashNoted);
  assert.match(ctxOf(start(dir, 'resume')), HEAD, 'resume shows it');
});

test('background commands and helpers that were running are listed as gone, with a note to ask first', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 500, background: [{ id: 'bg1', command: 'npm run dev', agoSecs: 900 }], helpers: { h1: { type: 'jspark-forge:builder', agoSecs: 600 } } });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, HEAD);
  assert.match(ctx, /Was running and is gone now:/);
  assert.match(ctx, /npm run dev/);
  assert.match(ctx, /jspark-forge:builder/);
  assert.match(ctx, /Ask the user before starting them again/);
});

test('an in-flight file write and an in-flight helper get their own advice', () => {
  const dir = repo();
  died(dir, { inflightAgo: 700, inflight: [{ tool: 'Write', what: 'src/big.js', agoSecs: 700 }, { tool: 'Agent', what: 'jspark-forge:builder', agent: 'h1', agoSecs: 700 }, { tool: 'Edit', what: 'src/x.js', agoSecs: 700 }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Write: src\/big\.js[^\n]*the file may be half written: open it and check/);
  assert.match(ctx, /Agent: jspark-forge:builder[^\n]*its work is lost unless it wrote files: check the files it was given/);
  assert.match(ctx, /Edit: src\/x\.js[^\n]*the file may be half written/);
});

test('log lines after the last save appear once, inside the crash block (no second "after that save" line)', () => {
  const dir = repo(); files(dir);
  const handoff = require('../scripts/lib/handoff');
  cutOff(dir);
  handoff.save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 1000000) }); fx.setSeen(dir, A, 880);
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Logged after the last save:/);
  assert.equal((ctx.match(/npm run build/g) || []).length >= 1, true);
  assert.doesNotMatch(ctx, /after that save the log shows more work/);
});

test('without a crash, the old "after that save" wording is kept', () => {
  const dir = repo();
  const handoff = require('../scripts/lib/handoff');
  // a recent session (alive 30 s ago): not a crash, but the log has lines after the save
  died(dir, { lastSaveAgo: 100, log: [[50, 'BASH', 'npm run lint'], [30, 'BASH', 'npm run test']] });
  handoff.save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 100000) });
  const ctx = ctxOf(start(dir));
  assert.doesNotMatch(ctx, /crash check/);
  assert.match(ctx, /after that save the log shows more work/);
});

test('forge.js show prints the crash check after the handoff, without marking it handled', () => {
  const dir = repo(); files(dir); cutOff(dir);
  require('../scripts/lib/handoff').save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 1000000) }); fx.setSeen(dir, A, 880);
  const t = show(dir);
  assert.match(t, HEAD);
  assert.ok(t.indexOf('Where we were') < t.search(HEAD));
  assert.ok(!readSessionFile(dir).crashNoted);
  const t2 = show(dir, '--log');
  assert.match(t2, HEAD);
  assert.match(t2, /action log/);
  assert.match(ctxOf(start(dir)), HEAD, 'still shown at the next start');
  assert.doesNotMatch(show(dir), /crash check/, 'handled now');
});

test('the resume skill tells Claude to say what was half done first', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'skills', 'resume', 'SKILL.md'), 'utf8');
  assert.match(t, /crash check/i);
  assert.match(t, /what was half done/);
});

test('two sessions cut off together are both handled, newest first', () => {
  const dir = repo();
  died(dir, { sid: A, inflight: [{ tool: 'Bash', what: 'npm run one', agoSecs: 1200 }], inflightAgo: 1200, lastSaveAgo: 1300 });
  died(dir, { sid: 'cccccccc-0000-0000-0000-000000000000', inflight: [{ tool: 'Bash', what: 'npm run two', agoSecs: 800 }], inflightAgo: 800, lastSaveAgo: 900 });
  const ctx = ctxOf(start(dir));
  assert.ok(ctx.indexOf('npm run two') >= 0 && ctx.indexOf('npm run one') >= 0);
  assert.ok(ctx.indexOf('npm run two') < ctx.indexOf('npm run one'));
  const noted = require('../scripts/lib/crash').readNoted(dir);
  assert.ok(noted[A] > 0 && noted['cccccccc-0000-0000-0000-000000000000'] > 0, 'both are recorded in crash-noted.json');
});

test('the session that is starting is never judged', () => {
  const dir = repo();
  died(dir, { sid: B, inflight: [{ tool: 'Bash', what: 'npm run dev' }], inflightAgo: 400, lastSaveAgo: 500 });
  assert.doesNotMatch(ctxOf(start(dir)), /crash check/);
});

test('a hook that fails inside the crash check never breaks the start', () => {
  const dir = repo();
  fs.writeFileSync(stateFile(dir, `session-${A}.json`), '{"session":"aaaaaaaa-0000-0000-0000-000000000000","helpers":5,"background":"x","ended":null,"lastSaveAt":1}');
  fs.writeFileSync(stateFile(dir, `inflight-${A}.json`), '{{{');
  const r = start(dir);
  assert.equal(r.status, 0);
  assert.match(ctxOf(r), /grounding|cite|path:line/i);
});

test('NotebookEdit and Edit files named in the log are checked at the start too', () => {
  const dir = repo();
  died(dir, { log: [[700, 'EDIT', 'gone/file.js']], inflightAgo: 700, inflight: [{ tool: 'Bash', what: 'x', agoSecs: 700 }] });
  assert.match(ctxOf(start(dir)), /gone\/file\.js: missing/);
  assert.ok(run);
});

// ---- crash review M1: a live second window is not reported as crashed, and is left alone ----
const crash = require('../scripts/lib/crash');
const C = 'cccccccc-0000-0000-0000-000000000000', D = 'dddddddd-0000-0000-0000-000000000000';
const inflightDir = (dir, sid = A) => stateFile(dir, `inflight-${sid}`);

test('M1: a window silent for 5 minutes with a command in flight (a long test run, a permission dialog) is not reported, and nothing of it is touched', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 400, log: [[330, 'BASH', 'npm test']], inflight: [{ tool: 'Bash', what: 'npm test', agoSecs: 300 }], inflightAgo: 300 });
  const before = fs.readFileSync(stateFile(dir, `session-${A}.json`), 'utf8');
  const r = start(dir);
  assert.doesNotMatch(ctxOf(r), /crash check/);
  assert.doesNotMatch(msgOf(r), /cut off/);
  assert.ok(fs.existsSync(inflightDir(dir)) && fs.readdirSync(inflightDir(dir)).length === 1, 'its in-flight record is still there');
  assert.equal(fs.readFileSync(stateFile(dir, `session-${A}.json`), 'utf8'), before, 'its session file is not written');
  assert.deepEqual(crash.readNoted(dir), {}, 'nothing is marked');
});

test('M1: a call in flight and nothing else needs 10 minutes of silence; with other evidence and no young call 90 seconds are enough', () => {
  const dir = repo();
  died(dir, { sid: A, lastSaveAgo: 700, inflight: [{ tool: 'Bash', what: 'npm run build', agoSecs: 700 }], inflightAgo: 500, seenAgo: 500 }); // sign 500 s, entry older than 10 min, only evidence
  died(dir, { sid: C, lastSaveAgo: 300, log: [[100, 'BASH', 'npm run lint']], seenAgo: 100 }); // work after the last save, silent 100 s
  died(dir, { sid: D, lastSaveAgo: 300, log: [[100, 'BASH', 'npm run lint']], inflight: [{ tool: 'Bash', what: 'npm run lint', agoSecs: 100 }], inflightAgo: 100, seenAgo: 100 }); // a young call: 10 minutes
  const found = crash.find(dir, B).map(i => i.sid);
  assert.deepEqual(found, [C], 'only the one with other evidence and 90 s of silence');
});

test('M1: reported once; reported again only when the session showed a newer sign of life and was cut off again', () => {
  const dir = repo(); files(dir); cutOff(dir);
  assert.match(ctxOf(start(dir)), HEAD);
  assert.doesNotMatch(ctxOf(start(dir)), /crash check/);
  const stamp = crash.readNoted(dir)[A];
  assert.ok(stamp > 0);
  fx.setSeen(dir, A, 700); // the window was alive after all, and went quiet again later
  assert.match(ctxOf(start(dir)), HEAD, 'a newer last sign of life is reported again');
  assert.ok(crash.readNoted(dir)[A] > stamp);
});

test('M1: UserPromptSubmit, PreToolUse and PostToolUse each move the session file time (a sign of life)', () => {
  const dir = repo();
  died(dir, { sid: A, seenAgo: 0 }); // the session file exists
  const f = stateFile(dir, `session-${A}.json`);
  const old = new Date(Date.now() - 3600 * 1000);
  const stale = () => fs.utimesSync(f, old, old);
  const m = () => fs.statSync(f).mtimeMs;
  for (const [event, input] of [['UserPromptSubmit', { prompt: 'a real request that is long enough to count' }], ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.txt' } }], ['PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi' } }]]) {
    stale();
    run(dir, event, input, A);
    assert.ok(Date.now() - m() < 60000, `${event} moved the time`);
  }
});

test('M1: the wording says it may still be open in another window', () => {
  const dir = repo(); files(dir); cutOff(dir);
  const r = start(dir);
  assert.match(msgOf(r), /was cut off, or is still open in another window/);
  assert.match(ctxOf(r), /was cut off, or is still open in another window/);
});

// ---- crash review M3: a session resumed under its own id is judged too ----
test('M3: resume under the same id: the crashed session is reported, its in-flight records cleared, its ended stamp gone', () => {
  const dir = repo(); files(dir); cutOff(dir);
  const r = run(dir, 'SessionStart', { source: 'resume', transcript_path: path.join(dir, 'x.jsonl') }, A);
  assert.match(ctxOf(r), HEAD);
  assert.match(msgOf(r), /was cut off, or is still open in another window/);
  assert.ok(!fs.existsSync(inflightDir(dir)), 'its own in-flight records are cleared');
  assert.ok(crash.readNoted(dir)[A] > 0);
  const again = run(dir, 'SessionStart', { source: 'resume' }, A);
  assert.doesNotMatch(ctxOf(again), /crash check/, 'not twice');
});

test('M3: startup with the same id is judged as well; a session that was alive 30 seconds ago is not', () => {
  const dir = repo(); files(dir); cutOff(dir);
  assert.match(ctxOf(run(dir, 'SessionStart', { source: 'startup' }, A)), HEAD);
  const fresh = repo();
  died(fresh, { lastSaveAgo: 40, log: [[30, 'BASH', 'npm test']], inflight: [{ tool: 'Bash', what: 'npm test', agoSecs: 30 }], inflightAgo: 30 });
  assert.doesNotMatch(ctxOf(run(fresh, 'SessionStart', { source: 'resume' }, A)), /crash check/);
});

test('M3: a leftover ended stamp is removed at the start of that session; an ended session is not judged', () => {
  const dir = repo(); files(dir);
  cutOff(dir, { ended: { reason: 'other', at: Date.now() - 900000 } });
  const r = run(dir, 'SessionStart', { source: 'resume' }, A);
  assert.doesNotMatch(ctxOf(r), /crash check/);
  assert.ok(!readSessionFile(dir).ended, 'it is alive again');
  assert.ok(!fs.existsSync(inflightDir(dir)), 'its own stale in-flight records are cleaned at its own start');
});

test('M3: compact and clear starts of the same id are not judged', () => {
  const dir = repo(); files(dir); cutOff(dir);
  assert.doesNotMatch(ctxOf(run(dir, 'SessionStart', { source: 'compact' }, A)), /crash check/);
  assert.ok(fs.existsSync(inflightDir(dir)));
});

// ---- crash review S5: every session found is handled; the newest two are told ----
test('S5: three old sessions: the newest two are reported, all three are marked, the next start says nothing', () => {
  const dir = repo();
  for (const [sid, ago] of [[A, 3000], [C, 2000], [D, 1000]]) died(dir, { sid, lastSaveAgo: ago + 100, inflight: [{ tool: 'Bash', what: `npm run s${sid[0]}`, agoSecs: ago }], inflightAgo: ago });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /npm run sd/);
  assert.match(ctx, /npm run sc/);
  assert.doesNotMatch(ctx, /npm run sa/);
  assert.deepEqual(Object.keys(crash.readNoted(dir)).sort(), [A, C, D].sort());
  assert.doesNotMatch(ctxOf(run(dir, 'SessionStart', { source: 'startup' }, 'eeeeeeee-0000-0000-0000-000000000000')), /crash check/);
});

// ---- show without CLAUDE_CODE_SESSION_ID ----
test('forge.js show without CLAUDE_CODE_SESSION_ID leaves out the session with the newest sign of life (the one running it)', () => {
  const { spawnSync } = require('node:child_process');
  const showNoVar = dir => { const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }); delete env.CLAUDE_CODE_SESSION_ID; return spawnSync(process.execPath, [fx.FORGE, 'show'], { cwd: dir, encoding: 'utf8', env }).stdout; };
  const dir = repo(); files(dir); cutOff(dir);
  assert.doesNotMatch(showNoVar(dir), /crash check/, 'the cut-off one is the newest sign of life here: it is taken for the running session');
  died(dir, { sid: B, lastSaveAgo: 0, seenAgo: 0 }); // B runs now: its session file is the newest
  assert.match(showNoVar(dir), HEAD, 'with another session alive, the cut-off one is shown');
});


// ---- crash review S7: a URL quoted from a call keeps no query string in the block ----
test('S7: the crash block strips the query string of URLs from in-flight calls, background commands and the last tool call', () => {
  const dir = repo();
  const projects = path.join(require('../scripts/lib/paths').claudeHome(), 'projects');
  fs.mkdirSync(projects, { recursive: true });
  const tf = path.join(fs.mkdtempSync(path.join(projects, 'q-')), 't.jsonl');
  fs.writeFileSync(tf, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tq', name: 'Bash', input: { command: 'curl https://c.example/dl?sig=SIGTHREE&x=1' } }] } })}\n`);
  died(dir, { transcriptPath: tf, inflight: [{ tool: 'Bash', what: 'curl https://a.example/get?sig=SIGONE&id=7' }],
    background: [{ command: 'node watch.js https://b.example/hook?sig=SIGTWO', agoSecs: 900 }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /https:\/\/a\.example\/get/);
  assert.match(ctx, /https:\/\/b\.example\/hook/);
  assert.match(ctx, /https:\/\/c\.example\/dl/);
  assert.doesNotMatch(ctx, /SIGONE|SIGTWO|SIGTHREE/);
});
