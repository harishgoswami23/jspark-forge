'use strict';
// v0.2 decision memory (design-v0.2 section 1.1, 1.2): the decisions.md reader/writer and Touches: matching.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, addEntry, setField, matches, nextId, words } = require('../scripts/lib/decisions');

const SAMPLE = `# Decisions

Notes the team keeps by hand stay exactly as written.

## D-012 Prices are stored in cents
- Kind: decision
- Why: avoids rounding errors in totals and refunds
- Decided by: you (drafted by Claude)
- Date: 2026-11-02 · Last verified: 2026-11-02
- Touches: src/billing/**, src/models/price.ts
- Source: commit 3f2e1d0 · plan docs/plans/billing.md
- Status: active

## D-013 Read the schema before changing the data model
- Kind: reference
- See: prisma/schema.prisma
- Touches: prisma/**, src/db
- Status: active
- Owner note: kept as written

## D-014 Old rule
- Kind: rule
- Status: retired
`;

test('parse: fields, kinds, touches, status; unknown fields kept', () => {
  const r = parse(SAMPLE);
  assert.equal(r.errors.length, 0);
  assert.equal(r.entries.length, 3);
  const [a, b, c] = r.entries;
  assert.equal(a.id, 'D-012');
  assert.equal(a.title, 'Prices are stored in cents');
  assert.equal(a.kind, 'decision');
  assert.equal(a.why, 'avoids rounding errors in totals and refunds');
  assert.deepEqual(a.touches, ['src/billing/**', 'src/models/price.ts']);
  assert.equal(a.date, '2026-11-02');
  assert.equal(a.lastVerified, '2026-11-02');
  assert.equal(a.status, 'active');
  assert.equal(b.kind, 'reference');
  assert.equal(b.see, 'prisma/schema.prisma');
  assert.equal(b.fields['owner note'], 'kept as written');
  assert.equal(c.status, 'retired');
  assert.equal(c.active, false);
  assert.equal(a.active, true);
});

test('parse: a malformed heading or unknown kind is reported with its line number and skipped', () => {
  const r = parse('## D-1 too short id\n- Kind: decision\n\n## D-002 Fine\n- Kind: wish\n\n## D-003 Good\n- Kind: lesson\n');
  assert.deepEqual(r.errors.map(e => e.line), [1, 5]);
  assert.deepEqual(r.entries.map(e => e.id), ['D-003']);
});

test('addEntry appends a new entry with the next id and keeps every other byte', () => {
  const out = addEntry(SAMPLE, { title: 'Sessions use signed cookies', why: 'no server store', touches: ['src/auth.ts'], kind: 'decision',
    by: 'you (drafted by Claude)', source: 'commit abc1234', date: '2026-11-20' });
  assert.ok(out.text.startsWith(SAMPLE.trimEnd()), 'old text unchanged');
  assert.equal(out.id, 'D-015');
  const e = parse(out.text).entries.find(x => x.id === 'D-015');
  assert.equal(e.title, 'Sessions use signed cookies');
  assert.deepEqual(e.touches, ['src/auth.ts']);
  assert.equal(e.lastVerified, '2026-11-20');
  assert.equal(e.status, 'active');
});

test('ids are never reused: the next id is one past the highest ever written, retired ones included', () => {
  assert.equal(nextId(SAMPLE), 'D-015');
  assert.equal(nextId(''), 'D-001');
  assert.equal(nextId('## D-099 x\n- Status: retired\n'), 'D-100');
});

test('setField changes one field of one entry and nothing else (adds it when missing)', () => {
  const v = setField(SAMPLE, 'D-012', 'Last verified', '2026-11-20');
  assert.equal(parse(v).entries[0].lastVerified, '2026-11-20');
  assert.equal(parse(v).entries[0].date, '2026-11-02', 'Date on the same line kept');
  assert.equal(v.replace('Last verified: 2026-11-20', 'Last verified: 2026-11-02'), SAMPLE);
  const r = setField(SAMPLE, 'D-013', 'Status', 'superseded by D-015');
  assert.equal(parse(r).entries[1].status, 'superseded by D-015');
  assert.equal(parse(r).entries[1].active, false);
  const added = setField(SAMPLE, 'D-013', 'Last verified', '2026-11-20');
  assert.equal(parse(added).entries[1].lastVerified, '2026-11-20');
  assert.equal(parse(added).entries[1].fields['owner note'], 'kept as written');
  assert.throws(() => setField(SAMPLE, 'D-999', 'Status', 'retired'), /D-999/);
});

test('CRLF files are read and written in their own line endings', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  assert.equal(parse(crlf).entries.length, 3);
  const v = setField(crlf, 'D-012', 'Status', 'retired');
  assert.ok(!/[^\r]\n/.test(v), 'no bare LF introduced');
  const a = addEntry(crlf, { title: 'X', touches: [], kind: 'rule', date: '2026-11-20' });
  assert.ok(!/[^\r]\n/.test(a.text), 'no bare LF introduced');
});

test('a new entry writes Last verified on its own line (no merge conflicts with the Date line)', () => {
  const a = addEntry('', { title: 'X', touches: ['a.ts'], kind: 'rule', date: '2026-11-20' });
  assert.match(a.text, /^- Date: 2026-11-20\n- Last verified: 2026-11-20$/m);
});

test('"|" separates fields like "·"; a byte-order mark and a missing final newline are kept', () => {
  const t = '﻿## D-001 Use UTC everywhere\n- Kind: rule\n- Date: 2026-01-01 | Last verified: 2026-02-01\n- Status: active';
  const e = parse(t).entries[0];
  assert.equal(e.id, 'D-001');
  assert.equal(e.lastVerified, '2026-02-01');
  const v = setField(t, 'D-001', 'Last verified', '2026-11-20');
  assert.equal(v, t.replace('2026-02-01', '2026-11-20'));
  assert.ok(v.startsWith('﻿') && !v.endsWith('\n'));
});

test('words counts the entry text (title and why) for the long-entry warning', () => {
  assert.equal(words({ title: 'one two three', why: 'four five' }), 5);
});

// ---- Touches: matching (design 1.2) ----
const M = [
  // [pattern, path, expected]
  ['src/billing/**', 'src/billing/total.ts', true],
  ['src/billing/**', 'src/billing/deep/x/y.ts', true],
  ['src/billing/**', 'src/billing', true],
  ['src/billing/**', 'src/billingx/a.ts', false],
  ['src/billing', 'src/billing/total.ts', true],
  ['src/billing/', 'src/billing/a/b.ts', true],
  ['src/billing', 'src/billing2/a.ts', false],
  ['src/models/price.ts', 'src/models/price.ts', true],
  ['src/models/price.ts', 'src/models/price.tsx', false],
  ['src/*.ts', 'src/a.ts', true],
  ['src/*.ts', 'src/sub/a.ts', false],
  ['src/**/*.ts', 'src/a.ts', true],
  ['src/**/*.ts', 'src/x/y/a.ts', true],
  ['src/**/*.ts', 'src/x/y/a.js', false],
  ['**/*.sql', 'db/migrations/001.sql', true],
  ['**/*.sql', '001.sql', true],
  ['**', 'anything/at/all.md', true],
  ['*.md', 'README.md', true],
  ['*.md', 'docs/README.md', false],
  ['src/?.ts', 'src/a.ts', true],
  ['src/?.ts', 'src/ab.ts', false],
  ['./src/a.ts', 'src/a.ts', true],
  ['src\\a.ts', 'src/a.ts', true],
  ['src/a.ts', './src/a.ts', true],
  ['src/a.ts', 'src\\a.ts', true],
  ['prisma/**', 'prisma/schema.prisma', true],
  ['src/a.ts', 'lib/src/a.ts', false],
  ['src/a+b(1).ts', 'src/a+b(1).ts', true],
  ['src/[id].tsx', 'src/[id].tsx', true],
  ['', 'src/a.ts', false],
];
for (const [p, f, want] of M) test(`matches("${p}", "${f}") = ${want}`, () => assert.equal(matches(p, f), want));

test('letter case: ignored on Windows and macOS, exact on Linux', () => {
  assert.equal(matches('src/Billing/**', 'src/billing/a.ts'), process.platform !== 'linux');
});
