'use strict';
// v0.5.1 second review (2026-11-21): the findings that were fixed, one test each.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fx = require('./helpers/crashfix');
const { A, repo, run, ctxOf, died, stateFile } = fx;
const { redact, stripQuery } = require('../scripts/lib/redact');
const git = require('../scripts/lib/git');
const lint = require('../scripts/lib/lint');
const crash = require('../scripts/lib/crash');

const ms = fn => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

// ---- 1: a crashed session resumed under its own id two minutes later ----
test('1: resume under the same id 2 minutes after the cut: reported, and only then are its records cleared', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 200, log: [[130, 'USER', 'run the build'], [120, 'BASH', 'Run the build :: npm run build']],
    inflight: [{ tool: 'Bash', what: 'Run the build :: npm run build', agoSecs: 120 }], inflightAgo: 120 });
  const r = run(dir, 'SessionStart', { source: 'resume' }, A);
  assert.match(ctxOf(r), /JSPARK Forge crash check/);
  assert.match(ctxOf(r), /npm run build/);
  assert.ok(!fs.existsSync(stateFile(dir, `inflight-${A}`)), 'cleared after it was reported');
});

test('1: a start of the same id seconds after its last sign of life says nothing', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 20, log: [[5, 'BASH', 'npm test']], inflight: [{ tool: 'Bash', what: 'npm test', agoSecs: 5 }], inflightAgo: 5 });
  assert.doesNotMatch(ctxOf(run(dir, 'SessionStart', { source: 'resume' }, A)), /crash check/);
});

test('1: another session is still judged with the 10-minute wait', () => {
  const dir = repo();
  died(dir, { lastSaveAgo: 200, log: [[120, 'BASH', 'npm run build']], inflight: [{ tool: 'Bash', what: 'npm run build', agoSecs: 120 }], inflightAgo: 120 });
  assert.doesNotMatch(ctxOf(fx.start(dir)), /crash check/);
});

// ---- 2: "no commits yet" in a subfolder of a repo that has commits ----
test('2: headCommit walks up to the repo root like headBranch', () => {
  const dir = repo();
  const sub = path.join(dir, 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  assert.match(String(git.headCommit(dir)), /^[0-9a-f]{7}$/);
  assert.equal(git.headCommit(sub), git.headCommit(dir));
  assert.equal(git.headCommit(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-nogit-'))), null);
});

// ---- 3: redaction stays fast on long lines ----
test('3: redact and stripQuery take well under a second on 100 KB of dotted text', () => {
  const dots = 'a.'.repeat(50 * 1024);
  const jw = 'eyJa.'.repeat(20 * 1024);
  assert.ok(ms(() => redact(dots)) < 1000, 'redact, dots');
  assert.ok(ms(() => stripQuery(dots)) < 1000, 'stripQuery, dots');
  assert.ok(ms(() => stripQuery(jw)) < 1000, 'stripQuery, eyJa.');
  assert.ok(ms(() => redact('x-'.repeat(50 * 1024))) < 1000, 'redact, hyphens');
});

test('3: the URL patterns still work', () => {
  assert.equal(redact('postgres://bob:hunter2pass@db.example.com/x'), 'postgres://bob:‹redacted›@db.example.com/x');
  assert.equal(redact('git+ssh://u:pw12345678@h/x'), 'git+ssh://u:‹redacted›@h/x');
  assert.equal(stripQuery('see https://example.com/a?sig=abc now'), 'see https://example.com/a now');
});

test('3: a log line and an in-flight record only redact the start of a very long text', () => {
  const log = require('../scripts/lib/log');
  const long = `password=hunter2secret ${'a.'.repeat(200 * 1024)}`;
  let line;
  assert.ok(ms(() => { line = log.formatLine({ time: new Date(), session: A, kind: 'BASH', detail: long }); }) < 1000);
  assert.ok(!line.includes('hunter2secret'));
  const inflight = require('../scripts/lib/inflight');
  const dir = repo();
  assert.ok(ms(() => inflight.add(dir, { session_id: A, tool_name: 'Bash', tool_input: { command: long } })) < 1000);
  const got = inflight.read(dir, A);
  assert.equal(got.length, 1);
  assert.ok(!JSON.stringify(got).includes('hunter2secret'));
});

// ---- 4: a slow full file count is not paid on every save ----
test('4: after the full count timed out, the next calls go straight to the quick count for a while', () => {
  const dir = repo();
  const slowFile = path.join(dir, '.jspark-forge', 'state', 'git-slow');
  const a = git.gitInfo(dir, { fullTimeoutMs: 1, slowFile }); // 1 ms: the full count cannot finish
  assert.equal(a.approx, true);
  assert.ok(fs.existsSync(slowFile), 'remembered');
  const b = git.gitInfo(dir, { slowFile }); // would finish now, but the memory says skip
  assert.equal(b.approx, true);
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(slowFile, old, old);
  assert.equal(git.gitInfo(dir, { slowFile }).approx, undefined, 'tried again after an hour');
  assert.ok(!fs.existsSync(slowFile), 'and forgotten when the full count works');
});

// ---- 5: agent lint is for JSPARK Forge's own helper files ----
test('5: a project\'s own agents folder is not linted by default; the plugin\'s is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agents-'));
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(dir, 'agents', 'mine.md'), '---\nname: mine\ndescription: my helper\nmodel: inherit\n---\nbody\n');
  assert.deepEqual(lint.defaultPaths(dir), []);
  const own = lint.defaultPaths(path.join(__dirname, '..')).filter(f => path.basename(path.dirname(f)) === 'agents');
  assert.equal(own.length, 4);
});

// ---- 9: an older project with briefs but no graphs folder learns the briefs lines ----
test('9: session start adds the graph and brief lines when only briefs/ exists', () => {
  const dir = repo();
  const g = path.join(dir, '.jspark-forge', '.gitignore');
  fs.writeFileSync(g, '*\n!.gitignore\n!rules.md\n!launch.md\n');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'briefs'));
  fx.start(dir);
  assert.match(fs.readFileSync(g, 'utf8'), /!briefs\/\*\.md/);
});

// ---- 10: housekeeping also runs where the crash check does not ----
test('10: old in-flight records are pruned in a project that is not a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-nogit-'));
  const sd = path.join(dir, '.jspark-forge', 'state');
  const d = path.join(sd, `inflight-${A}`);
  fs.mkdirSync(d, { recursive: true });
  const old = new Date(Date.now() - 9 * 24 * 3600 * 1000);
  fs.utimesSync(d, old, old);
  assert.equal(crash.prune(dir, 'bbbbbbbb-0000-0000-0000-000000000000'), 1);
  assert.ok(!fs.existsSync(d));
});

// keep execFileSync used (a repo with a second commit): the short hash follows HEAD
test('2: headCommit follows a new commit', () => {
  const dir = repo();
  const before = git.headCommit(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  execFileSync('git', ['add', 'b.txt'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'two'], { cwd: dir, stdio: 'ignore' });
  assert.notEqual(git.headCommit(dir), before);
});
