'use strict';
// v0.5.1 gaps 6 and 8 (rule promotion): the long-entry hint, and `decide --promote`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gdec-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', '.gitignore'), '*\n!.gitignore\n!rules.md\n');
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const decide = (dir, args, json) => {
  if (json) fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify(json));
  return spawnSync(process.execPath, [FORGE, 'decide', ...(json ? ['--from', '.jspark-forge/state/decide.json'] : []), ...args],
    { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'gd-1' }) }).stdout;
};

test('gap 6: a short decision gets no long-entry hint, whatever it touches (a folder, a glob, many paths)', () => {
  const dir = project();
  for (const touches of [['src/billing/'], ['src/**'], ['a/', 'b/', 'c/', 'd/', 'e/', 'f/', 'g/', 'h/']]) {
    const out = decide(dir, [], { title: 'Prices are stored in cents', why: 'no rounding errors', touches });
    assert.match(out, /^Recorded D-\d+/);
    assert.doesNotMatch(out, /Long entries|long entries/);
  }
});

test('gap 6: only a title and why of more than 80 words get the hint, which says how long the entry is', () => {
  const dir = project();
  const why = Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ');
  const out = decide(dir, [], { title: 'A decision', why, touches: ['x/'] });
  assert.match(out, /title and why are 92 words \(over 80\)/);
  assert.match(out, /Long entries go stale and cost tokens on every matching edit; for detail, consider a reference entry pointing to a doc\./);
  const exactly = Array.from({ length: 78 }, (_, i) => `w${i}`).join(' ');
  assert.doesNotMatch(decide(dir, [], { title: 'Two words', why: exactly }), /Long entries/, '80 words is not over 80');
});
