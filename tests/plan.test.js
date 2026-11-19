'use strict';
// Deviation 7 (design 16): with no todo tool, "Step n of m" and "Next" come from a checkbox plan file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlan } = require('../scripts/lib/plan');

const PLAN = `# Save as chart Implementation Plan

Some prose.

### Task 1
- [x] **Step 1:** add chart model
- [x] Step 2: migration
  - [X] nested sub-step counts too
* [ ] Step 4: write tests for the save route
- [ ] Step 5: wire the button
`;

test('counts ticked and open boxes; step = first open box; title from the first heading', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.title, 'Save as chart Implementation Plan');
  assert.equal(p.total, 5);
  assert.equal(p.done, 3);
  assert.equal(p.stepIndex, 4);
  assert.equal(p.next, 'Step 4: write tests for the save route');
});

test('all boxes ticked: step m of m, next = none', () => {
  const p = parsePlan('# T\n- [x] a\n- [x] b\n');
  assert.equal(p.stepIndex, 2);
  assert.equal(p.total, 2);
  assert.equal(p.next, null);
});

test('a file with fewer than two checkboxes is not a plan', () => {
  assert.equal(parsePlan('# Notes\n- [ ] one thing\n'), null);
  assert.equal(parsePlan('# Readme\nno boxes'), null);
});

test('markdown emphasis is removed and long items are cut to 120 characters', () => {
  const p = parsePlan(`# T\n- [ ] **Bold** and \`code\` ${'x'.repeat(200)}\n- [ ] b\n`);
  assert.ok(p.next.startsWith('Bold and code '));
  assert.ok(p.next.length <= 120);
});
