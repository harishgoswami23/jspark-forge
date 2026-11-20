'use strict';
// v0.5.1 gaps, item 8 (spec 134, 352): lasting lessons are offered at "done"; `decide --promote <id>` prints the rules.md
// line that would make a decision a hard block (it never edits rules.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { parseRules } = require('../scripts/lib/rules');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-less-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', '.gitignore'), '*\n!.gitignore\n!rules.md\n');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), '## Confirm\n\n## Never\n');
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const decide = (dir, args, json) => {
  if (json) fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify(json));
  return spawnSync(process.execPath, [FORGE, 'decide', ...(json ? ['--from', '.jspark-forge/state/decide.json'] : []), ...args],
    { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'ls-1' }) }).stdout;
};
const skill = n => fs.readFileSync(path.join(ROOT, 'skills', n, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
const ruleLine = out => out.split('\n').find(l => l.startsWith('- `'));

test('decide --promote prints one valid rules.md line for the decision and changes no file', () => {
  const dir = project();
  decide(dir, [], { title: 'Never edit generated files', touches: ['src/generated/**'], why: 'they are rebuilt' });
  const before = fs.readFileSync(path.join(dir, '.jspark-forge', 'rules.md'), 'utf8');
  const decisionsBefore = fs.readFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), 'utf8');
  const out = decide(dir, ['--promote', 'D-001']);
  assert.match(out, /"## Never" in \.jspark-forge\/rules\.md/);
  assert.match(out, /does not edit rules\.md/);
  const line = ruleLine(out);
  assert.equal(line, '- `src/generated/` : D-001 Never edit generated files');
  const r = parseRules(`## Never\n${line}\n`);
  assert.equal(r.errors.length, 0);
  assert.equal(r.never.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', 'rules.md'), 'utf8'), before, 'rules.md untouched');
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), 'utf8'), decisionsBefore);
});

test('decide --promote: a decision with no files gets a placeholder to fill in; backticks never break the line', () => {
  const dir = project();
  decide(dir, [], { title: 'No `rm` on the data folder', why: 'x' });
  const line = ruleLine(decide(dir, ['--promote', 'D-001']));
  assert.match(line, /^- `<the command or text to block>` : D-001 No rm on the data folder$/);
  assert.equal(parseRules(`## Never\n${line}\n`).errors.length, 0);
});

test('decide --promote: an unknown id, a bad id and a guest repo say so', () => {
  const dir = project();
  assert.match(decide(dir, ['--promote', 'D-009']), /There is no D-009/);
  assert.match(decide(dir, ['--promote', 'nope']), /id must look like D-012/);
  assert.match(decide(dir, ['--promote']), /id must look like D-012/);
});

test('the decide skill mentions --promote and that the user adds the rule', () => {
  const s = skill('decide');
  assert.match(s, /decide --promote D-012/);
  assert.match(s, /hard block/);
  assert.match(s, /does not edit rules\.md|never edit rules\.md|you do not edit rules\.md/i);
});

test('the handoff skill offers once, on "done" and before closing, to record lasting lessons as decisions', () => {
  const s = skill('handoff');
  const done = s.indexOf('save --done');
  const offer = s.search(/offer once[^.]*lessons?/i);
  assert.ok(offer >= 0, 'has the offer');
  assert.ok(offer < done, 'the offer comes before the closing command');
  assert.match(s, /\/jspark-forge:decide/);
  assert.match(s, /only after the user says yes/i);
});
