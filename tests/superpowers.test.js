'use strict';
// Owner 2026-11-19: v0.1 reads the superpowers progress ledger (read-only, soft coupling, spec principle 7):
// plan "### Task N: name" headings + ".superpowers/sdd/<plan>/progress.md" "Task N: complete" lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ledgerProgress, newestLedgerPlan } = require('../scripts/lib/superpowers');
const { parsePlan } = require('../scripts/lib/plan');

const PLAN_REL = 'docs/superpowers/plans/2026-11-19-greet.md';
const PLAN = `# Greet Implementation Plan

### Task 1: Greet function
- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Implement**

### Task 2: CLI flag
- [ ] **Step 1: Write the failing test**

### Task 3: README
- [ ] **Step 1: Document it**
`;

function project({ ledger, planPath = PLAN_REL } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sp-'));
  fs.mkdirSync(path.join(dir, path.dirname(PLAN_REL)), { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_REL), PLAN);
  if (ledger !== undefined) {
    const d = path.join(dir, '.superpowers', 'sdd', '2026-11-19-greet');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'progress.md'), ledger.replace('<PLAN>', planPath));
  }
  return dir;
}

test('the plan parser lists ### Task N headings', () => {
  assert.deepEqual(parsePlan(PLAN).tasks, [{ n: 1, title: 'Greet function' }, { n: 2, title: 'CLI flag' }, { n: 3, title: 'README' }]);
});

test('ledger: Task 1 complete -> task 2 of 3, next is task 2', () => {
  const dir = project({ ledger: '# SDD ledger — plan: <PLAN>\nTask 1: complete (commits abc1234..def5678, review clean)\n' });
  const p = ledgerProgress(dir, PLAN_REL, parsePlan(PLAN));
  assert.deepEqual(p, { total: 3, done: 1, stepIndex: 2, next: 'Task 2: CLI flag', title: 'Greet Implementation Plan' });
});

test('an absolute plan path on the first line also matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sp-'));
  const abs = path.join(dir, PLAN_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, PLAN);
  const d = path.join(dir, '.superpowers', 'sdd', 'x');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'progress.md'), `# SDD ledger — plan: ${abs}\nTask 1: complete\nTask 2: complete\n`);
  const p = ledgerProgress(dir, PLAN_REL, parsePlan(PLAN));
  assert.equal(p.done, 2);
  assert.equal(p.next, 'Task 3: README');
});

test('all tasks complete -> 3 of 3, next none', () => {
  const dir = project({ ledger: '# SDD ledger — plan: <PLAN>\nTask 1: complete\nTask 2: complete\nTask 3: complete\n' });
  const p = ledgerProgress(dir, PLAN_REL, parsePlan(PLAN));
  assert.equal(p.stepIndex, 3);
  assert.equal(p.next, null);
});

test('a ledger for another plan, a missing ledger, or a malformed one gives null', () => {
  assert.equal(ledgerProgress(project({ ledger: '# SDD ledger — plan: docs/other.md\nTask 1: complete\n' }), PLAN_REL, parsePlan(PLAN)), null);
  assert.equal(ledgerProgress(project(), PLAN_REL, parsePlan(PLAN)), null);
  assert.equal(ledgerProgress(project({ ledger: 'garbage\n' }), PLAN_REL, parsePlan(PLAN)), null);
});

test('a plan without Task headings is not read through a ledger', () => {
  const dir = project({ ledger: '# SDD ledger — plan: <PLAN>\nTask 1: complete\n' });
  assert.equal(ledgerProgress(dir, PLAN_REL, parsePlan('# P\n- [ ] a\n- [ ] b\n')), null);
});

test('newestLedgerPlan finds the plan named by the most recent ledger', () => {
  const dir = project({ ledger: '# SDD ledger — plan: <PLAN>\nTask 1: complete\n' });
  assert.equal(newestLedgerPlan(dir), PLAN_REL);
  assert.equal(newestLedgerPlan(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sp-'))), null);
});
