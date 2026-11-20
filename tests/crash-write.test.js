'use strict';
// v0.5.1 crash recovery, Part A: writes that survive a power cut, the previous good handoff pair, reading a damaged
// handoff, and a log line cut off mid-write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const fsx = require('../scripts/lib/fsx');
const handoff = require('../scripts/lib/handoff');
const state = require('../scripts/lib/state');
const log = require('../scripts/lib/log');
const doctor = require('../scripts/lib/doctor');
const A = 'aaaaaaaa-0000-0000-0000-000000000000';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-crashw-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  require('../scripts/lib/paths').markOwn(dir);
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt'); g('commit', '-qm', 'init');
  return dir;
}
const F = dir => path.join(dir, '.jspark-forge');
const md = dir => path.join(F(dir), 'handoff.md');
const json = dir => path.join(F(dir), 'state', 'handoff.json');
const prevMd = dir => path.join(F(dir), 'handoff.prev.md');
const prevJson = dir => path.join(F(dir), 'state', 'handoff.prev.json');
const today = () => log.dayStamp(new Date());
const logFile = dir => path.join(F(dir), 'log', `${today()}.log`);
const hhmmss = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
const line = (secs, kind, detail, id = 'aaaaaaaa') => `${hhmmss(new Date(Date.now() - secs * 1000))} ${`[${id}]`.padEnd(19)} ${kind.padEnd(5)} ${detail}\n`;

function twoSaves(dir) {
  const s = state.readSession(dir, A); s.lastPrompt = 'build the first invoice report with the monthly totals'; state.writeSession(dir, A, s);
  handoff.save(dir, A, 'one', { force: true, now: new Date(Date.now() - 60000) });
  const s2 = state.readSession(dir, A); s2.lastPrompt = 'now add the second report for quarterly totals please'; state.writeSession(dir, A, s2);
  handoff.save(dir, A, 'two', { force: true });
}

// ---- fsync ----
test('writeAtomic flushes the temp file to the disk before the rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fsx-'));
  const calls = [];
  const realSync = fs.fsyncSync, realRename = fs.renameSync;
  fs.fsyncSync = fd => { calls.push('fsync'); return realSync(fd); };
  fs.renameSync = (a, b) => { calls.push('rename'); return realRename(a, b); };
  try { fsx.writeAtomic(path.join(dir, 'x.json'), '{"a":1}\n'); } finally { fs.fsyncSync = realSync; fs.renameSync = realRename; }
  assert.deepEqual(calls, ['fsync', 'rename']);
  assert.equal(fs.readFileSync(path.join(dir, 'x.json'), 'utf8'), '{"a":1}\n');
  assert.deepEqual(fs.readdirSync(dir), ['x.json'], 'no temp file is left');
});

test('writeAtomic carries on when the file system refuses fsync', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fsx-'));
  const realSync = fs.fsyncSync;
  fs.fsyncSync = () => { throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' }); };
  try { fsx.writeAtomic(path.join(dir, 'y.txt'), 'hello'); } finally { fs.fsyncSync = realSync; }
  assert.equal(fs.readFileSync(path.join(dir, 'y.txt'), 'utf8'), 'hello');
});

// ---- the previous good pair ----
test('a save keeps the previous good pair as handoff.prev.md and state/handoff.prev.json', () => {
  const dir = repo();
  twoSaves(dir);
  assert.match(fs.readFileSync(md(dir), 'utf8'), /second report/);
  assert.match(fs.readFileSync(prevMd(dir), 'utf8'), /first invoice report/);
  const pj = JSON.parse(fs.readFileSync(prevJson(dir), 'utf8'));
  const nj = JSON.parse(fs.readFileSync(json(dir), 'utf8'));
  assert.ok(pj.savedAt < nj.savedAt);
});

test('a damaged newest pair is never copied over the good previous one', () => {
  const dir = repo();
  twoSaves(dir);
  fs.writeFileSync(json(dir), ''); // the power cut
  const s = state.readSession(dir, A); s.lastPrompt = 'a third thing to do with the totals, longer than a short reply'; state.writeSession(dir, A, s);
  handoff.save(dir, A, 'three', { force: true });
  assert.match(fs.readFileSync(prevMd(dir), 'utf8'), /first invoice report/, 'prev kept');
});

test('closing the task (done) also removes the previous pair, so it cannot come back', () => {
  const dir = repo();
  twoSaves(dir);
  handoff.archive(dir);
  assert.ok(!fs.existsSync(prevMd(dir)) && !fs.existsSync(prevJson(dir)));
  const rc = handoff.resumeContext(dir, 'bbbbbbbb-0000-0000-0000-000000000000', 'startup');
  assert.doesNotMatch(rc.context, /Where we were/);
});

// ---- reading a damaged handoff ----
test('handoff.json empty and handoff.md cut: the previous pair is used, and it says so', () => {
  const dir = repo();
  twoSaves(dir);
  fs.writeFileSync(json(dir), '');
  fs.writeFileSync(md(dir), '# Where we were\nAs of 2026-11-2');
  const rc = handoff.resumeContext(dir, 'bbbbbbbb-0000-0000-0000-000000000000', 'startup');
  assert.match(rc.context, /first invoice report/);
  assert.doesNotMatch(rc.context, /As of 2026-11-2\b/);
  assert.match(rc.context, /newest save was damaged/i);
  assert.match(rc.context, /one before it is shown/i);
  assert.ok(rc.systemMessage);
});

test('handoff.json missing or invalid, handoff.md empty or cut: each falls back to the previous pair', () => {
  for (const damage of [
    d => fs.unlinkSync(json(d)),
    d => fs.writeFileSync(json(d), '{not json'),
    d => fs.writeFileSync(md(d), ''),
    d => fs.writeFileSync(md(d), '# Where we were\nAs of 2026-11-2'), // cut short
  ]) {
    const dir = repo();
    twoSaves(dir);
    damage(dir);
    const rc = handoff.resumeContext(dir, 'bbbbbbbb-0000-0000-0000-000000000000', 'startup');
    assert.match(rc.context, /newest save was damaged/i);
    assert.match(rc.context, /first invoice report/);
  }
});

test('both pairs unusable but the log has entries: the context is built from the log alone', () => {
  const dir = repo();
  twoSaves(dir);
  for (const f of [json(dir), prevJson(dir)]) fs.writeFileSync(f, '');
  fs.writeFileSync(md(dir), ''); fs.unlinkSync(prevMd(dir));
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(300, 'USER', 'build the first invoice report with the monthly totals') + line(200, 'EDIT', 'src/report.js') + line(100, 'BASH', 'npm test'));
  const rc = handoff.resumeContext(dir, 'bbbbbbbb-0000-0000-0000-000000000000', 'startup');
  assert.match(rc.context, /could not be read/i);
  assert.match(rc.context, /built from the action log alone/i);
  assert.match(rc.context, /src\/report\.js/);
  assert.match(rc.context, /first invoice report/);
  assert.match(rc.context, /Continue\?/);
  assert.ok(rc.systemMessage);
});

test('both pairs unusable and an empty log: nothing is shown, nothing throws', () => {
  const dir = repo();
  fs.writeFileSync(md(dir), ''); fs.writeFileSync(json(dir), '{');
  const rc = handoff.resumeContext(dir, A, 'startup');
  assert.doesNotMatch(rc.context, /Where we were/);
  assert.equal(rc.systemMessage, null);
});

test('a fresh project (no handoff at all, talk in the log) does not claim a damaged handoff', () => {
  const dir = repo();
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(10, 'USER', 'hello there, what can you do for me today'));
  const rc = handoff.resumeContext(dir, A, 'startup');
  assert.doesNotMatch(rc.context, /damaged|could not be read/i);
});

// ---- the doctor ----
test('doctor: a damaged newest save with a good previous one is ok with a note; both damaged is FIX', () => {
  const dir = repo();
  twoSaves(dir);
  fs.writeFileSync(json(dir), '');
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ch-'));
  let out = doctor.doctor(dir, claudeHome);
  assert.match(out, /ok\s+Handoff:.*newest save is damaged.*previous/i);
  fs.writeFileSync(prevJson(dir), '{');
  out = doctor.doctor(dir, claudeHome);
  assert.match(out, /FIX\s+Handoff:/);
});

// ---- a log line cut off mid-write ----
function cutLog(dir) {
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(60, 'USER', 'build the first invoice report with the monthly totals') + line(50, 'EDIT', 'src/a.js') + line(40, 'FORGE-ERROR', 'PostToolUse: boom') +
    '\0\0\0\0\0\0\0\0' + line(30, 'EDIT', 'src/b.js').replace(/\n$/, '') + '\n' + `${hhmmss(new Date())} [aaaaaaaa]         EDIT  src/hal`);
}
test('a log ending in a half line is ignored by logEntries, sinceSave and hookErrors', () => {
  const dir = repo(); cutLog(dir);
  const e = handoff.logEntries(dir);
  assert.ok(e.some(x => x.detail === 'src/a.js'));
  assert.ok(e.some(x => x.detail === 'src/b.js'), 'a good line after NUL bytes is kept');
  assert.ok(!e.some(x => x.detail.includes('src/hal')), 'the cut line is not an entry');
  assert.ok(!e.some(x => x.detail.includes('\0')));
  const since = handoff.sinceSave(dir, Date.now() - 120000);
  assert.ok(since.every(s => !/hal/.test(s)));
  assert.ok(since.some(s => /src\/a\.js/.test(s)));
  assert.equal(log.hookErrors(dir).n, 1);
});

test('a log ending in a run of NUL bytes is read without error', () => {
  const dir = repo();
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(20, 'EDIT', 'src/a.js') + '\0'.repeat(4096));
  assert.deepEqual(handoff.logEntries(dir).map(x => x.detail), ['src/a.js']);
  assert.equal(log.hookErrors(dir).n, 0);
});

test('log.append after a cut line starts a new line, so the next entry is not lost', () => {
  const dir = repo();
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(20, 'EDIT', 'src/a.js') + '12:00:0');
  log.append(dir, { time: new Date(), session: A, kind: 'EDIT', detail: 'src/c.js' });
  const details = handoff.logEntries(dir).map(x => x.detail);
  assert.deepEqual(details, ['src/a.js', 'src/c.js']);
});

test('forge.js show --log prints a cut log without the half line or NUL bytes', () => {
  const dir = repo(); cutLog(dir);
  handoff.save(dir, A, 'x', { force: true });
  const r = spawnSync(process.execPath, [FORGE, 'show', '--log'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /src\/a\.js/);
  assert.doesNotMatch(r.stdout, /src\/hal/);
  assert.ok(!r.stdout.includes('\0'));
});

// ---- crash review S8: a deleted handoff.md is not crash damage ----
test('S8: handoff.md deleted (json still there) behaves as with no handoff: no damage note, no "could not be read", no fallback', () => {
  const dir = repo();
  twoSaves(dir);
  fs.mkdirSync(path.dirname(logFile(dir)), { recursive: true });
  fs.writeFileSync(logFile(dir), line(300, 'USER', 'build the first invoice report with the monthly totals') + line(200, 'EDIT', 'src/report.js'));
  fs.unlinkSync(md(dir));
  assert.equal(handoff.openHandoff(dir), null);
  const rc = handoff.resumeContext(dir, 'bbbbbbbb-0000-0000-0000-000000000000', 'startup');
  assert.doesNotMatch(rc.context, /damaged|could not be read|built from the action log/i);
  assert.equal(rc.systemMessage, null);
  assert.equal(handoff.pairHealth(dir).newest, 'missing');
});
