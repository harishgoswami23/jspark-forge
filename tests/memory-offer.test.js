'use strict';
// v0.2 decision memory, offering to record (design-v0.2 1.4) and stale flags (1.5): after a commit that may have
// settled a choice, the main conversation is asked to offer "Record the decision?" at the end of its work; never
// in helpers, never unattended, never at 95 % usage; filtered mechanically; shown once (twice until 2026-11-22).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project(decisions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-offer-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', '.gitignore'), '*\n!.gitignore\n!rules.md\n!decisions.md\n');
  require('../scripts/lib/paths').markOwn(dir);
  if (decisions) fs.writeFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), decisions);
  return dir;
}
function commit(dir, files, subject) {
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', subject], { cwd: dir, stdio: 'ignore' });
}
const hook = (dir, event, input = {}, env = {}) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 'off-1', cwd: dir, source: 'startup' }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ATTENDED: '1' }, env) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const ctxOf = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';
const committed = (dir, extra = {}, env = {}) => hook(dir, 'PostToolUse', Object.assign({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, extra), env);

test('a commit that may have settled a choice: the offer arrives once in this turn, with sha, subject and files', () => {
  const dir = project();
  commit(dir, { 'src/billing/total.ts': 'cents' }, 'Store prices in cents');
  const c = ctxOf(committed(dir));
  assert.match(c, /commits that may have settled a choice: [0-9a-f]{7} 'Store prices in cents' \(src\/billing\/total\.ts\)/);
  assert.match(c, /Record the decision\?/);
  assert.match(c, /Record only after the user says yes or gives an edit/);
  assert.equal(ctxOf(hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'a.ts') } })), '', 'once per turn');
});

// Changed on 2026-11-22 (owner): the offer came back at the next message, and Claude asked again each time.
test('an offer is shown once: it does not come back at the next message', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Use signed cookies for sessions');
  const first = ctxOf(committed(dir));
  assert.match(first, /signed cookies/);
  assert.match(first, /Offer once/, 'and Claude is told not to ask again');
  assert.ok(!/signed cookies/.test(ctxOf(hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' }))), 'not repeated');
  assert.ok(!/signed cookies/.test(ctxOf(hook(dir, 'UserPromptSubmit', { prompt: 'and then write the tests for the export' }))));
});

test('Claude can mark a commit as "no decision here" without asking the user', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Fix the off-by-one in paging');
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const offer = ctxOf(committed(dir));
  assert.match(offer, /settled no choice[\s\S]*do not ask the user[\s\S]*"none": \["/);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify({ none: [sha] }));
  const out = spawnSync(process.execPath, [FORGE, 'decide', '--from', '.jspark-forge/state/decide.json'], { cwd: dir, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'off-1' }) }).stdout;
  assert.match(out, new RegExp(`No decision in ${sha}: nothing recorded, and nothing to ask the user`));
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'decisions.md')), 'nothing was written to decisions.md');
  assert.equal((require('../scripts/lib/state').readSession(dir, 'off-1').offers || []).length, 0, 'the offer is settled');
});

test('filtered mechanically: docs-only, lockfiles, chore/docs/bump/merge subjects get no offer', () => {
  for (const [files, subject] of [[{ 'docs/guide.md': 'x' }, 'Explain setup'], [{ 'package-lock.json': '{}' }, 'Update deps'],
    [{ 'src/a.ts': '1' }, 'chore: tidy'], [{ 'src/b.ts': '1' }, 'docs(api): typo'], [{ 'src/c.ts': '1' }, 'bump version'],
    [{ 'src/d.ts': '1' }, 'Merge branch dev'], [{ 'src/e.ts': '1' }, 'Revert "x"']]) {
    const dir = project();
    commit(dir, files, subject);
    assert.ok(!/Record the decision/.test(ctxOf(committed(dir))), subject);
  }
});

test('never in a helper (its reply goes to the main conversation, not the user); the main conversation gets it', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Cache results for an hour');
  assert.ok(!/Record the decision/.test(ctxOf(committed(dir, { agent_id: 'helper-1' }))), 'not in the helper');
  assert.match(ctxOf(hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'b.ts') } })), /Cache results for an hour/);
});

test('never unattended (headless runs), and nothing when decision memory is off', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Retry payments three times');
  assert.ok(!/Record the decision/.test(ctxOf(committed(dir, {}, { CLAUDE_CODE_SESSION_ATTENDED: '0' }))));
});

test('a superpowers plan or design doc written: one offer per file', () => {
  const dir = project();
  const plan = path.join(dir, 'docs', 'superpowers', 'plans', '2026-11-20-billing.md');
  fs.mkdirSync(path.dirname(plan), { recursive: true }); fs.writeFileSync(plan, '# Plan\n');
  const w = () => ctxOf(hook(dir, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: plan } }));
  assert.match(w(), /plan docs\/superpowers\/plans\/2026-11-20-billing\.md/);
  hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' });
  hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' });
  assert.ok(!/2026-11-20-billing/.test(w()), 'the same plan file is offered once');
});

const OLD = (id, title, touches, verified) => `## ${id} ${title}\n- Kind: decision\n- Date: ${verified}\n- Last verified: ${verified}\n- Touches: ${touches}\n- Status: active\n\n`;
test('stale flag: a commit changing a touched file flags an entry verified over 14 days ago, once a day, at most 2', () => {
  const dir = project(OLD('D-001', 'Prices in cents', 'src/billing/**', '2026-01-01') + OLD('D-002', 'Totals rounded once', 'src/billing/**', '2026-01-01') +
    OLD('D-003', 'Refunds in cents', 'src/billing/**', '2026-01-01') + OLD('D-004', 'Fresh one', 'src/billing/**', new Date().toISOString().slice(0, 10)));
  commit(dir, { 'src/billing/total.ts': '2' }, 'chore: rename variable');
  const c = ctxOf(committed(dir));
  const flagged = [...c.matchAll(/(D-00\d) may be stale/g)].map(m => m[1]);
  assert.equal(flagged.length, 2, c);
  assert.ok(!flagged.includes('D-004'), 'recently verified: not flagged');
  assert.match(c, /still valid\? \(yes \/ update \/ retire\)/);
  commit(dir, { 'src/billing/total.ts': '3' }, 'chore: again');
  hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' }); hook(dir, 'UserPromptSubmit', { prompt: 'then make the totals round the same way' });
  const again = ctxOf(committed(dir));
  for (const id of flagged) assert.ok(!new RegExp(`${id} may be stale`).test(again), `${id} not flagged twice in a day`);
});

test('recording a decision drops its offer', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Use UTC everywhere');
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  committed(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify({ title: 'Use UTC everywhere', touches: ['src/**'], source: `commit ${sha}` }));
  spawnSync(process.execPath, [FORGE, 'decide', '--from', '.jspark-forge/state/decide.json'], { cwd: dir, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'off-1' }) });
  assert.ok(!/Use UTC everywhere/.test(ctxOf(hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' }))));
});

test('review (low): a short answer ("yes", "skip") does not bring the offer back with it', () => {
  const dir = project();
  commit(dir, { 'src/a.ts': '1' }, 'Keep sessions for 30 days');
  assert.match(ctxOf(committed(dir)), /30 days/);
  assert.ok(!/30 days/.test(ctxOf(hook(dir, 'UserPromptSubmit', { prompt: 'yes' }))));
});

// Spike E (design-v0.2 1.10, run 2026-11-20): approving a plan fires PostToolUse for ExitPlanMode with tool_input {}
// and the plan in tool_response.plan (filePath under ~/.claude/plans, outside the project).
const approved = (dir, plan, extra = {}) => hook(dir, 'PostToolUse', Object.assign({ tool_name: 'ExitPlanMode', tool_input: {},
  permission_mode: 'auto', tool_response: { plan, isAgent: false, filePath: path.join(os.homedir(), '.claude', 'plans', 'lazy-dove.md') } }, extra));
const PLAN = '# Plan: Store prices in cents\n\n## Steps\n1. Change src/price.js.\n2. Test it.\n';

test('spike E: an approved plan (ExitPlanMode) brings one offer, named by the plan title', () => {
  const dir = project();
  const c = ctxOf(approved(dir, PLAN));
  assert.match(c, /the plan just approved \("Plan: Store prices in cents"\) may hold decisions/);
  assert.match(c, /Record the decision\?/);
  assert.match(c, /"source": "plan approved/);
  hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' });
  hook(dir, 'UserPromptSubmit', { prompt: 'now add the export button to the report page' });
  assert.ok(!/Store prices in cents/.test(ctxOf(approved(dir, PLAN))), 'the same plan is offered once');
  assert.match(ctxOf(approved(dir, PLAN.replace('cents', 'paise'))), /Store prices in paise/, 'a changed plan is a new offer');
});

test('spike E: no offer for an empty plan, in a helper, or unattended', () => {
  assert.equal(ctxOf(approved(project(), '   ')), '');
  assert.equal(ctxOf(approved(project(), PLAN, { agent_id: 'a1' })), '');
  const dir = project();
  const r = hook(dir, 'PostToolUse', { tool_name: 'ExitPlanMode', tool_input: {}, tool_response: { plan: PLAN } }, { CLAUDE_CODE_SESSION_ATTENDED: '' });
  assert.equal(ctxOf(r), '');
});

test('spike E: the PostToolUse matcher includes ExitPlanMode', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.PostToolUse.some(h => new RegExp(`^(${h.matcher})$`).test('ExitPlanMode')));
});
