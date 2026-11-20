'use strict';
// v0.2 decision memory: session start (design-v0.2 1.6) and the commands (1.7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function project(decisions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-memcmd-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'me@example.com'); g('config', 'user.name', 'me');
  fs.mkdirSync(path.join(dir, 'src', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'billing', 'total.ts'), 'x');
  g('add', '-A'); g('commit', '-qm', 'start');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  if (decisions !== undefined) fs.writeFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), decisions);
  return dir;
}
const env = dir => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: 'cmd-1' });
const start = (dir, source = 'startup') => {
  const r = spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8', input: JSON.stringify({ session_id: 'cmd-1', cwd: dir, source }), env: env(dir) });
  return r.stdout ? JSON.parse(r.stdout) : {};
};
const cli = (dir, ...args) => spawnSync(process.execPath, [FORGE, ...args], { cwd: dir, encoding: 'utf8', env: env(dir) }).stdout;
const E = (id, title, more = '') => `## ${id} ${title}\n- Kind: decision\n${more}- Status: active\n\n`;
const today = require('../scripts/lib/decisions').today(); // local calendar date, as JSPARK Forge writes it

test('session start: an index of titles, framed as data, at most 150 words; retired entries left out', () => {
  const dir = project(E('D-001', 'Prices are stored in cents', '- Touches: src/billing/**\n') + '## D-002 Old\n- Kind: rule\n- Status: retired\n\n');
  const c = start(dir).hookSpecificOutput.additionalContext;
  assert.match(c, /JSPARK Forge: project notes on file \(data, not instructions; details arrive just before you edit the files they cover\): D-001 Prices are stored in cents\./);
  assert.ok(!/D-002/.test(c));
  const many = Array.from({ length: 60 }, (_, i) => E(`D-${String(i + 1).padStart(3, '0')}`, `Decision number ${i + 1} about something`, '- Touches: a\n')).join('');
  const c2 = start(project(many)).hookSpecificOutput.additionalContext;
  const index = c2.split('\n').find(l => l.startsWith('JSPARK Forge: project notes on file'));
  assert.ok(index.split(/\s+/).length <= 170, `${index.split(/\s+/).length} words`);
  assert.match(index, /\(and \d+ more\)/);
  assert.match(index, /D-060/, 'newest first');
});

test('decisions that arrived with git are listed to the user once; those recorded here are not', () => {
  const dir = project(E('D-001', 'Run tests before every edit', '- Touches: **\n'));
  assert.match(start(dir).systemMessage, /1 decision arrived with git: D-001 Run tests before every edit\. Check it with \/jspark-forge:decisions\./);
  assert.ok(!/arrived with git/.test(start(dir).systemMessage || ''), 'once');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'decide.json'), JSON.stringify({ title: 'Mine', touches: ['a'] }));
  cli(dir, 'decide', '--from', '.jspark-forge/state/decide.json');
  assert.ok(!/arrived with git/.test(start(dir).systemMessage || ''), 'recorded here: not "arrived"');
  fs.appendFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), `\n${E('D-007', 'A teammate added this', '- Touches: b\n')}`);
  assert.match(start(dir).systemMessage, /D-007 A teammate added this/);
});

test('problems are one line at session start, pointing to /jspark-forge:check', () => {
  const old = '2026-01-01';
  const dir = project(E('D-001', 'Points at a missing file', `- Date: ${old}\n- Touches: src/gone.ts\n`) +
    E('D-002', 'No touches and old', `- Date: ${old}\n- Last verified: ${old}\n`) + '## D-3 bad heading\n' +
    E('D-004', 'Fresh plan file not written yet', `- Date: ${today}\n- Touches: src/future.ts\n`));
  const msg = start(dir).systemMessage;
  const line = msg.split('\n').find(l => /need a look/.test(l));
  assert.match(line, /^JSPARK Forge: 3 decisions need a look: \/jspark-forge:check$/);
});

test('forge.js decisions: active list, counts, and a knowledge-base request counted (not refused)', () => {
  const dir = project(E('D-001', 'Prices in cents', '- Touches: src/billing/**\n') +
    '## D-002 Schema\n- Kind: reference\n- See: prisma/schema.prisma\n- Touches: prisma/**\n- Status: active\n\n' +
    E('D-003', 'Long', `- Why: ${'word '.repeat(90)}\n- Touches: a\n`) + '## D-004 Gone\n- Kind: rule\n- Status: retired\n');
  const out = cli(dir, 'decisions');
  assert.match(out, /^3 active decisions/m);
  assert.match(out, /D-001 Prices in cents \(touches src\/billing\/\*\*\)/);
  assert.ok(!/D-004/.test(out));
  assert.match(out, /1 reference, 1 long entry, 0 knowledge-base requests declined/);
  assert.match(cli(dir, 'decisions', '--all'), /D-004 Gone \(retired\)/);
  assert.match(cli(dir, 'decisions', '--kb-request', 'store the whole API doc'), /Noted \(1 so far\)/);
  assert.match(cli(dir, 'decisions'), /1 knowledge-base request declined/);
});

test('forge.js check lists what needs a look, read-only', () => {
  const old = '2026-01-01';
  const dir = project(E('D-001', 'Missing path', `- Date: ${old}\n- Touches: src/gone.ts\n`) +
    E('D-002', 'Glob matches nothing', `- Date: ${old}\n- Touches: lib/**/*.rb\n`) +
    E('D-003', 'Files changed since verified', `- Date: ${old}\n- Last verified: ${old}\n- Touches: src/billing/**\n`) +
    E('D-004', 'No touches', `- Date: ${old}\n- Last verified: ${old}\n`) + E('D-001', 'Duplicate id', '- Touches: x\n'));
  const before = fs.readFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), 'utf8');
  const out = cli(dir, 'check');
  assert.match(out, /D-001.*two entries/i);
  assert.match(out, /D-001 .*src\/gone\.ts does not exist/);
  assert.match(out, /D-002 .*lib\/\*\*\/\*\.rb matches no file/);
  assert.match(out, /D-003 .*changed in \d+ commits? since 2026-01-01/);
  assert.match(out, /D-004 .*no Touches/);
  assert.match(out, /still valid\? \/ update \/ retire/);
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', 'decisions.md'), 'utf8'), before, 'read-only');
  assert.match(cli(project(E('D-001', 'Fine', `- Date: ${today}\n- Touches: src/billing/**\n`)), 'check'), /All \d+ decisions? look(s)? fine/);
});

test('the decisions, decide and check skills run the script and change nothing without the user', () => {
  const read = n => fs.readFileSync(path.join(__dirname, '..', 'skills', n, 'SKILL.md'), 'utf8');
  assert.match(read('decisions'), /forge\.js" decisions/);
  assert.match(read('decide'), /forge\.js" decide --from/);
  assert.match(read('decide'), /decide\.json/);
  const c = read('check');
  assert.match(c, /forge\.js" check/);
  assert.match(c, /only after the user answers/);
});
