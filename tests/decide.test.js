'use strict';
// v0.2 decision memory, recording (design-v0.2 sections 1.1, 1.4, 1.5): `forge.js decide` is the only writer of
// decisions.md. It reads the entry from a file (never the command line), validates it, keeps every other byte, never
// reuses an id, refuses duplicates, and says "Recorded D-0xx" in the conversation every time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { parse } = require('../scripts/lib/decisions');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-decide-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', '.gitignore'), '*\n!.gitignore\n!rules.md\n');
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const F = dir => path.join(dir, '.jspark-forge', 'decisions.md');
const decide = (dir, args, json) => {
  if (json) fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify(json));
  const r = spawnSync(process.execPath, [FORGE, 'decide', ...(json ? ['--from', '.jspark-forge/state/decide.json'] : []), ...args],
    { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'dec-1' }) });
  return r.stdout;
};
const hook = (dir, event, input) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 'dec-1', cwd: dir }, input)), env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};

test('records an entry from a file: next id, fields, "drafted by Claude", and the .gitignore line for the file', () => {
  const dir = project();
  const out = decide(dir, [], { title: 'Prices are stored in cents', touches: ['src/billing/**'], why: 'no rounding errors', source: 'commit 3f2e1d0', drafted: true });
  assert.match(out, /^Recorded D-001: Prices are stored in cents \(touches src\/billing\/\*\*\)/);
  const e = parse(fs.readFileSync(F(dir), 'utf8')).entries[0];
  assert.equal(e.id, 'D-001');
  assert.equal(e.by, 'you (drafted by Claude)');
  assert.deepEqual(e.touches, ['src/billing/**']);
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', '.gitignore'), 'utf8'), /^!decisions\.md$/m);
});

test('quotes, $( ) and backticks in the text arrive as written (no shell in between)', () => {
  const dir = project();
  decide(dir, [], { title: 'Never run `rm -rf $(pwd)` in "deploy.sh"', touches: ['deploy.sh'] });
  assert.equal(parse(fs.readFileSync(F(dir), 'utf8')).entries[0].title, 'Never run `rm -rf $(pwd)` in "deploy.sh"');
});

test('bad input is refused with a reason and writes nothing', () => {
  const dir = project();
  for (const [json, why] of [[{ touches: ['a.ts'] }, /title/], [{ title: 'x', kind: 'wish' }, /kind/],
    [{ title: 'x', touches: ['../outside.ts'] }, /inside the project/], [{ title: 'x', touches: ['/etc/passwd'] }, /inside the project/],
    [{ title: 'x', kind: 'reference', see: '.env' }, /secret|inside/]]) {
    assert.match(decide(dir, [], json), why);
  }
  assert.ok(!fs.existsSync(F(dir)));
});

test('ids are never reused, even after an entry is deleted by hand', () => {
  const dir = project();
  decide(dir, [], { title: 'One', touches: ['a'] });
  decide(dir, [], { title: 'Two', touches: ['b'] });
  fs.writeFileSync(F(dir), fs.readFileSync(F(dir), 'utf8').replace(/## D-002[\s\S]*$/, ''));
  assert.match(decide(dir, [], { title: 'Three', touches: ['c'] }), /Recorded D-003/);
});

test('verify, update and retire change only that entry; every other byte stays', () => {
  const dir = project();
  decide(dir, [], { title: 'One', touches: ['a'] });
  decide(dir, [], { title: 'Two', touches: ['b'] });
  fs.appendFileSync(F(dir), '\nA note the team wrote by hand.\n');
  const before = fs.readFileSync(F(dir), 'utf8');
  assert.match(decide(dir, ['--verify', 'D-001']), /D-001 still valid/);
  assert.match(decide(dir, [], { update: 'D-002', title: 'Two, renamed' }), /Updated D-002/);
  assert.match(decide(dir, ['--retire', 'D-001', '--by', 'D-002']), /Retired D-001/);
  const after = parse(fs.readFileSync(F(dir), 'utf8')).entries;
  assert.equal(after[0].status, 'superseded by D-002');
  assert.equal(after[1].title, 'Two, renamed');
  assert.match(fs.readFileSync(F(dir), 'utf8'), /A note the team wrote by hand\./);
  assert.equal(fs.readFileSync(F(dir), 'utf8').split('\n').length, before.split('\n').length, 'no lines added or lost');
});

test('two entries with the same id (two branches merged) are refused until one is renamed', () => {
  const dir = project();
  decide(dir, [], { title: 'One', touches: ['a'] });
  fs.appendFileSync(F(dir), '\n## D-001 From the other branch\n- Kind: rule\n- Status: active\n');
  assert.match(decide(dir, ['--verify', 'D-001']), /two entries.*D-001/i);
});

test('a long entry is accepted, with one suggestion to use a reference instead (once)', () => {
  const dir = project();
  const why = Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ');
  assert.match(decide(dir, [], { title: 'Long one', why, touches: ['a'] }), /long entries go stale/i);
  assert.ok(!/long entries go stale/i.test(decide(dir, [], { title: 'Long two', why, touches: ['b'] })), 'said once');
});

test('the conversation is told every time something is recorded (so it can never happen unseen)', () => {
  const dir = project();
  decide(dir, [], { title: 'Sessions use signed cookies', touches: ['src/auth.ts'] });
  const o = hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'node forge.js decide --from .jspark-forge/state/decide.json' } });
  assert.match(o.systemMessage, /JSPARK Forge recorded D-001: Sessions use signed cookies/);
  const again = hook(dir, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.ok(!again || !/recorded D-001/.test(again.systemMessage || ''), 'said once');
});

test('in a repo you are reviewing, decide refuses (decision memory is off)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-decide-guest-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [FORGE, 'decide', '--verify', 'D-001'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
  assert.match(r.stdout, /not set up|reviewing/);
});
