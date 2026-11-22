'use strict';
// v0.6.2: six small fixes from real use in another project (owner, 2026-11-21).
//  1. "continue" as the first message is the answer: no second "Continue?".
//  2. The handoff lists the newest few touched files and a count, not all 50.
//  3. A gate nobody is running is "waiting to be run" (first worded "not yet passed"), not "running" (tests/graph-gate.test.js too).
//  4. A step named like its kind reads "Step gate" (first "Step gate (gate)"), not "Gate gate".
//  5. Notes carry their date and say to re-check a caution before acting on it.
//  6. One line says who decides what when superpowers is installed too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const handoff = require('../scripts/lib/handoff');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const ROOT = path.join(__dirname, '..');

const model = extra => Object.assign({
  asOf: new Date(2026, 10, 21, 23, 0), reason: 'commit', git: null, task: 'Fix login', step: null, done: null, next: null,
  running: [], waiting: null, lastRequest: 'go on', notes: null, recent: [], files: [], logFile: '.jspark-forge/log/2026-11-21.log', others: [],
}, extra);

// ---- 1 ----
test('the wait line: a first message that says continue is the answer, no second question', () => {
  const w = handoff.WAIT_LINE;
  assert.match(w, /ending with 'Continue\?'/, 'the question is still asked when the user has not answered');
  assert.match(w, /already says to carry on \("continue", "resume", "go on", "yes"\)/);
  assert.match(w, /do not ask again, and carry on/);
  assert.match(w, /cut-off session is reported below, check what it left half done first/, 'a cut-off session is still checked first');
  assert.doesNotMatch(w, /crash check/, 'those words belong to the crash block alone (tests/crash-check.test.js)');
  assert.match(w, /new task/, 'a new task still parks the old one');
});

test('the resume skill has the same exception, and a question is not a go-ahead', () => {
  const t = fs.readFileSync(path.join(ROOT, 'skills', 'resume', 'SKILL.md'), 'utf8');
  assert.match(t, /already said to carry on/);
  assert.match(t, /do not end with "Continue\?"/);
  assert.match(t, /is not a go-ahead: show and wait/);
});

// ---- 2 ----
test('a long list of touched files shows a count, the newest 5 and where the log is', () => {
  const files = Array.from({ length: 50 }, (_, i) => `src/f${i}.js`);
  const t = handoff.render(model({ files }));
  const line = t.match(/\*\*Files touched in this task:\*\* (.*)$/m)[1];
  assert.match(line, /^50 files; newest: src\/f0\.js, src\/f1\.js, src\/f2\.js, src\/f3\.js, src\/f4\.js; the rest are in the log \(\.jspark-forge\/log\/[^)]+\.log\)$/);
  assert.match(t, /\*\*More detail:\*\* \.jspark-forge\/log\//, 'the log is still named for the rest');
});

test('eight files or fewer are all listed, with no count', () => {
  const files = Array.from({ length: 8 }, (_, i) => `src/f${i}.js`);
  const line = handoff.render(model({ files })).match(/\*\*Files touched in this task:\*\* (.*)$/m)[1];
  assert.equal(line, files.join(', '));
});

// ---- 5 ----
test('notes from today show the time and say to re-check a caution', () => {
  const t = handoff.render(model({ notes: { time: new Date(2026, 10, 21, 22, 46), text: 'Stop the containers first.' } }));
  assert.match(t, /^\*\*Claude's notes \(22:46; re-check any caution or limit before acting on it\):\*\* Stop the containers first\.$/m);
});

test('notes from an earlier day show their date', () => {
  const t = handoff.render(model({ notes: { time: new Date(2026, 10, 19, 9, 5), text: 'Stop the containers first.' } }));
  assert.match(t, /^\*\*Claude's notes \(2026-11-19 09:05; re-check any caution or limit before acting on it\):\*\*/m);
});

test('the notes reminder asks for the measurement behind a caution', () => {
  const line = handoff.notesLine(os.tmpdir());
  assert.match(line, /max 120 words/);
  assert.match(line, /caution or a limit with what was measured/);
  assert.match(line, /drop one that no longer holds/);
});

// ---- 3 and 4: a gate step that is named "gate" ----
function project(graph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-v062-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'g.md'), graph);
  return dir;
}
const SID = 'v062-1';
const env = dir => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CODE_SESSION_ATTENDED: '1' });
const cli = (dir, args) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8', env: env(dir) }).stdout;
const hook = (dir, event, input) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8', env: env(dir),
  input: JSON.stringify(Object.assign({ session_id: SID, cwd: dir }, input)) });
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(3)"';
function started(graph) {
  const dir = project(graph);
  cli(dir, ['start', 'g']);
  hook(dir, 'UserPromptSubmit', { prompt: 'TRUST GRAPH g' });
  assert.match(cli(dir, ['start', 'g']), /Started/);
  return dir;
}

test('a gate that was handed out and not run is "waiting to be run" in status, never "running"', () => {
  const dir = started(`# Graph: g\n## gate (gate)\n- run: ${OK}\n`);
  cli(dir, ['next', 'g']);
  const s = cli(dir, ['status', 'g']);
  assert.match(s, /0 of 1 steps done; gate waiting to be run \(0 of 1 commands passed\)/);
  assert.match(s, /^- gate: waiting to be run \(0 of 1 commands passed\)$/m);
  assert.doesNotMatch(s, /running[^)]/, 'nothing is said to be running');
});

test('a step named "gate" is named once: "Step gate", not "Gate gate" or "Step gate (gate)"', () => {
  const dir = started(`# Graph: g\n## gate (gate)\n- run: ${OK}\n`);
  cli(dir, ['next', 'g']);
  const again = cli(dir, ['next', 'g']);
  assert.match(again, /^Step gate still needs:/m);
  const out = cli(dir, ['gate', 'g', 'gate']);
  assert.match(out, /^Step gate passed\./m);
  assert.doesNotMatch(again + out, /Gate gate/);
});

test('a failing gate says "Step <id> (gate) failed"', () => {
  const dir = started(`# Graph: g\n## gate (gate)\n- run: ${BAD}\n`);
  cli(dir, ['next', 'g']);
  assert.match(cli(dir, ['gate', 'g', 'gate']), /^Step gate failed: .*exited 3/m);
});

// ---- 6 ----
const start = (dir, home) => {
  const r = spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'v062-s', cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};

test('with superpowers installed, one line says who decides what; without it, nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-v062-cfg-'));
  const dir = project('# Graph: g\n');
  assert.doesNotMatch(start(dir, home), /who decides what/);
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'superpowers@jspark-forge': [{}] } }));
  const c = start(dir, home);
  assert.match(c, /JSPARK Forge and superpowers, who decides what/);
  assert.match(c, /superpowers sets the method/);
  assert.match(c, /JSPARK Forge sets the guard rails/);
  assert.match(c, /the user's own instruction, then JSPARK Forge's block list and grounding rule, then superpowers/);
  assert.equal(c.split('who decides what').length, 2, 'said once');
});
