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

test('JSPARK Forge declares superpowers as a dependency, so installing one installs both (owner 2026-11-19)', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.deepEqual(p.dependencies, ['superpowers'], 'bare name: resolved against our own marketplace');
  assert.deepEqual(byName('jspark-forge').dependencies, ['superpowers'], 'marketplace entry matches plugin.json');
});

test('v0.4.2: the version is set once, in plugin.json (Claude Code docs: not in both plugin.json and the marketplace entry)', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, p.version, 'package.json follows plugin.json');
  assert.equal(byName('jspark-forge').version, undefined, 'no version in the marketplace entry');
});

const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const installSection = () => {
  const i = README.indexOf('\n## Install');
  const j = README.indexOf('\n## ', i + 4);
  return README.slice(i, j);
};

test('v0.5: the README install section has one command and lists what JSPARK Forge sets up with each undo', () => {
  const s = installSection();
  assert.equal((s.match(/^```/gm) || []).length, 2, 'exactly one fenced block');
  for (const t of ['auto-update', 'code-map: off', 'playwright: off',
    '/plugin uninstall frontend-design@claude-plugins-official', 'JSPARK_FORGE_AUTO_SETUP=off']) {
    assert.ok(s.includes(t), t);
  }
  assert.ok(!s.includes('turn on updates'));
});

test('v0.5: the README no longer says JSPARK Forge never installs anything', () => {
  assert.ok(!README.includes('never installs it'));
  assert.ok(!README.includes('never installs anything'));
});

test('v0.5: versions are 0.5.0 in plugin.json and package.json', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(p.version, '0.5.0');
  assert.equal(pkg.version, '0.5.0');
});
