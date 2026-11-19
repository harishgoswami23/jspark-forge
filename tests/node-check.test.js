'use strict';
// v0.1.1: if Node.js is missing (or older than 18) every JSPARK Forge hook fails to start, and Claude Code only says
// 'Executable not found in $PATH: "node"'. A first SessionStart hook runs WITHOUT Node, through git's own shell
// (a one-off git alias with "!"), and tells the user plainly. git is always there: JSPARK Forge needs a git project.
// This test runs the exact entry shipped in hooks/hooks.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const check = hooks.SessionStart.map(e => e.hooks[0]).find(h => h.command === 'git');

const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path');
const withoutNode = process.env[pathKey].split(path.delimiter)
  .filter(d => !['node', 'node.exe'].some(n => { try { return fs.statSync(path.join(d, n)).isFile(); } catch { return false; } }))
  .join(path.delimiter);
const fakeOldNode = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oldnode-'));
  fs.writeFileSync(path.join(d, 'node'), '#!/bin/sh\necho v16.20.0\n', { mode: 0o755 });
  return d;
};
const run = pathValue => spawnSync(check.command, check.args, { encoding: 'utf8', cwd: os.tmpdir(),
  env: Object.assign({}, process.env, { [pathKey]: pathValue }), timeout: 15000 });

test('SessionStart has a Node check that runs through git, before the Node hooks', () => {
  assert.ok(check, 'a SessionStart entry with command "git"');
  assert.equal(hooks.SessionStart[0].hooks[0].command, 'git', 'it comes first');
  assert.ok(check.timeout <= 5);
});

test('with Node 18+ present it prints nothing', () => {
  const r = run(process.env[pathKey]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('without Node it tells the user, in plain words, as a systemMessage', () => {
  const r = run(withoutNode);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.match(o.systemMessage, /JSPARK Forge is off: it needs Node\.js 18 or newer/);
  assert.match(o.systemMessage, /nodejs\.org/);
  assert.match(o.systemMessage, /nothing is saved or blocked/);
});

test('with a Node older than 18 it says the same', { skip: process.platform === 'win32' && 'a shell-script fake node is not runnable on Windows' }, () => {
  const r = run(`${fakeOldNode()}${path.delimiter}${withoutNode}`);
  assert.match(JSON.parse(r.stdout).systemMessage, /needs Node\.js 18 or newer/);
});
