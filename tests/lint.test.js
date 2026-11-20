'use strict';
// Design v0.2 section 3: skill and brief templates, lint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lintSkill, lintBrief } = require('../scripts/lib/lint');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const msgs = errs => errs.map(e => e.message).join(' | ');

const GOOD_SKILL = [
  '---', 'name: demo', 'description: Use when asked to demo.', '---',
  '1. Input: a path. Action: read it. Output: notes.',
  '2. Verify: the file exists.', '   Evidence: the path.', ''].join('\n');
const GOOD_BRIEF = [
  'Goal: make it idempotent.', 'CAN change: src/**', 'CANNOT change: package.json', 'Done: tests pass',
  'Retries: 2, then log and skip', 'Stop: after 3 attempts; hand back', 'Outputs: commit, test_totals', ''].join('\n');

test('skill: a good skill passes and errors carry file and line', () => {
  assert.deepEqual(lintSkill(GOOD_SKILL, 'a.md'), []);
  const e = lintSkill(GOOD_SKILL.replace('name: demo\n', ''), 'a.md');
  assert.equal(e.length, 1);
  assert.equal(e[0].file, 'a.md');
  assert.equal(typeof e[0].line, 'number');
  assert.match(e[0].message, /name/);
});

test('skill: missing frontmatter fails', () => {
  assert.match(msgs(lintSkill('1. Input: a. Action: b. Output: c.\n', 'a.md')), /frontmatter/);
});

test('skill: description must start with "Use when"', () => {
  assert.match(msgs(lintSkill(GOOD_SKILL.replace('Use when asked', 'Helps when asked'), 'a.md')), /Use when/);
  assert.match(msgs(lintSkill(GOOD_SKILL.replace(/description: .*\n/, ''), 'a.md')), /description/);
});

test('skill: a plain skill without Input parts needs only name and description', () => {
  const t = '---\nname: x\ndescription: Use when x.\n---\n1. Run the thing.\n2. Say done.\n';
  assert.deepEqual(lintSkill(t, 'a.md'), []);
});

test('skill: in template shape every part needs Input, Action and Output', () => {
  for (const missing of ['Input:', 'Action:', 'Output:']) {
    const bad = GOOD_SKILL.replace('1. Input: a path. Action: read it. Output: notes.',
      '1. Input: a path. Action: read it. Output: notes.\n2. Input: a. Action: b. Output: c.'.replace(missing, 'X:'));
    const e = lintSkill(bad, 'a.md');
    assert.ok(e.some(x => x.message.includes(missing)), `${missing}: ${msgs(e)}`);
    assert.ok(e.every(x => x.line > 4));
  }
});

test('skill: a Verify part with Evidence is required; Evidence cannot be missing', () => {
  const noVerify = GOOD_SKILL.split('\n').slice(0, 5).join('\n') + '\n';
  assert.match(msgs(lintSkill(noVerify, 'a.md')), /Verify:/);
  assert.match(msgs(lintSkill(GOOD_SKILL.replace('   Evidence: the path.\n', ''), 'a.md')), /Evidence:/);
});

test('skill: HTML comments are ignored', () => {
  const t = GOOD_SKILL.replace('1. Input', '<!-- 9. Input: Action: Output: -->\n1. Input');
  assert.deepEqual(lintSkill(t, 'a.md'), []);
});

test('brief: a good brief passes; Setup, Log, Tie-break are optional', () => {
  assert.deepEqual(lintBrief(GOOD_BRIEF, 'b.md'), []);
});

test('brief: each required field is checked for presence and non-empty', () => {
  for (const f of ['Goal', 'CAN change', 'CANNOT change', 'Done', 'Stop']) {
    const lines = GOOD_BRIEF.split('\n');
    const gone = lines.filter(l => !l.startsWith(`${f}:`)).join('\n');
    assert.match(msgs(lintBrief(gone, 'b.md')), new RegExp(f), `${f} missing`);
    const empty = lines.map(l => (l.startsWith(`${f}:`) ? `${f}:   ` : l)).join('\n');
    const e = lintBrief(empty, 'b.md');
    assert.match(msgs(e), new RegExp(f), `${f} empty`);
    assert.ok(e[0].line >= 1);
  }
});

test('brief: Retries must be a number', () => {
  assert.deepEqual(lintBrief(GOOD_BRIEF.replace('Retries: 2, then', 'Retries: 3, then'), 'b.md'), []);
  assert.match(msgs(lintBrief(GOOD_BRIEF.replace('Retries: 2', 'Retries: a few'), 'b.md')), /Retries/);
});

test('brief: Outputs must be a comma list of names', () => {
  assert.deepEqual(lintBrief(GOOD_BRIEF.replace('commit, test_totals', 'commit'), 'b.md'), []);
  assert.match(msgs(lintBrief(GOOD_BRIEF.replace('commit, test_totals', 'the commit and totals'), 'b.md')), /Outputs/);
  assert.match(msgs(lintBrief(GOOD_BRIEF.replace('commit, test_totals', 'commit,, x'), 'b.md')), /Outputs/);
});

test('brief: Stop must not be "never"', () => {
  assert.match(msgs(lintBrief(GOOD_BRIEF.replace('after 3 attempts; hand back', 'never stop'), 'b.md')), /Stop/);
  assert.match(msgs(lintBrief(GOOD_BRIEF.replace('after 3 attempts; hand back', 'never'), 'b.md')), /Stop/);
});

test('brief: HTML comments are ignored', () => {
  assert.deepEqual(lintBrief('<!-- Goal: x -->\n' + GOOD_BRIEF, 'b.md'), []);
});

test('templates pass their own lint and name every field', () => {
  assert.deepEqual(lintSkill(read('templates', 'skill.md'), 'templates/skill.md'), []);
  assert.deepEqual(lintBrief(read('templates', 'brief.md'), 'templates/brief.md'), []);
  const b = read('templates', 'brief.md');
  for (const f of ['Goal', 'CAN change', 'CANNOT change', 'Done', 'Setup', 'Log', 'Retries', 'Tie-break', 'Stop', 'Outputs']) {
    assert.match(b, new RegExp(`^${f}:`, 'm'), f);
  }
  assert.doesNotMatch(read('templates', 'skill.md') + b, /(?<!JSPARK )Forge/);
});

test("JSPARK Forge's own skills pass the lint", () => {
  const dir = path.join(ROOT, 'skills');
  const names = fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'SKILL.md')));
  assert.ok(names.length >= 10);
  for (const n of names) {
    const f = path.join('skills', n, 'SKILL.md');
    assert.deepEqual(lintSkill(read(f), f), [], n);
  }
  assert.ok(names.includes('new-skill') && names.includes('new-brief'));
});

test('new-skill and new-brief copy the template, never overwrite, then lint', () => {
  for (const [n, tpl, dest] of [['new-skill', 'templates/skill.md', 'skills/<name>/SKILL.md'],
    ['new-brief', 'templates/brief.md', '.jspark-forge/briefs/<name>.md']]) {
    const t = read('skills', n, 'SKILL.md');
    assert.ok(t.includes('${CLAUDE_PLUGIN_ROOT}/' + tpl), n);
    assert.ok(t.includes(dest), n);
    assert.match(t, /already exists/);
    assert.match(t, /Never\s+overwrite/);
    assert.match(t, /forge\.js" lint /);
  }
});

function run(args, cwd) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-lint-cfg-'));
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'forge.js'), 'lint', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: '' } });
}

test('forge.js lint: ok lines for good files, file:line for bad ones, and a count', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-lint-'));
  fs.writeFileSync(path.join(d, 'good.md'), GOOD_BRIEF);
  fs.writeFileSync(path.join(d, 'bad.md'), GOOD_BRIEF.replace('Done: tests pass\n', ''));
  fs.mkdirSync(path.join(d, 's'));
  fs.writeFileSync(path.join(d, 's', 'SKILL.md'), GOOD_SKILL);
  const ok = run([path.join(d, 'good.md'), path.join(d, 's', 'SKILL.md')], d);
  assert.match(ok.stdout, /^ok .*good\.md$/m);
  assert.match(ok.stdout, /^ok .*SKILL\.md$/m);
  assert.match(ok.stdout, /2 files ok/);
  const bad = run([path.join(d, 'bad.md')], d);
  assert.match(bad.stdout, /bad\.md:\d+: .*Done/);
  assert.match(bad.stdout, /1 problem/);
  assert.notEqual(bad.status, 0);
});

test('forge.js lint with no paths lints the project skills and briefs', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-lintp-'));
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, 'skills', 'x'), { recursive: true });
  fs.mkdirSync(path.join(d, '.jspark-forge', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(d, 'skills', 'x', 'SKILL.md'), GOOD_SKILL);
  fs.writeFileSync(path.join(d, '.jspark-forge', 'briefs', 'j.md'), GOOD_BRIEF);
  const r = run([], d);
  assert.match(r.stdout, /2 files ok/);
});
