'use strict';
// v0.5.1 gaps 5: the "needs trust" text must not read as an instruction to run the listed commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-trust-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'g.md'), text);
  return dir;
}
const cli = (dir, args) => spawnSync(process.execPath, [FORGE, 'graph', ...args], { cwd: dir, encoding: 'utf8',
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'tr-1', CLAUDE_CODE_SESSION_ATTENDED: '1' }) }).stdout;

test('gap 5: the trust text says the graph runs the commands itself and you do not type them', () => {
  const dir = project('# Graph: g\n## checks (gate)\n- run: npm test\n- run: npm run lint\n');
  const out = cli(dir, ['start', 'g']);
  assert.match(out, /will run these commands by itself at its check steps \(you do not type them\):/);
  assert.match(out, /- npm test\n- npm run lint\n/);
  assert.match(out, /To allow it, send exactly this as your whole message: TRUST GRAPH g/);
  assert.doesNotMatch(out, /on your machine/);
  assert.doesNotMatch(out, /the user types/);
  const lines = out.split('\n');
  assert.ok(lines.findIndex(l => /do not type them/.test(l)) < lines.findIndex(l => l === '- npm test'), 'the warning comes before the list');
});
