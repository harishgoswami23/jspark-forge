'use strict';
// v0.5.1 gaps, item 7 (model map, spec 815-821): lint checks every agents/*.md; SubagentStart logs the tier.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const lint = require('../scripts/lib/lint');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const agent = (fm, body = 'You are a helper.\n') => `---\n${fm}\n---\n${body}`;
const GOOD = agent('name: x\ndescription: Use for building. Runs on a standard model, because the plan carries the judgement.\nmodel: sonnet');
const lintAs = (text, name = 'x.md') => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gmm-')), 'agents');
  fs.mkdirSync(d);
  const f = path.join(d, name);
  fs.writeFileSync(f, text);
  return lint.lintAgent(text, f);
};

test('lintAgent: a good helper file passes', () => assert.deepEqual(lintAs(GOOD), []));

test('lintAgent: the model must be one of the tiers\' models in rules/model-tiers.json', () => {
  const tiers = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'model-tiers.json'), 'utf8'));
  for (const t of Object.values(tiers)) assert.deepEqual(lintAs(GOOD.replace('model: sonnet', `model: ${t.model}`)), [], t.model);
  assert.match(lintAs(GOOD.replace('model: sonnet', 'model: gpt-9'))[0].message, /model "gpt-9" is not one of the tiers' models \(fable, sonnet, haiku\)/);
  assert.match(lintAs(GOOD.replace('\nmodel: sonnet', ''))[0].message, /model is missing/);
});

test('lintAgent: the description must say when to use it ("Use for") and why that tier ("because")', () => {
  assert.match(lintAs(GOOD.replace('Use for building', 'Builds things'))[0].message, /"Use for"/);
  assert.match(lintAs(GOOD.replace(', because the plan', ', since the plan'))[0].message, /"because"/);
  assert.match(lintAs(agent('name: x\nmodel: sonnet'))[0].message, /description/);
  assert.match(lintAs('no frontmatter at all\n')[0].message, /frontmatter/);
});

test('lint: the shipped helper files pass, and the default paths include them', () => {
  const files = lint.defaultPaths(ROOT).filter(f => path.basename(path.dirname(f)) === 'agents');
  assert.deepEqual(files.map(f => path.basename(f)), ['builder.md', 'checker.md', 'planner.md', 'reviewer.md']);
  const out = spawnSync(process.execPath, [FORGE, 'lint', ...files], { encoding: 'utf8', cwd: ROOT });
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /^ok .*builder\.md$/m);
});

test('lint: a helper file with a bad model fails through forge.js lint', () => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gmm-')), 'agents');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'bad.md'), GOOD.replace('model: sonnet', 'model: llama'));
  const out = spawnSync(process.execPath, [FORGE, 'lint', path.join(d, 'bad.md')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /bad\.md:\d+: model "llama"/);
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gmm-p-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const todayLog = dir => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return fs.readFileSync(path.join(dir, '.jspark-forge', 'log', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`), 'utf8');
};
const sub = (dir, type) => spawnSync(process.execPath, [FORGE, 'SubagentStart'], { encoding: 'utf8',
  input: JSON.stringify({ session_id: 'gmm-1', cwd: dir, agent_id: `a-${type}`, agent_type: type }),
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });

test('SubagentStart logs the tier with the AGENT+ line for the four JSPARK Forge helpers', () => {
  const dir = project();
  for (const n of ['builder', 'checker', 'planner', 'reviewer']) sub(dir, `jspark-forge:${n}`);
  const log = todayLog(dir);
  assert.match(log, /AGENT\+ jspark-forge:builder \(standard\)$/m);
  assert.match(log, /AGENT\+ jspark-forge:checker \(light\)$/m);
  assert.match(log, /AGENT\+ jspark-forge:planner \(strongest\)$/m);
  assert.match(log, /AGENT\+ jspark-forge:reviewer \(strongest\)$/m);
});

test('SubagentStart: any other helper keeps its plain AGENT+ line', () => {
  const dir = project();
  sub(dir, 'general-purpose');
  sub(dir, 'jspark-forge:unknown');
  const log = todayLog(dir);
  assert.match(log, /AGENT\+ general-purpose$/m);
  assert.match(log, /AGENT\+ jspark-forge:unknown$/m);
});
