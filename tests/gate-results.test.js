'use strict';
// v0.7 gate results: read a test command's output and say passed / failed / skipped / not run, which tests failed, and how
// far a run still being written has got, for eight runners. Also: colours and Windows line ends do not matter, names are
// kept short, unknown text gives null, and a huge or hostile log does not stall.
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, progress, oneLine, progressLine } = require('../scripts/lib/gate-results');
const { cost, fastEnough, say } = require('./helpers/timing');

const join = a => a.join('\n') + '\n';

const NODE_GREEN = join([
  '▶ graph file',
  '  ✔ parses steps (1.2ms)',
  '  ﹣ reads a bom (0.1ms) # SKIP',
  '  ✔ validates (0.8ms)',
  '▶ graph file (3.5ms)',
  '✔ top level (0.4ms)',
  'ℹ tests 4',
  'ℹ suites 1',
  'ℹ pass 3',
  'ℹ fail 0',
  'ℹ cancelled 0',
  'ℹ skipped 1',
  'ℹ todo 0',
  'ℹ duration_ms 91.2'
]);
const NODE_RED = join([
  '✔ adds (0.4ms)',
  '✖ divides by zero (1.5ms)',
  '✖ keeps order (2.0ms)',
  '﹣ later (0.1ms) # not ready',
  'ℹ tests 5',
  'ℹ pass 1',
  'ℹ fail 2',
  'ℹ cancelled 1',
  'ℹ skipped 0',
  'ℹ todo 1',
  '',
  '✖ failing tests:',
  '',
  '✖ divides by zero (1.5ms)',
  '  AssertionError: expected 1 to equal 2',
  '✖ keeps order (2.0ms)',
  '  AssertionError: nope'
]);
const NODE_PART = join(['✔ one (1.0ms)', '✔ two (1.0ms)', '✖ three (1.0ms)', '﹣ four (0.1ms) # SKIP', '✔ five (1.0ms)']);

const TAP_GREEN = join([
  'TAP version 13',
  'ok 1 - adds',
  'ok 2 - subtracts # SKIP not on windows',
  '    ok 1 - inner',
  'not ok 3 - future thing # TODO later',
  '1..3',
  '# tests 3',
  '# pass 1',
  '# fail 0',
  '# skipped 2'
]);
const TAP_RED = join([
  'TAP version 13',
  'ok 1 - adds',
  'not ok 2 - divides',
  '  ---',
  '  error: boom',
  '  ...',
  '    not ok 1 - inner is ignored',
  'not ok 3 - orders',
  'ok 4 - last',
  '1..4',
  '# tests 4',
  '# pass 2',
  '# fail 2',
  '# skipped 0'
]);
const TAP_PART = join(['TAP version 13', '1..63', 'ok 1 - a', 'ok 2 - b', 'not ok 3 - c', 'ok 4 - d # skip no']);

const JEST_GREEN = join([
  'PASS src/a.test.js',
  '  suite',
  '    ✓ adds (3 ms)',
  '    ○ skipped later',
  '',
  'Test Suites: 1 passed, 1 total',
  'Tests:       1 skipped, 10 passed, 11 total',
  'Snapshots:   0 total',
  'Time:        1.2 s'
]);
const JEST_RED = join([
  'FAIL src/a.test.js',
  '  ● Console',
  '    console.log hi',
  '  ● suite › divides',
  '    expect(received)',
  '  ● suite › orders',
  '',
  'FAIL src/broken.test.js',
  '  ● Test suite failed to run',
  '',
  '  ● suite › divides',
  '',
  'Tests:       2 failed, 1 todo, 10 passed, 13 total'
]);
const JEST_PART = join(['PASS src/a.test.js', '    ✓ adds (3 ms)', '    ✓ subtracts (1 ms)', '    ✕ divides (4 ms)', '    ○ skipped later']);

const VITEST_GREEN = join([
  ' ✓ src/a.test.ts (3 tests) 5ms',
  '   ✓ adds 2ms',
  '   ↓ later',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  10 passed | 2 skipped (12)'
]);
const VITEST_RED = join([
  ' FAIL  src/a.test.ts > suite > divides',
  'AssertionError: x',
  ' FAIL  src/a.test.ts > suite > orders',
  ' ❯ src/a.test.ts (3 tests | 2 failed) 9ms',
  '   × divides 12ms',
  '',
  ' FAIL  src/a.test.ts > suite > divides',
  '      Tests  2 failed | 10 passed | 1 skipped (13)'
]);
const VITEST_PART = join([' ✓ src/a.test.ts (3 tests) 5ms', '   ✓ adds 2ms', '   ✓ more 1ms', '   × divides 12ms', '   ↓ later']);

const PY_GREEN = join([
  '============================= test session starts =============================',
  'collected 13 items',
  '',
  'tests/test_a.py ..s.        [ 30%]',
  '',
  '=========== 10 passed, 2 skipped, 1 xfailed, 3 deselected, 1 warning in 3.21s ===========',
]);
const PY_RED = join([
  'collected 13 items',
  'tests/test_a.py ..F.s    [ 45%]',
  '=========================== short test summary info ===========================',
  'FAILED tests/test_a.py::test_div - AssertionError: assert 1 == 2',
  'ERROR tests/test_b.py::test_x - RuntimeError: boom',
  'FAILED tests/test_c.py::test_plain',
  '=========== 1 failed, 10 passed, 2 skipped, 1 error in 3.21s ===========',
]);
const PY_PART = join(['collected 63 items', '', 'tests/test_a.py ..F.s    [ 45%]', 'tests/test_b.py ...E']);

const PW_GREEN = join([
  'Running 6 tests using 4 workers',
  '',
  '  ✓  1 [chromium] › tests/a.spec.ts:3:5 › home › loads (1.2s)',
  '  -  2 [chromium] › tests/a.spec.ts:9:5 › home › later',
  '',
  '  1 skipped',
  '  5 passed (1.2m)'
]);
const PW_RED = join([
  'Running 63 tests using 4 workers',
  '  ✓  1 [chromium] › tests/a.spec.ts:3:5 › home › loads (1.2s)',
  '  ✘  2 [chromium] › tests/login.spec.ts:12:5 › login › shows an error (2.1s)',
  '',
  '  5 failed',
  '    [chromium] › tests/login.spec.ts:12:5 › login › shows an error',
  '    [chromium] › tests/login.spec.ts:20:5 › login › locks out',
  '  3 skipped',
  '  1 did not run',
  '  52 passed (1.2m)'
]);
const PW_PART = join([
  'Running 63 tests using 4 workers',
  '  ✓  1 [chromium] › tests/a.spec.ts:3:5 › home › loads (1.2s)',
  '  ✓  2 [chromium] › tests/a.spec.ts:4:5 › home › more (1.0s)',
  '  ✘  3 [chromium] › tests/a.spec.ts:5:5 › home › broken (1.0s)',
  '  -  4 [chromium] › tests/a.spec.ts:6:5 › home › later'
]);

const MOCHA_GREEN = join([
  '  suite',
  '    ✓ adds',
  '    - later',
  '',
  '  10 passing (2s)',
  '  3 pending'
]);
const MOCHA_RED = join([
  '  suite',
  '    ✓ adds',
  '    1) divides',
  '    2) orders',
  '',
  '  8 passing (2s)',
  '  2 failing',
  '',
  '  1) suite',
  '       divides:',
  '     AssertionError: x',
  '',
  '  2) other thing',
  '',
  '     AssertionError: y'
]);
const MOCHA_PART = join(['  suite', '    ✓ adds', '    ✓ more', '    1) divides', '    - later']);

const GO_GREEN = join([
  '=== RUN   TestA',
  '--- PASS: TestA (0.00s)',
  '--- SKIP: TestB (0.00s)',
  '--- PASS: TestC (0.01s)',
  'PASS',
  'ok  \texample.com/pkg\t0.5s'
]);
const GO_RED = join([
  '--- FAIL: TestA (0.01s)',
  '    --- FAIL: TestA/sub (0.00s)',
  '        a_test.go:10: wrong',
  '--- PASS: TestC (0.01s)',
  'FAIL',
  'FAIL\texample.com/pkg\t0.5s'
]);
const GO_PART = join(['=== RUN TestA', '--- PASS: TestA (0.00s)', '--- FAIL: TestB (0.00s)', '--- SKIP: TestC (0.00s)']);

const only = (s, keys) => keys.reduce((o, k) => { o[k] = s[k]; return o; }, {});

test('node-test: an all-green run is counted from its own summary lines', () => {
  const s = summarize(NODE_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'notRun', 'total', 'runnerFlaky']),
    { format: 'node-test', passed: 3, failed: 0, skipped: 1, notRun: 0, total: 4, runnerFlaky: 0 });
  assert.deepEqual(s.failedNames, []);
});
test('node-test: failures give counts (cancelled is failed, todo is skipped) and the names from the failing tests list', () => {
  const s = summarize(NODE_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'node-test', passed: 1, failed: 3, skipped: 1, total: 5 });
  assert.deepEqual(s.failedNames, ['divides by zero', 'keeps order']);
});
test('node-test: a run cut off mid-way gives fallback counts from the per-test lines, and progress works', () => {
  assert.deepEqual(only(summarize(NODE_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'node-test', passed: 3, failed: 1, skipped: 1 });
  assert.deepEqual(summarize(NODE_PART).failedNames, ['three']);
  assert.deepEqual(progress(NODE_PART), { format: 'node-test', done: 5, failed: 1, total: null });
});

test('tap: an all-green run counts skip and todo as skipped', () => {
  const s = summarize(TAP_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'tap', passed: 1, failed: 0, skipped: 2, total: 3 });
});
test('tap: failures give counts and the top-level names only', () => {
  const s = summarize(TAP_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'tap', passed: 2, failed: 2, skipped: 0 });
  assert.deepEqual(s.failedNames, ['divides', 'orders']);
});
test('tap: a run cut off mid-way gives fallback counts, and progress uses the plan line for the total', () => {
  assert.deepEqual(only(summarize(TAP_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'tap', passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(progress(TAP_PART), { format: 'tap', done: 4, failed: 1, total: 63 });
});

test('jest: an all-green run reads the Tests: line', () => {
  const s = summarize(JEST_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'jest', passed: 10, failed: 0, skipped: 1, total: 11 });
});
test('jest: failures give counts, names from the bullet lines, no console lines, and a suite that failed to run by its file', () => {
  const s = summarize(JEST_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'jest', passed: 10, failed: 2, skipped: 1 });
  assert.deepEqual(s.failedNames, ['suite › divides', 'suite › orders', 'src/broken.test.js (test suite failed to run)']);
});
test('jest: a run cut off mid-way gives fallback counts from the per-test lines', () => {
  assert.deepEqual(only(summarize(JEST_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'jest', passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(summarize(JEST_PART).failedNames, ['divides']);
  assert.deepEqual(progress(JEST_PART), { format: 'jest', done: 4, failed: 1, total: null });
});

test('vitest: an all-green run reads the Tests line', () => {
  const s = summarize(VITEST_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'vitest', passed: 10, failed: 0, skipped: 2, total: 12 });
});
test('vitest: failures give counts and the FAIL names once each', () => {
  const s = summarize(VITEST_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'vitest', passed: 10, failed: 2, skipped: 1 });
  assert.deepEqual(s.failedNames, ['src/a.test.ts > suite > divides', 'src/a.test.ts > suite > orders']);
});
test('vitest: a run cut off mid-way gives fallback counts, file lines are not tests', () => {
  assert.deepEqual(only(summarize(VITEST_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'vitest', passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(summarize(VITEST_PART).failedNames, ['divides']);
  assert.deepEqual(progress(VITEST_PART), { format: 'vitest', done: 4, failed: 1, total: null });
});

test('pytest: an all-green run ignores deselected and warnings, xfailed is skipped, xpassed is passed', () => {
  const s = summarize(PY_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'pytest', passed: 10, failed: 0, skipped: 3, total: 13 });
});
test('pytest: failures give counts (errors are failed) and names cut before the dash', () => {
  const s = summarize(PY_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'pytest', passed: 10, failed: 2, skipped: 2 });
  assert.deepEqual(s.failedNames, ['tests/test_a.py::test_div', 'tests/test_b.py::test_x', 'tests/test_c.py::test_plain']);
});
test('pytest: a run cut off mid-way gives fallback counts from the dots, and progress has the collected total', () => {
  assert.deepEqual(only(summarize(PY_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'pytest', passed: 6, failed: 2, skipped: 1 });
  assert.deepEqual(progress(PY_PART), { format: 'pytest', done: 9, failed: 2, total: 63 });
});

test('playwright: an all-green run reads the summary block', () => {
  const s = summarize(PW_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'notRun', 'total']), { format: 'playwright', passed: 5, failed: 0, skipped: 1, notRun: 0, total: 6 });
});
test('playwright: failures give counts, did not run is notRun, and the names listed under the failed count', () => {
  const s = summarize(PW_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'notRun', 'total']), { format: 'playwright', passed: 52, failed: 5, skipped: 3, notRun: 1, total: 61 });
  assert.deepEqual(s.failedNames, ['[chromium] › tests/login.spec.ts:12:5 › login › shows an error', '[chromium] › tests/login.spec.ts:20:5 › login › locks out']);
});
test('playwright: flaky goes to runnerFlaky and its listed tests are not failed names; interrupted is failed', () => {
  const s = summarize(join([
    'Running 10 tests using 2 workers',
    '  1 interrupted',
    '    [chromium] › a.spec.ts:1:1 › stopped',
    '  2 flaky',
    '    [chromium] › a.spec.ts:2:1 › sometimes',
    '  7 passed (5s)'
  ]));
  assert.equal(s.runnerFlaky, 2);
  assert.equal(s.failed, 1);
  assert.deepEqual(s.failedNames, ['[chromium] › a.spec.ts:1:1 › stopped']);
});
test('playwright: a run cut off mid-way gives fallback counts, and progress has the announced total', () => {
  assert.deepEqual(only(summarize(PW_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'playwright', passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(progress(PW_PART), { format: 'playwright', done: 4, failed: 1, total: 63 });
});
test('playwright: a retried test is not counted twice', () => {
  const p = progress(join([
    'Running 5 tests using 1 worker',
    '  ✘  1 [chromium] › a.spec.ts:1:1 › flaky one (1.0s)',
    '  ✘  2 [chromium] › a.spec.ts:1:1 › flaky one (retry #1) (1.0s)',
    '  ✓  3 [chromium] › a.spec.ts:1:1 › flaky one (retry #2) (1.0s)',
    '  ✓  4 [chromium] › a.spec.ts:2:1 › steady (1.0s)'
  ]));
  assert.deepEqual(p, { format: 'playwright', done: 2, failed: 1, total: 5 });
});
test('playwright: the Windows marks (ok and x) are read once the Running line has been seen', () => {
  const p = progress(join([
    'Running 4 tests using 2 workers',
    '  ok 1 [chromium] › a.spec.ts:1:1 › fine (1.0s)',
    '  x  2 [chromium] › a.spec.ts:2:1 › broken (1.0s)'
  ]));
  assert.deepEqual(p, { format: 'playwright', done: 2, failed: 1, total: 4 });
});

test('mocha: an all-green run reads passing and pending', () => {
  const s = summarize(MOCHA_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'mocha', passed: 10, failed: 0, skipped: 3, total: 13 });
});
test('mocha: failures give counts and names from the numbered list, with the test line joined on', () => {
  const s = summarize(MOCHA_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'mocha', passed: 8, failed: 2, skipped: 0 });
  assert.deepEqual(s.failedNames, ['suite divides', 'other thing']);
});
test('mocha: a run cut off mid-way gives fallback counts from the per-test lines', () => {
  assert.deepEqual(only(summarize(MOCHA_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'mocha', passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(progress(MOCHA_PART), { format: 'mocha', done: 4, failed: 1, total: null });
});

test('go: an all-green run counts the PASS and SKIP lines', () => {
  const s = summarize(GO_GREEN);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped', 'total']), { format: 'go', passed: 2, failed: 0, skipped: 1, total: 3 });
});
test('go: failures list the parent and the subtest, and a package line alone is not a test count', () => {
  const s = summarize(GO_RED);
  assert.deepEqual(only(s, ['format', 'passed', 'failed', 'skipped']), { format: 'go', passed: 1, failed: 2, skipped: 0 });
  assert.deepEqual(s.failedNames, ['TestA', 'TestA/sub']);
  assert.deepEqual(only(summarize('ok  \texample.com/pkg\t0.5s\n'), ['format', 'passed', 'failed']), { format: 'go', passed: 0, failed: 0 });
});
test('go: a run cut off mid-way gives fallback counts, and progress counts the lines', () => {
  assert.deepEqual(only(summarize(GO_PART), ['format', 'passed', 'failed', 'skipped']), { format: 'go', passed: 1, failed: 1, skipped: 1 });
  assert.deepEqual(progress(GO_PART), { format: 'go', done: 3, failed: 1, total: null });
});

test('colours and Windows line ends give the same result as plain text', () => {
  const samples = [NODE_RED, TAP_RED, JEST_RED, VITEST_RED, PY_RED, PW_RED, MOCHA_RED, GO_RED];
  for (const plain of samples) {
    const coloured = plain.split('\n').map(l => `\u001b[1m\u001b[31m${l}\u001b[0m`).join('\r\n');
    assert.deepEqual(summarize(coloured), summarize(plain));
    assert.deepEqual(progress(coloured), progress(plain));
  }
});

test('the first runner with a final summary wins when the text could be read two ways', () => {
  const text = join(['    ✓ adds (3 ms)', '10 passing (2s)'.padStart(17)]);
  assert.equal(summarize(text).format, 'mocha');
});

test('names are cut at 160 characters with an ellipsis, capped at 50, and never repeated', () => {
  const long = 'x'.repeat(300);
  const lines = ['✖ ' + long + ' (1.0ms)', '✖ ' + long + ' (2.0ms)'];
  for (let i = 0; i < 80; i++) lines.push(`✖ test ${i} (1.0ms)`);
  lines.push('ℹ tests 82', 'ℹ pass 0', 'ℹ fail 82');
  const s = summarize(join(lines));
  assert.equal(s.failedNames.length, 50);
  assert.equal(s.failedNames[0].length, 160);
  assert.ok(s.failedNames[0].endsWith('…'));
  assert.equal(new Set(s.failedNames).size, 50);
  assert.equal(s.failed, 82);
});

test('unknown text gives null from both functions, and so does anything that is not text', () => {
  for (const x of ['hello world', '', null, undefined, 12345, {}, '\u0000\u0001\u0002 binary ￿']) {
    assert.equal(summarize(x), null);
    assert.equal(progress(x), null);
  }
});

test('oneLine gives the exact line, with "not run" and "flaky" only when above zero', () => {
  assert.equal(oneLine({ passed: 58, failed: 5, skipped: 0, notRun: 0, runnerFlaky: 0 }), '58 passed, 5 failed, 0 skipped');
  assert.equal(oneLine({ passed: 58, failed: 5, skipped: 0, notRun: 3, runnerFlaky: 0 }), '58 passed, 5 failed, 0 skipped, 3 not run');
  assert.equal(oneLine({ passed: 1, failed: 0, skipped: 0, notRun: 0, runnerFlaky: 2 }), "1 passed, 0 failed, 0 skipped, 2 flaky (the runner's own word)");
  assert.equal(oneLine({ passed: 1, failed: 1, skipped: 1, notRun: 4, runnerFlaky: 2 }), "1 passed, 1 failed, 1 skipped, 4 not run, 2 flaky (the runner's own word)");
});

test('progressLine says "of N" only when the total is known', () => {
  assert.equal(progressLine({ format: 'jest', done: 31, failed: 0, total: 63 }), '31 of 63 tests done, 0 failed');
  assert.equal(progressLine({ format: 'jest', done: 31, failed: 2, total: null }), '31 tests done, 2 failed');
});

test('speed: a 200,000-line node-test output is summarised quickly', () => {
  const parts = [];
  for (let i = 0; i < 199990; i++) parts.push(i % 50 === 0 ? `✖ test ${i} (1.0ms)` : `  ✔ test ${i} (0.5ms)`);
  parts.push('ℹ tests 199990', 'ℹ pass 199790', 'ℹ fail 200', 'ℹ skipped 0', 'ℹ cancelled 0', 'ℹ todo 0');
  const big = parts.join('\n');
  const m = cost(() => summarize(big));
  assert.ok(fastEnough(m, 2000), say(m));
  assert.equal(m.value.failed, 200);
  const p = cost(() => progress(big));
  assert.ok(fastEnough(p, 2000), say(p));
});

// Review of v0.7: two patterns went quadratic on a line that starts like a summary and goes on with spaces; a log
// full of such lines took about a minute. 5,000 of them (20 MB) must be read in seconds.
test('speed: thousands of long lines that look like a jest or vitest summary are read quickly', () => {
  for (const line of [`Tests: 1 a${' '.repeat(3980)}!`, `Tests 1${' '.repeat(3980)}x`, `Tests  1 failed |${' '.repeat(3970)}(`]) {
    const bad = `${line}\n`.repeat(5000);
    const a = cost(() => summarize(bad));
    assert.ok(fastEnough(a, 4000), say(a));
    const b = cost(() => progress(bad));
    assert.ok(fastEnough(b, 4000), say(b));
  }
});

test('vitest: the total in brackets is dropped whatever the spacing, and the counts are right', () => {
  const s = summarize(' ✓ a 1ms\n × b 1ms\n\n Tests  1 failed | 10 passed | 2 skipped (13)   \n');
  assert.deepEqual([s.format, s.passed, s.failed, s.skipped], ['vitest', 10, 1, 2]);
});

test('speed: a hostile 200,000-character line does not stall either function', () => {
  for (const unit of ['✖ ', '=', ' ', '✔ (1.0ms) ']) {
    const bad = 'ℹ tests 1\n' + unit.repeat(Math.ceil(200000 / unit.length)).slice(0, 200000) + '\n';
    const a = cost(() => summarize(bad));
    assert.ok(fastEnough(a, 2000), say(a));
    const b = cost(() => progress(bad));
    assert.ok(fastEnough(b, 2000), say(b));
  }
});
