'use strict';
// Guest mode step G1 (design-v0.1.1 section 2): one resolver decides where JSPARK Forge keeps a project's files.
// Today that is <project>/.jspark-forge/; in guest mode (G2) it will be ~/.claude/jspark-forge/guests/<id>/.
// Every module must ask the resolver, so the location can change in one place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../scripts/lib/paths');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const files = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

test('forgeDir is <project>/.jspark-forge for your own project (proven by state/ or log/)', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-paths-'));
  fs.mkdirSync(path.join(p, '.jspark-forge', 'state'), { recursive: true });
  assert.equal(paths.forgeDir(p), path.join(p, '.jspark-forge'));
  assert.equal(paths.isActive(p), true);
});

test('a .jspark-forge folder alone (as a cloned repo can ship) does not make a project yours', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-paths-'));
  fs.mkdirSync(path.join(p, '.jspark-forge'));
  fs.writeFileSync(path.join(p, '.jspark-forge', 'rules.md'), '## Settings\n');
  assert.equal(paths.isOwn(p), false);
  assert.equal(paths.isActive(p), false);
});

test('a project without one is not active', () => {
  assert.equal(paths.isActive(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-paths-'))), false);
});

test('no module builds a .jspark-forge path itself (only lib/paths.js; the wrapper runs from its own copy)', () => {
  const allowed = new Set([path.join(SCRIPTS, 'lib', 'paths.js'), path.join(SCRIPTS, 'statusline', 'wrapper.js')]);
  const offenders = [];
  for (const f of files(SCRIPTS)) {
    if (allowed.has(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/path\.join\([^)]*['"]\.jspark-forge['"]/.test(line)) offenders.push(`${path.relative(SCRIPTS, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('display paths shown to Claude: relative inside the project, absolute outside', () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-paths-'));
  assert.equal(paths.display(p, path.join(p, '.jspark-forge', 'state', 'notes.md')), '.jspark-forge/state/notes.md');
  const outside = path.join(os.tmpdir(), 'elsewhere', 'notes.md');
  assert.equal(paths.display(p, outside), outside.replace(/\\/g, '/'));
});
