'use strict';
// v0.5.1 gaps 4: graph templates keep `run: npm test` (still valid graphs) but tell the reader to set the project's own
// test command and say that builders commit on the current branch; the build skill says the same to Claude.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, validate } = require('../scripts/lib/graph');

const DIR = path.join(__dirname, '..', 'templates', 'graphs');
const GATE_NOTE = "<!-- Set this to the project's own test command (pnpm test, yarn test, pytest, go test ./..., …) before you trust the graph. -->";
const COMMIT_SENTENCE = "Builders commit their step's work on the current branch (no merge, no push): the review step needs those commits.";

test('gap 4: every template says builders commit on the current branch, in its header comment', () => {
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    const open = t.indexOf('<!--');
    const close = t.indexOf('-->', open);
    assert.ok(open >= 0 && close > open, `${f}: has a header comment`);
    assert.ok(t.slice(open, close).includes(COMMIT_SENTENCE), `${f}: header sentence`);
    assert.ok(t.slice(0, open).split('\n').length <= 4, `${f}: it is the header comment`);
  }
});

test('gap 4: the line directly above each gate step is the test-command comment, and the template stays a valid graph', () => {
  let gates = 0;
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    const lines = t.split('\n');
    lines.forEach((l, i) => {
      if (/^## .*\(gate\)\s*$/.test(l)) { gates++; assert.equal(lines[i - 1], GATE_NOTE, `${f}: gate at line ${i + 1}`); }
    });
    const g = parse(t);
    assert.deepEqual(validate(g), [], f);
  }
  assert.ok(gates >= 4, 'planned, software, spike and ui each have a gate');
  assert.match(fs.readFileSync(path.join(DIR, 'software.md'), 'utf8'), /^- run: npm test$/m, 'npm test stays as the placeholder');
});

test('gap 4: the build skill tells Claude to set the real commands and to say builders commit', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'skills', 'build', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(s, /every `run:` line/);
  assert.match(s, /package\.json/);
  assert.match(s, /lock file/);
  assert.match(s, /npm, pnpm or yarn/);
  assert.match(s, /each build brief/);
  assert.match(s, /commits? (its|their) (step's )?work on the current branch/);
});
