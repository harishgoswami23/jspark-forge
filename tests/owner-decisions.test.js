'use strict';
// Owner decisions of 2026-11-20, after the first spec-coverage check (docs/spec.md section 12):
// 2. a stale-decision flag at most once per entry per day (the code flagged once a week);
// 3. local copies of published pages stay local;  4. build graph files are committed, their run state is not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const setup = require('../scripts/lib/setup');

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-own-'));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@example.invalid'); git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n'); git(dir, 'add', 'a.txt'); git(dir, 'commit', '-qm', 'init');
  return dir;
}
const hook = (dir, event, input = {}) => spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
  input: JSON.stringify(Object.assign({ session_id: 's1', cwd: dir, hook_event_name: event }, input)),
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, JSPARK_FORGE_AUTO_STATUSLINE: 'off', JSPARK_FORGE_AUTO_SETUP: 'off' }) });
const ignored = (dir, rel) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0;

test('a new project: build graph files can be committed; their state, the handoff, the log and page copies stay local', () => {
  const dir = project();
  hook(dir, 'SessionStart', { source: 'startup' }); // automatic setup writes .jspark-forge/.gitignore
  const f = path.join(dir, '.jspark-forge');
  for (const p of ['graphs', 'artifacts', 'state', 'log']) fs.mkdirSync(path.join(f, p), { recursive: true });
  fs.writeFileSync(path.join(f, 'graphs', 'release.md'), '# graph\n');
  fs.writeFileSync(path.join(f, 'graphs', 'notes.txt'), 'x\n');
  fs.writeFileSync(path.join(f, 'artifacts', 'plan.html'), '<html></html>\n');
  fs.writeFileSync(path.join(f, 'artifacts.md'), 'list\n');
  assert.equal(ignored(dir, '.jspark-forge/graphs/release.md'), false, 'a graph file is shared');
  assert.equal(ignored(dir, '.jspark-forge/rules.md'), false);
  for (const p of ['graphs/notes.txt', 'artifacts/plan.html', 'artifacts.md', 'state/graph-release.json', 'handoff.md', 'log/2026-11-20.log']) {
    assert.equal(ignored(dir, `.jspark-forge/${p}`), true, `${p} stays local`);
  }
});

test('a project set up before v0.5.1 gets the graph lines added once, in its own line ending, other lines kept', () => {
  const dir = project();
  const f = path.join(dir, '.jspark-forge');
  fs.mkdirSync(path.join(f, 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  const old = '*\r\n!.gitignore\r\n!rules.md\r\n!launch.md\r\n!decisions.md\r\n';
  fs.writeFileSync(path.join(f, '.gitignore'), old);
  setup.shareGraphs(dir);
  const now = fs.readFileSync(path.join(f, '.gitignore'), 'utf8');
  assert.equal(now, `${old}!graphs/\r\n!graphs/*.md\r\n`);
  setup.shareGraphs(dir);
  assert.equal(fs.readFileSync(path.join(f, '.gitignore'), 'utf8'), now, 'not added twice');
  fs.mkdirSync(path.join(f, 'graphs'));
  fs.writeFileSync(path.join(f, 'graphs', 'ui.md'), '# graph\n');
  assert.equal(ignored(dir, '.jspark-forge/graphs/ui.md'), false);
});

test('starting a build graph shares the graph files in a project set up before v0.5.1', () => {
  const dir = project();
  const f = path.join(dir, '.jspark-forge');
  fs.mkdirSync(path.join(f, 'state'), { recursive: true });
  fs.mkdirSync(path.join(f, 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(f, '.gitignore'), '*\n!.gitignore\n!rules.md\n!launch.md\n');
  fs.copyFileSync(path.join(ROOT, 'templates', 'graphs', 'spike.md'), path.join(f, 'graphs', 'spike.md'));
  spawnSync(process.execPath, [FORGE, 'graph', 'start', 'spike'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  assert.match(fs.readFileSync(path.join(f, '.gitignore'), 'utf8'), /^!graphs\/\*\.md$/m);
});

test('a stale-decision flag comes back the next day, not a week later', () => {
  const memory = require('../scripts/lib/memory');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'memory.js'), 'utf8');
  assert.doesNotMatch(src, /7 \* 86400000\) continue/, 'the once-a-week rule is gone');
  assert.equal(typeof memory.noteCommit, 'function');
  const dir = project();
  const f = path.join(dir, '.jspark-forge');
  fs.mkdirSync(path.join(f, 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(f, 'decisions.md'), '## D-001 Prices in cents\n- Kind: decision\n- Date: 2026-01-01\n- Last verified: 2026-01-01\n- Touches: src/billing/**\n- Status: active\n\n');
  const commit = (n) => { fs.mkdirSync(path.join(dir, 'src', 'billing'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'billing', 'total.ts'), String(n)); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', `chore: change ${n}`); };
  const flagged = () => { const sess = {}; memory.noteCommit(dir, sess, { sha: git(dir, 'rev-parse', '--short', 'HEAD').trim(), subject: 'chore: change', files: [path.join(dir, 'src', 'billing', 'total.ts')] }); return (sess.stale || []).map(s => s.id); };
  commit(1);
  const first = flagged();
  assert.deepEqual(first, ['D-001'], 'flagged on the first commit');
  commit(2);
  assert.deepEqual(flagged(), [], 'not twice on the same day');
  const state = path.join(f, 'state', 'decisions.json');
  const st = JSON.parse(fs.readFileSync(state, 'utf8'));
  const y = new Date(Date.now() - 86400000);
  st.flags['D-001'] = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(state, JSON.stringify(st));
  commit(3);
  assert.deepEqual(flagged(), ['D-001'], 'flagged again the day after');
});
