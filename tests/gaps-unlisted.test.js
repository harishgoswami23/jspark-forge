'use strict';
// v0.5.1 gaps, item 1 leftovers (principle 9): a page or document written to a temporary folder that is not in the
// project and was never listed is found from the action log at session start, at most once a day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const log = require('../scripts/lib/log');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const mk = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
function project() {
  const dir = mk('forge-unl-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const logged = (dir, kind, file, when = new Date()) => log.append(dir, { time: when, session: 'unl-0001', kind, detail: file.replace(/\\/g, '/') });
const start = (dir, config = mk('forge-unl-cfg-')) => {
  const r = spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'unl-0002', cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: config, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  return String((JSON.parse(r.stdout || '{}')).systemMessage || '');
};
const tempDoc = (name, body = 'x') => { const f = path.join(mk('forge-unl-t-'), name); fs.writeFileSync(f, body); return f; };
const DAY = 86400000;

test('lists a temp document that is not in the project, once a day', () => {
  const dir = project();
  const f = tempDoc('report.html');
  logged(dir, 'WRITE', f);
  const msg = start(dir);
  assert.match(msg, /These documents were written to a temporary folder and are not in the project: /);
  assert.ok(msg.includes(f.replace(/\\/g, '/')));
  assert.match(msg, /Ask Claude to save the ones you need\./);
  assert.ok(!/These documents were written/.test(start(dir)), 'not again the same day');
});

test('leaves out: missing file, other extension, a same-name file in the project, a file inside the project, an old log line', () => {
  const dir = project();
  const gone = tempDoc('gone.md'); fs.unlinkSync(gone);
  const txt = tempDoc('notes.txt');
  const kept = tempDoc('kept.pdf');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'kept.pdf'), 'copy');
  const inside = path.join(dir, 'inside.md'); fs.writeFileSync(inside, 'x');
  const old = tempDoc('old.html');
  const bash = tempDoc('bashed.md');
  logged(dir, 'WRITE', gone); logged(dir, 'WRITE', txt); logged(dir, 'EDIT', kept); logged(dir, 'WRITE', inside);
  logged(dir, 'WRITE', old, new Date(Date.now() - 3 * DAY));
  logged(dir, 'BASH', bash);
  assert.ok(!/These documents were written/.test(start(dir)));
});

test('a same-name copy kept under .jspark-forge/artifacts counts as in the project', () => {
  const dir = project();
  const f = tempDoc('page.html');
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'artifacts', 'page.html'), 'copy');
  logged(dir, 'WRITE', f);
  assert.ok(!/These documents were written/.test(start(dir)));
});

test('yesterday counts; at most 5 are listed, each once', () => {
  const dir = project();
  const files = Array.from({ length: 7 }, (_, i) => tempDoc(`doc${i}.md`));
  files.forEach(f => logged(dir, 'WRITE', f, new Date(Date.now() - DAY)));
  logged(dir, 'EDIT', files[0]);
  const msg = start(dir);
  const listed = files.filter(f => msg.includes(f.replace(/\\/g, '/')));
  assert.equal(listed.length, 5);
  assert.match(msg, /\(\+2 more\)/);
});
