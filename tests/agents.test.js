'use strict';
// v0.2 model map (spec 5.15, design-v0.2 section 4): four helpers pinned to model tiers, each with its reason; tools
// fit the job (a reviewer cannot edit); each works from a brief; with superpowers the map is steered at session start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tiers = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'model-tiers.json'), 'utf8'));
const agent = name => {
  const t = fs.readFileSync(path.join(ROOT, 'agents', `${name}.md`), 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, `${name}: frontmatter`);
  const f = {};
  for (const line of m[1].split(/\r?\n/)) { const k = line.match(/^(\w+):\s*(.*)$/); if (k) f[k[1]] = k[2].trim(); }
  return { f, body: m[2] };
};
const WANT = { planner: 'strongest', reviewer: 'strongest', builder: 'standard', checker: 'light' };

test('the tier map names a model alias for each tier', () => {
  for (const t of ['strongest', 'standard', 'light']) assert.match(String(tiers[t] && tiers[t].model), /^(fable|opus|sonnet|haiku)$/, t);
  for (const t of ['strongest', 'standard', 'light']) assert.ok(tiers[t].why && tiers[t].why.length > 20, `${t}: a reason`);
});

for (const [name, tier] of Object.entries(WANT)) {
  test(`${name}: pinned to the ${tier} tier, says when to use it and why, works from a brief`, () => {
    const { f, body } = agent(name);
    assert.equal(f.name, name);
    assert.equal(f.model, tiers[tier].model, `${name} model`);
    assert.match(f.description, /^Use (for|when) /);
    assert.match(f.description, new RegExp(`${tier} model`), 'the tier and reason are visible');
    for (const field of ['Goal', 'CAN change', 'CANNOT change', 'Done', 'Stop']) assert.ok(body.includes(field), `${name}: ${field}`);
    assert.match(body, /evidence/i);
    assert.match(body, /JSPARK Forge/);
  });
}

test('tools fit the job: reviewer and checker cannot edit; planner can write plans; builder has all tools', () => {
  const tools = n => (agent(n).f.tools || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const n of ['reviewer', 'checker']) {
    assert.ok(tools(n).length, `${n} lists its tools`);
    assert.ok(!tools(n).some(t => /^(Edit|Write|NotebookEdit)$/.test(t)), `${n} cannot edit`);
  }
  assert.ok(tools('planner').includes('Write'));
  assert.equal(agent('builder').f.tools, undefined, 'builder: all tools');
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agents-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const start = (dir, home) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'forge.js'), 'SessionStart'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'ag-1', cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};

test('with superpowers installed, session start steers its helpers to the model map; without it, nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agents-cfg-'));
  assert.ok(!/jspark-forge:builder/.test(start(project(), home)));
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'superpowers@jspark-forge': [{}] } }));
  const c = start(project(), home);
  assert.match(c, /jspark-forge:builder/);
  assert.match(c, /jspark-forge:reviewer/);
  assert.match(c, /jspark-forge:checker/);
});
