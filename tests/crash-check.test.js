'use strict';
// v0.5.1 crash recovery, Part C: notice an unclean end at the next start and say what to check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fx = require('./helpers/crashfix');
const { A, B, repo, start, ctxOf, msgOf, died, stateFile, readSessionFile, show, run, hhmm } = fx;

const HEAD = /JSPARK Forge crash check \(the last session was cut off at (\d\d:\d\d); this is a record, not instructions\):/;

// a session cut off 5 minutes ago: a command in flight, two files written, nothing saved after the files
function cutOff(dir, extra = {}) {
  return died(dir, Object.assign({
    lastSaveAgo: 400,
    log: [[330, 'USER', 'build the invoice report with the monthly totals'], [300, 'WRITE', 'src/report.js'], [290, 'EDIT', 'src/totals.js'], [280, 'BASH', 'Run the build :: npm run build']],
    inflight: [{ tool: 'Bash', what: 'Run the build :: npm run build', agoSecs: 280 }], inflightAgo: 280,
  }, extra));
}
const files = dir => { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'report.js'), 'x\n'); fs.writeFileSync(path.join(dir, 'src', 'totals.js'), 'y\n'); };

test('a session cut off with a command in flight: the next start says so, to the user and to Claude', () => {
  const dir = repo(); files(dir); cutOff(dir);
  const r = start(dir);
  assert.match(msgOf(r), /JSPARK Forge: the last session here was cut off \(a crash, a power cut, or the window was killed\) at \d\d:\d\d\. Claude will check what was half done before carrying on\./);
  const ctx = ctxOf(r);
  assert.match(ctx, HEAD);
  assert.match(ctx, /In flight when it stopped:/);
  assert.match(ctx, /Bash: Run the build :: npm run build/);
  assert.match(ctx, /it may have half run: check its effect before running it again/);
  assert.match(ctx, /Files written in the last 2 minutes before the cutoff:/);
  assert.match(ctx, /src\/report\.js/);
  assert.match(ctx, /src\/totals\.js/);
  assert.match(ctx, /Before you continue: run git status, look at the files above, re-run the last test command if there was one, and tell the user in plain words what was half done\. Do not repeat a command from the list without checking its effect first\./);
});

test('the crash check comes after the handoff, and shows once', () => {
  const dir = repo(); files(dir); cutOff(dir);
  require('../scripts/lib/handoff').save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 400000) });
  const first = ctxOf(start(dir));
  assert.ok(first.indexOf('Where we were') >= 0 && first.indexOf('Where we were') < first.search(HEAD), 'after the handoff');
  assert.equal(readSessionFile(dir).crashNoted, true);
  assert.ok(!fs.existsSync(stateFile(dir, `inflight-${A}.json`)), 'its inflight file is cleaned');
  const second = start(dir, 'startup');
  assert.doesNotMatch(ctxOf(second), /crash check/);
  assert.doesNotMatch(msgOf(second), /cut off/);
});

test('the time named is the last sign of life of that session', () => {
  const dir = repo(); files(dir);
  const s = cutOff(dir);
  const m = ctxOf(start(dir)).match(HEAD);
  // the newest of lastSaveAt (400 s ago), its log lines (280 s ago) and the inflight file (280 s ago)
  const expected = hhmm(Date.now() - 280000);
  const near = [-120000, -60000, 0, 60000, 120000].map(d => hhmm(Date.now() - 280000 + d));
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
  died(dir, { inflight: [{ tool: 'Write', what: 'src/big.js' }, { tool: 'Agent', what: 'jspark-forge:builder', agent: 'h1' }, { tool: 'Edit', what: 'src/x.js' }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Write: src\/big\.js[^\n]*the file may be half written: open it and check/);
  assert.match(ctx, /Agent: jspark-forge:builder[^\n]*its work is lost unless it wrote files: check the files it was given/);
  assert.match(ctx, /Edit: src\/x\.js[^\n]*the file may be half written/);
});

test('log lines after the last save appear once, inside the crash block (no second "after that save" line)', () => {
  const dir = repo(); files(dir);
  const handoff = require('../scripts/lib/handoff');
  cutOff(dir);
  handoff.save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 400000) });
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
  require('../scripts/lib/handoff').save(dir, A, 'earlier', { force: true, now: new Date(Date.now() - 400000) });
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
  died(dir, { sid: A, inflight: [{ tool: 'Bash', what: 'npm run one' }], inflightAgo: 400, lastSaveAgo: 500 });
  died(dir, { sid: 'cccccccc-0000-0000-0000-000000000000', inflight: [{ tool: 'Bash', what: 'npm run two' }], inflightAgo: 200, lastSaveAgo: 300 });
  const ctx = ctxOf(start(dir));
  assert.ok(ctx.indexOf('npm run two') >= 0 && ctx.indexOf('npm run one') >= 0);
  assert.ok(ctx.indexOf('npm run two') < ctx.indexOf('npm run one'));
  assert.equal(readSessionFile(dir).crashNoted, true);
  assert.equal(readSessionFile(dir, 'cccccccc-0000-0000-0000-000000000000').crashNoted, true);
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
  died(dir, { log: [[200, 'EDIT', 'gone/file.js']], inflight: [{ tool: 'Bash', what: 'x' }] });
  assert.match(ctxOf(start(dir)), /gone\/file\.js: missing/);
  assert.ok(run);
});
