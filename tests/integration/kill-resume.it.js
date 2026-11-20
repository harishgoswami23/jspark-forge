'use strict';
// THE v0.1 SHIP GATE (design 13 "The resume test"; spec 7). Must pass on Windows, macOS and Linux.
// 1. Fixture: fastify v4.28.1 (MIT, ~68k lines; tests/fixtures.md), copied to a temp folder, .jspark-forge/ set up.
// 2. Start `claude -p "<a scripted 10-step task>"` in the background.
// 3. Watch .jspark-forge/log/; after >= 3 EDIT/WRITE lines and >= 1 COMMIT, kill the whole process tree, no warning.
// 4. Assert the handoff: HEAD = repo HEAD; Step >= last completed; Next action not empty; the background job listed.
// 5. Start a new session; measure wall time from launch to the reply.
// 6. Assert the reply names the task, the step, the next action and the running job; no file changed; time < 30 s.
// Env: FORGE_FIXTURE_DIR = an existing fastify clone to copy from (else it is cloned from GitHub).
//      FORGE_IT_MODEL = model for the work session (default haiku); FORGE_IT_RESUME_MODEL = model for the resume
//      session (default: the user's own default model, i.e. no --model flag).
// "Cold machine" (design 13 step 5) is not reproducible inside one running session; CI runners are cold.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { PLUGIN, tmp, gitInit, initForge, claudeBackground, killTree, logText, gitStatus, head } = require('./lib');

const TAG = 'v4.28.1';
const SHA = '94068edf593534d9c1b6b4edf71ecd55ff4b3124';
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fixture() {
  const dir = path.join(tmp('forge-it-kill-'), 'fastify');
  const src = process.env.FORGE_FIXTURE_DIR || `https://github.com/fastify/fastify.git`;
  execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', TAG,
    src.startsWith('http') ? src : `file://${path.resolve(src).replace(/\\/g, '/')}`, dir], { stdio: 'ignore' });
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), SHA, 'pinned fixture');
  execFileSync('git', ['checkout', '-q', '-b', 'main'], { cwd: dir });
  gitInit(dir);
  initForge(dir);
  return dir;
}

const TASK = [
  'Work through this task on your own, without asking questions.',
  'First write docs/forge-test-plan.md with the title line "# Add route docs" and exactly these 10 checkbox items:',
  '"- [ ] route docs 1" through "- [ ] route docs 10".',
  'Then start a background job with the Bash tool, run_in_background true, command: sleep 600, description: route docs watcher.',
  'Then do the items one at a time, in order: for item N, use the Write tool to create docs/route-docs/route-N.md with one',
  'sentence about route N, use the Edit tool to tick its box in the plan file, then run one git command that commits both',
  'files with the message "route docs N". Never handle several items in one command or loop. Do not stop until all 10 are done.',
].join(' ');

test('kill mid-task, reopen: back to work in < 30 s, nothing changed', { timeout: 900000 }, () => {
  const dir = fixture();
  const lines = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(f => /\.(js|ts|mjs|cjs)$/.test(f))
    .reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').length, 0);
  console.log(`fixture: fastify ${TAG} (${lines} lines of JS/TS) at ${dir}`);

  // 2-3. run, watch, kill
  const child = claudeBackground(dir, TASK, ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Write', 'Edit', 'Read']);
  const started = Date.now();
  let killedAt = null;
  while (Date.now() - started < 600000) {
    const log = logText(dir);
    const writes = (log.match(/^\S+ \[[^\]]*\]\s+(EDIT|WRITE) /gm) || []).length;
    const saves = (log.match(/^\S+ \[[^\]]*\]\s+SAVE  (file write|commit)/gm) || []).length;
    const commits = (log.match(/^\S+ \[[^\]]*\]\s+COMMIT /gm) || []).length;
    if ((writes >= 3 || saves >= 3) && commits >= 1) { killTree(child); killedAt = Date.now(); console.log(`killed after ${writes} writes, ${commits} commit(s), ${Math.round((killedAt - started) / 1000)} s`); break; }
    // The model may finish the whole task in one go (then its background job keeps the process alive): not a valid run.
    if (child.exitCode !== null || /^\S+ \[[^\]]*\]\s+STOP/m.test(log)) { killTree(child); break; }
    sleep(1000);
  }
  assert.ok(killedAt, `task never reached 3 writes + 1 commit before ending:\n${logText(dir)}`);
  sleep(1500);

  // 4. the handoff
  const hf = path.join(dir, '.jspark-forge', 'handoff.md');
  assert.ok(fs.existsSync(hf), 'handoff.md exists');
  const h = fs.readFileSync(hf, 'utf8');
  console.log(`--- handoff after the kill ---\n${h}`);
  assert.match(h, new RegExp(`@ ${head(dir)}`), 'handoff HEAD = repo HEAD');
  const plan = fs.readFileSync(path.join(dir, 'docs', 'forge-test-plan.md'), 'utf8');
  const ticked = (plan.match(/^\s*- \[[xX]\]/gm) || []).length;
  const step = h.match(/\*\*Step:\*\* (\d+) of (\d+)/);
  assert.ok(step, 'Step recorded');
  assert.ok(Number(step[1]) >= ticked, `Step ${step[1]} >= last completed (${ticked})`);
  assert.ok(!/\*\*Next action:\*\* not recorded/.test(h), 'Next action not empty');
  assert.match(h, /\*\*Still running at cutoff:\*\*.*sleep 600/, 'background job listed');

  // 5-6. resume in a new session
  const before = gitStatus(dir);
  const resumeArgs = ['-p', 'hi', '--plugin-dir', PLUGIN];
  if (process.env.FORGE_IT_RESUME_MODEL) resumeArgs.push('--model', process.env.FORGE_IT_RESUME_MODEL);
  const t0 = Date.now();
  const r = spawnSync('claude', resumeArgs, { cwd: dir, encoding: 'utf8', timeout: 120000, input: '' });
  const secs = (Date.now() - t0) / 1000;
  console.log(`--- resume reply (${secs.toFixed(1)} s, model ${process.env.FORGE_IT_RESUME_MODEL || 'default'}) ---\n${r.stdout}`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(secs < 30, `resume took ${secs.toFixed(1)} s`);
  const reply = r.stdout.toLowerCase();
  assert.match(reply, /route docs/, 'names the task');
  assert.ok(reply.includes(step[1]), `names the step (${step[1]})`);
  const next = (h.match(/\*\*Next action:\*\* (.*)$/m) || [])[1] || '';
  const nextNum = (next.match(/(\d+)/) || [])[1];
  assert.ok(!nextNum || reply.includes(nextNum), `names the next action (${next})`);
  assert.match(reply, /sleep|watcher|background/, 'names the running job');
  assert.equal(gitStatus(dir), before, 'no file changed before the user answered');
});
