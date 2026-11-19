'use strict';
// Design 4 (save triggers a-e), 5 (handoff), 5.3 (notes reminder), 8 (resume flow, show and wait), 8.1 (grounding).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const SID = 'a1b2c3d4-0000-0000-0000-000000000000';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-resume-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true }); // state/ = a real (own) project
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  require('../scripts/lib/paths').markOwn(dir); // and the marker inside .git that setup writes (review H1)
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt'); g('commit', '-qm', 'init');
  return dir;
}
function run(dir, event, input = {}, env = {}) {
  const stdin = JSON.stringify(Object.assign({ session_id: SID, cwd: dir, hook_event_name: event }, input));
  return spawnSync(process.execPath, [FORGE, event], { input: stdin, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }, env) });
}
const out = r => (r.stdout ? JSON.parse(r.stdout) : null);
const ctxOf = r => { const o = out(r); return o && o.hookSpecificOutput ? o.hookSpecificOutput.additionalContext || '' : ''; };
const handoffText = dir => fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
const logText = dir => { const d = path.join(dir, '.jspark-forge', 'log'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const meta = dir => JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'handoff.json'), 'utf8'));
const setMeta = (dir, patch) => fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'handoff.json'), JSON.stringify(Object.assign(meta(dir), patch)));
const editIn = (dir, rel) => run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel) } });

// ---- save triggers ----
test('a: an Edit saves the handoff with the file touched, and logs SAVE', () => {
  const dir = repo();
  editIn(dir, 'src/x.ts');
  const t = handoffText(dir);
  assert.match(t, /saved because: file write/);
  assert.match(t, /\*\*Files touched in this task:\*\* src\/x\.ts/);
  assert.match(t, /branch main @ [0-9a-f]{7}/);
  assert.match(logText(dir), /SAVE  file write/);
});

test('a: writes within 5 s are merged (one SAVE), but every file is still recorded', () => {
  const dir = repo();
  editIn(dir, 'one.ts'); editIn(dir, 'two.ts');
  assert.equal((logText(dir).match(/SAVE/g) || []).length, 1);
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /two\.ts, one\.ts/);
});

test('a: a Bash redirect into the project saves; a redirect to /dev/null does not', () => {
  const dir = repo();
  run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi > /dev/null' } });
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md')));
  run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo hi > notes.txt' } });
  assert.match(handoffText(dir), /notes\.txt/);
});

test('b: a commit saves with the new HEAD and logs COMMIT <sha> <subject>', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  execFileSync('git', ['add', 'b.txt'], { cwd: dir }); execFileSync('git', ['commit', '-qm', 'add chart model'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  run(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git add b.txt && git commit -m "add chart model"' } });
  assert.match(logText(dir), new RegExp(`COMMIT ${sha} add chart model`));
  assert.match(handoffText(dir), new RegExp(`saved because: commit · branch main @ ${sha}`));
});

test('c: Stop saves; running background shells and a closing question are recorded', () => {
  const dir = repo();
  run(dir, 'UserPromptSubmit', { prompt: 'carry on with the plan, stop before deploy' });
  run(dir, 'Stop', { last_assistant_message: 'Tests pass. Shall I deploy now?',
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'dev server', command: 'npm run dev' }] });
  const t = handoffText(dir);
  assert.match(t, /saved because: reply finished/);
  assert.match(t, /\*\*Still running at cutoff:\*\* `npm run dev` \(started \d\d:\d\d, may have stopped\)/);
  assert.match(t, /\*\*Waiting on you:\*\* Claude asked: "Shall I deploy now\?"/);
  assert.match(t, /\*\*Your last request:\*\* "carry on with the plan, stop before deploy"/);
});

test('helpers between SubagentStart and SubagentStop are "still running"; an unpaired stop is ignored', () => {
  const dir = repo();
  editIn(dir, 'work.js'); // real work, so there is a handoff to keep
  run(dir, 'SubagentStop', { agent_id: 'zzzz', agent_type: 'internal' });
  run(dir, 'SubagentStart', { agent_id: 'h1', agent_type: 'Explore' });
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /helper Explore \(started \d\d:\d\d, may have stopped\)/);
  run(dir, 'SubagentStop', { agent_id: 'h1', agent_type: 'Explore' });
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /\*\*Still running at cutoff:\*\* nothing/);
});

test('d and e: PreCompact saves silently; SessionEnd stamps the end reason', () => {
  const dir = repo();
  editIn(dir, 'work.js');
  const r = run(dir, 'PreCompact', { trigger: 'auto' });
  assert.equal(r.stdout, '');
  assert.match(handoffText(dir), /saved because: before compaction/);
  run(dir, 'SessionEnd', { reason: 'logout' });
  assert.match(handoffText(dir).split('\n')[1], /session ended \d\d:\d\d \(logout\)/);
});

test('a checkbox plan file gives Task, Step n of m, Done and Next', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'plan.md'), '# Save as chart\n- [x] model\n- [x] migration\n- [ ] tests for the save route\n- [ ] button\n- [ ] docs\n');
  run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'docs', 'plan.md') } });
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, /\*\*Task:\*\* Save as chart/);
  assert.match(t, /\*\*Step:\*\* 3 of 5: tests for the save route/);
  assert.match(t, /\*\*Done:\*\* steps 1–2/);
  assert.match(t, /\*\*Next action:\*\* tests for the save route/);
});

test("Claude's notes appear with their time", () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'notes.md'), 'Task: Fix login\nWe agreed: keep the cookie format.');
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, /\*\*Task:\*\* Fix login/);
  assert.match(t, /\*\*Claude's notes \(\d\d:\d\d\):\*\* We agreed: keep the cookie format\./);
});

// ---- resume flow ----
const GROUND = 'JSPARK Forge grounding rule:';

test('startup with an open handoff: plain summary for the user, handoff + grounding + wait instruction for Claude', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Save as chart\n- [x] model\n- [ ] tests\n- [ ] button\n');
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'plan.md') } });
  run(dir, 'Stop', {});
  const r = run(dir, 'SessionStart', { source: 'startup' }, {});
  const o = out(r);
  assert.match(o.systemMessage, /JSPARK Forge: last time you were on "Save as chart", step 2 of 3\. Next: tests\. Say 'continue' or tell me what to do instead\./);
  const c = o.hookSpecificOutput.additionalContext;
  assert.ok(c.startsWith(GROUND), 'grounding rule comes first');
  assert.match(c, /# Where we were/);
  assert.match(c, /ending with 'Continue\?'/);
  assert.match(c, /If their first message is a new task, say in one line what was in progress \(parked\)/);
  assert.match(logText(dir), /GROUNDING/);
});

test('startup with no handoff: grounding rule only', () => {
  const dir = repo();
  const o = out(run(dir, 'SessionStart', { source: 'startup' }));
  assert.ok(!o.systemMessage);
  assert.ok(o.hookSpecificOutput.additionalContext.startsWith(GROUND));
  assert.ok(!/Where we were/.test(o.hookSpecificOutput.additionalContext));
});

test('a handoff 14 days or older is mentioned in one line, not shown', () => {
  const dir = repo();
  editIn(dir, 'work.js');
  run(dir, 'Stop', {});
  setMeta(dir, { savedAt: Date.now() - 20 * 24 * 3600 * 1000 });
  const o = out(run(dir, 'SessionStart', { source: 'startup' }));
  assert.match(o.systemMessage, /an old handoff from .+ exists \(\.jspark-forge\/handoff\.md\)/);
  assert.ok(!/Where we were/.test(o.hookSpecificOutput.additionalContext));
});

test('a different branch is pointed out to both', () => {
  const dir = repo();
  editIn(dir, 'work.js');
  run(dir, 'Stop', {});
  execFileSync('git', ['checkout', '-qb', 'other'], { cwd: dir });
  const o = out(run(dir, 'SessionStart', { source: 'resume' }));
  assert.match(o.systemMessage, /you are on branch other; the handoff was on main/);
  assert.match(o.hookSpecificOutput.additionalContext, /you are on branch other; the handoff was on main/);
});

test('compact: re-inject handoff with "carry on"; the notes reminder only after PreCompact', () => {
  const dir = repo();
  editIn(dir, 'work.js');
  run(dir, 'Stop', {});
  run(dir, 'PreCompact', { trigger: 'auto' });
  let c = ctxOf(run(dir, 'SessionStart', { source: 'compact' }));
  assert.ok(c.startsWith(GROUND));
  assert.match(c, /# Where we were/);
  assert.match(c, /carry on; no need to ask/);
  assert.match(c, /update your notes now in \.jspark-forge\/state\/notes\.md/);
  c = ctxOf(run(dir, 'SessionStart', { source: 'compact' }));
  assert.ok(!/update your notes now/.test(c), 'reminder is one-shot');
});

test('notes reminder rides on PreToolUse of a git commit; off when rules.md says notes: off', () => {
  const dir = repo();
  const c = ctxOf(run(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } }));
  assert.match(c, /JSPARK Forge: update your notes now in \.jspark-forge\/state\/notes\.md \(max 120 words/);
  assert.equal(run(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' } }).stdout, '');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Settings\n- notes: off\n');
  assert.equal(run(dir, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } }).stdout, '');
});

// ---- manual save and done ----
function cli(dir, args, cwd = dir) {
  return spawnSync(process.execPath, [FORGE, ...args], { cwd, encoding: 'utf8', input: '',
    env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PROJECT_DIR: '' }) });
}

test('manual save works from a subfolder and says so', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'src'));
  const r = cli(dir, ['save'], path.join(dir, 'src'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Handoff saved\. Next session, JSPARK Forge shows where you were\./);
  assert.match(handoffText(dir), /saved because: manual/);
});

test('done archives the handoff; the next startup shows nothing to resume', () => {
  const dir = repo();
  run(dir, 'UserPromptSubmit', { prompt: 'fix login' });
  run(dir, 'Stop', {});
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'notes.md'), 'Task: Fix login');
  const r = cli(dir, ['save', '--done']);
  assert.match(r.stdout, /Task closed/);
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md')));
  const arch = fs.readdirSync(path.join(dir, '.jspark-forge', 'archive'));
  assert.equal(arch.length, 1);
  assert.match(arch[0], /^handoff-\d{8}-\d{6}\.md$/);
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'state', 'notes.md')), 'notes start fresh');
  const o = out(run(dir, 'SessionStart', { source: 'startup' }));
  assert.ok(!o.systemMessage);
});

test('archives older than 30 days are deleted at SessionStart', () => {
  const dir = repo();
  const a = path.join(dir, '.jspark-forge', 'archive');
  fs.mkdirSync(a);
  fs.writeFileSync(path.join(a, 'handoff-20200101-000000.md'), 'old');
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(a, 'handoff-20200101-000000.md'), old, old);
  run(dir, 'SessionStart', { source: 'startup' });
  assert.deepEqual(fs.readdirSync(a), []);
});

test('the save writes nothing outside .jspark-forge/', () => {
  const dir = repo();
  editIn(dir, 'x.ts');
  run(dir, 'Stop', {});
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
  for (const line of status.split('\n').filter(Boolean)) assert.match(line, /\.jspark-forge\//);
});

test("recent actions leave out JSPARK Forge's own files", () => {
  const dir = repo();
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.jspark-forge', 'state', 'notes.md') } });
  run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  run(dir, 'Stop', {});
  const recent = handoffText(dir).match(/\*\*Recent actions:\*\* (.*)$/m)[1];
  assert.match(recent, /\d\d:\d\d edited app\.js/);
  assert.ok(!/jspark-forge/.test(recent));
});

test('SessionEnd keeps the reason of the last real save', () => {
  const dir = repo();
  editIn(dir, 'work.js');
  run(dir, 'Stop', {});
  run(dir, 'SessionEnd', { reason: 'logout' });
  const head = handoffText(dir).split('\n')[1];
  assert.match(head, /saved because: reply finished/);
  assert.match(head, /session ended \d\d:\d\d \(logout\)/);
});

// ---- superpowers ledger (owner 2026-11-19) ----
function spPlan(dir) {
  const rel = 'docs/superpowers/plans/2026-11-19-greet.md';
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), '# Greet Implementation Plan\n\n### Task 1: Greet function\n- [ ] **Step 1: test**\n\n### Task 2: CLI flag\n- [ ] **Step 1: test**\n\n### Task 3: README\n- [ ] **Step 1: docs**\n');
  const led = path.join(dir, '.superpowers', 'sdd', '2026-11-19-greet', 'progress.md');
  fs.mkdirSync(path.dirname(led), { recursive: true });
  fs.writeFileSync(led, `# SDD ledger — plan: ${rel}\nTask 1: complete (commits a..b, review clean)\n`);
  return { rel, led };
}

test('a superpowers plan reads progress from its ledger', () => {
  const dir = repo();
  const { rel } = spPlan(dir);
  run(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, rel) } });
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, /\*\*Task:\*\* Greet Implementation Plan/);
  assert.match(t, /\*\*Step:\*\* 2 of 3: Task 2: CLI flag/);
  assert.match(t, /\*\*Done:\*\* step 1/);
});

test('with no plan touched this session, the newest ledger names the plan', () => {
  const dir = repo();
  spPlan(dir);
  run(dir, 'Stop', {});
  assert.match(handoffText(dir), /\*\*Step:\*\* 2 of 3: Task 2: CLI flag/);
});

test('ledger writes save but are not listed as files touched', () => {
  const dir = repo();
  const { led } = spPlan(dir);
  run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: led } });
  run(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  run(dir, 'Stop', {});
  const files = handoffText(dir).match(/\*\*Files touched in this task:\*\* (.*)$/m)[1];
  assert.equal(files, 'app.js');
});

// ---- found in the owner's manual check, 2026-11-19: a closed task came back as Task "hi" ----
const hasHandoff = dir => fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md'));

test('a session with no work (only talk) leaves no handoff', () => {
  const dir = repo();
  run(dir, 'UserPromptSubmit', { prompt: 'hi' });
  run(dir, 'Stop', { last_assistant_message: 'Hello! What shall we do?' });
  assert.ok(!hasHandoff(dir));
  const o = out(run(dir, 'SessionStart', { source: 'startup' }));
  assert.ok(!o.systemMessage, 'nothing to resume');
});

test('after done, the next reply does not reopen the task; new work starts a new one', () => {
  const dir = repo();
  run(dir, 'UserPromptSubmit', { prompt: 'hi' });
  editIn(dir, 'x.js');
  run(dir, 'Stop', {});
  cli(dir, ['save', '--done']);
  run(dir, 'Stop', {});
  assert.ok(!hasHandoff(dir), 'closed task stays closed');
  run(dir, 'UserPromptSubmit', { prompt: 'add a logout button' });
  run(dir, 'Stop', {});
  assert.ok(!hasHandoff(dir), 'a request alone is not work yet');
  editIn(dir, 'logout.js');
  run(dir, 'Stop', {});
  const t = handoffText(dir);
  assert.match(t, /\*\*Task:\*\* add a logout button/);
  assert.match(t, /\*\*Files touched in this task:\*\* logout\.js$/m);
});

test('after done, an older superpowers ledger does not revive the closed plan', () => {
  const dir = repo();
  spPlan(dir);
  run(dir, 'Stop', {});
  assert.ok(hasHandoff(dir));
  cli(dir, ['save', '--done']);
  run(dir, 'Stop', {});
  assert.ok(!hasHandoff(dir));
});

test('a manual save always writes, even with no work yet', () => {
  const dir = repo();
  cli(dir, ['save']);
  assert.ok(hasHandoff(dir));
});

// ---- v0.1.1: PowerShell forms of save trigger a (file writes) and b (commits) ----
const psRun = (dir, command) => run(dir, 'PostToolUse', { tool_name: 'PowerShell', tool_input: { command } });

test('PowerShell writes into the project save the handoff: Set-Content, Out-File, > redirect', () => {
  for (const cmd of ["Set-Content -Path notes.txt -Value 'hi'", "'x' | Out-File -FilePath out.txt", "'x' > redirected.txt"]) {
    const dir = repo();
    psRun(dir, cmd);
    const name = cmd.match(/(\w+\.txt)/)[1];
    const files = handoffText(dir).match(/\*\*Files touched in this task:\*\* (.*)$/m);
    assert.ok(files && files[1].split(', ').includes(name), `${cmd}: ${files && files[1]}`);
  }
});

test('PowerShell reads, $null redirects and backslash paths outside the project do not count as writes', () => {
  const dir = repo();
  psRun(dir, 'Get-Content a.txt');
  psRun(dir, "'x' > $null");
  psRun(dir, "Set-Content -Path ..\elsewhere.txt -Value 'x'");
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'handoff.md')));
});

test('a git commit run from PowerShell saves with the new HEAD and logs COMMIT', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  execFileSync('git', ['add', 'c.txt'], { cwd: dir }); execFileSync('git', ['commit', '-qm', 'from powershell'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  psRun(dir, "git add c.txt; git commit -m 'from powershell'");
  assert.match(logText(dir), new RegExp(`COMMIT ${sha} from powershell`));
});

test('the notes reminder also rides on a git commit run from PowerShell', () => {
  const dir = repo();
  const c = ctxOf(run(dir, 'PreToolUse', { tool_name: 'PowerShell', tool_input: { command: "git commit -m 'x'" } }));
  assert.match(c, /update your notes now/);
});

// ---- G1: skills ask the script where things are (guest mode will move them out of the repo) ----
test('forge.js show prints the handoff; forge.js where prints the notes and handoff paths', () => {
  const dir = repo();
  editIn(dir, 'w.js');
  run(dir, 'Stop', {});
  const show = cli(dir, ['show']);
  assert.match(show.stdout, /^# Where we were/);
  const where = JSON.parse(cli(dir, ['where']).stdout);
  assert.equal(path.resolve(where.notes), path.join(dir, '.jspark-forge', 'state', 'notes.md'));
  assert.equal(path.resolve(where.handoff), path.join(dir, '.jspark-forge', 'handoff.md'));
});

test('forge.js show says so when there is no handoff yet', () => {
  assert.match(cli(repo(), ['show']).stdout, /No handoff saved yet in this project/);
});
