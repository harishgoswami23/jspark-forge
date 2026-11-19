'use strict';
// Owner 2026-11-19: one marketplace lists JSPARK Forge and superpowers (superpowers by its own repo, pinned,
// never copied into this repo), so users add one marketplace and install both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mk = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
const byName = n => mk.plugins.find(p => p.name === n);

test('the marketplace is named jspark-forge and lists both plugins', () => {
  assert.equal(mk.name, 'jspark-forge');
  assert.ok(mk.owner && mk.owner.name);
  assert.deepEqual(mk.plugins.map(p => p.name).sort(), ['jspark-forge', 'superpowers']);
});

test('JSPARK Forge comes from this repo', () => {
  assert.equal(byName('jspark-forge').source, './');
});

test('superpowers comes from its own GitHub repo at a pinned commit, not from a copy', () => {
  const s = byName('superpowers').source;
  assert.equal(s.source, 'url');
  assert.equal(s.url, 'https://github.com/obra/superpowers.git');
  assert.match(s.sha, /^[0-9a-f]{40}$/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'skills', 'brainstorming')), 'no superpowers skills copied in');
});

test('init suggests the one-line install from this marketplace', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'init.js'), 'utf8');
  assert.match(src, /\/plugin install superpowers@jspark-forge/);
});
