'use strict';
// v0.4 build graph, the file (design-v0.4 section 2): parse steps and fields, validate before any run (unknown kind,
// unknown helper, a need nobody gives, a field given twice, a cycle, a parallel naming a missing step, a gate without
// run:, a human without say:), with file line numbers; compute the order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, validate, order } = require('../scripts/lib/graph');

const GOOD = `# Graph: ship-feature
- max_parallel: 2
- min_free_memory_mb: 1500

## spec (agent)
- helper: planner
- brief: .jspark-forge/briefs/spec.md
- gives: spec_path

## plan (agent)
- helper: planner
- needs: spec_path
- gives: plan_path

## build-api (agent)
- helper: builder
- needs: plan_path
- gives: commit, test_totals
- estimate: 40k tokens, 15 min

## build-ui (agent)
- helper: builder
- needs: plan_path
- gives: ui_commit

## build (parallel)
- steps: build-api, build-ui

## checks (gate)
- after: build
- run: npm test
- run: npm run lint

## merge (human)
- after: checks
- say: Review the branch and merge it into main.
`;

test('parse: name, settings, steps with kind and fields', () => {
  const g = parse(GOOD);
  assert.equal(g.name, 'ship-feature');
  assert.equal(g.maxParallel, 2);
  assert.equal(g.minFreeMemoryMb, 1500);
  assert.deepEqual(g.steps.map(s => `${s.id}:${s.kind}`), ['spec:agent', 'plan:agent', 'build-api:agent', 'build-ui:agent', 'build:parallel', 'checks:gate', 'merge:human']);
  const api = g.steps.find(s => s.id === 'build-api');
  assert.equal(api.helper, 'builder');
  assert.deepEqual(api.needs, ['plan_path']);
  assert.deepEqual(api.gives, ['commit', 'test_totals']);
  assert.equal(api.estimate, '40k tokens, 15 min');
  assert.deepEqual(g.steps.find(s => s.id === 'checks').run, ['npm test', 'npm run lint']);
  assert.equal(g.steps.find(s => s.id === 'merge').say, 'Review the branch and merge it into main.');
});

test('a valid graph has no errors, and its order respects after: and needs:', () => {
  const g = parse(GOOD);
  assert.deepEqual(validate(g), []);
  const o = order(g);
  const at = id => o.indexOf(id);
  assert.ok(at('spec') < at('plan') && at('plan') < at('build-api') && at('build-api') < at('checks') && at('checks') < at('merge'));
  assert.ok(at('build-ui') < at('checks'), 'a step inside a parallel runs before what comes after the parallel');
});

const errs = text => validate(parse(text)).map(e => `${e.line}:${e.message}`);
test('every error kind is reported with its line', () => {
  assert.match(errs('# Graph: x\n\n## a (robot)\n- helper: builder\n').join('|'), /^3:.*unknown kind "robot"/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: wizard\n').join('|'), /4:.*unknown helper "wizard"/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- needs: plan_path\n').join('|'), /needs "plan_path", which no earlier step gives/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- gives: x\n\n## b (agent)\n- helper: builder\n- gives: x\n').join('|'), /"x" is given twice/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- after: b\n\n## b (agent)\n- helper: builder\n- after: a\n').join('|'), /cycle/);
  assert.match(errs('# Graph: x\n\n## p (parallel)\n- steps: ghost\n').join('|'), /names a missing step "ghost"/);
  assert.match(errs('# Graph: x\n\n## g (gate)\n- after: \n').join('|'), /gate needs at least one "run:"/);
  assert.match(errs('# Graph: x\n\n## h (human)\n').join('|'), /human step needs "say:"/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n\n## a (agent)\n- helper: builder\n').join('|'), /step "a" is defined twice/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- after: nowhere\n').join('|'), /after a missing step "nowhere"/);
  assert.match(errs('# Graph: x\n\n## Bad Id! (agent)\n- helper: builder\n').join('|'), /step id/);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- gives: Not-A-Name\n').join('|'), /field name/);
  assert.match(errs('no title\n').join('|'), /# Graph: <name>/);
});

test('a need given only by a later step is an error (order, not just presence)', () => {
  const e = errs('# Graph: x\n\n## a (agent)\n- helper: builder\n- needs: y\n\n## b (agent)\n- helper: builder\n- after: a\n- gives: y\n');
  assert.ok(e.some(x => /needs "y"/.test(x)) || e.some(x => /cycle/.test(x)), e.join('|'));
});

test('a helper may be any named agent (plugin:agent) when it is not one of the four', () => {
  assert.deepEqual(errs('# Graph: x\n\n## a (agent)\n- helper: myplugin:researcher\n'), []);
  assert.deepEqual(errs('# Graph: x\n\n## a (agent)\n- helper: checker\n- model: haiku\n'), []);
  assert.match(errs('# Graph: x\n\n## a (agent)\n- helper: checker\n- model: gpt-9\n').join('|'), /unknown model/);
});

test('settings are bounded: max_parallel 1-8, memory a number', () => {
  assert.match(errs('# Graph: x\n- max_parallel: 50\n\n## a (agent)\n- helper: builder\n').join('|'), /max_parallel/);
  assert.equal(parse('# Graph: x\n\n## a (agent)\n- helper: builder\n').maxParallel, 1, 'default one at a time');
});

test('CRLF and a byte-order mark are read like plain text', () => {
  const t = String.fromCharCode(0xfeff) + GOOD.replace(/\n/g, '\r\n');
  assert.deepEqual(validate(parse(t)), []);
  assert.equal(parse(t).steps.length, 7);
});

test('the three shipped templates are valid graphs (spec 5.10)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const n of ['software', 'documents', 'spike']) {
    const g = parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'graphs', `${n}.md`), 'utf8'));
    assert.deepEqual(validate(g), [], n);
    assert.equal(order(g).length, g.steps.length, `${n}: every step can run`);
  }
});
