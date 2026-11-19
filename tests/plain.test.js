'use strict';
// Design v0.2 section 3: JSPARK-FORGE.md is generated; the committed copy must match.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../scripts/build-plain');

const ROOT = path.join(__dirname, '..');

test('JSPARK-FORGE.md is up to date (run: node scripts/build-plain.js)', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'JSPARK-FORGE.md'), 'utf8');
  assert.equal(committed, build(ROOT));
});

test('the plain file carries the grounding rule, every block id with its words, and both templates', () => {
  const t = build(ROOT);
  const g = fs.readFileSync(path.join(ROOT, 'rules', 'grounding.md'), 'utf8').trim();
  assert.ok(t.includes(g));
  const bl = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'default-blocklist.json'), 'utf8'));
  for (const [id, e] of Object.entries(bl)) {
    assert.ok(t.includes(id), id);
    assert.ok(t.includes(e.plain), id);
  }
  for (const f of ['skill.md', 'brief.md']) {
    assert.ok(t.includes(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8').trim()), f);
  }
  assert.doesNotMatch(t, /(?<!JSPARK )Forge\b/);
});

test('the model map is included when rules/model-tiers.json exists and skipped when absent', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jf-plain-'));
  fs.cpSync(path.join(ROOT, 'rules'), path.join(tmp, 'rules'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates'), path.join(tmp, 'templates'), { recursive: true });
  fs.rmSync(path.join(tmp, 'rules', 'model-tiers.json'), { force: true });
  assert.doesNotMatch(build(tmp), /strongest/);
  fs.writeFileSync(path.join(tmp, 'rules', 'model-tiers.json'),
    JSON.stringify({ strongest: 'fable', standard: 'sonnet', light: 'haiku' }));
  const t = build(tmp);
  assert.match(t, /strongest.*fable/);
  assert.match(t, /light.*haiku/);
});
