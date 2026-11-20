'use strict';
// Design 9.2: a typed CONFIRM <id> creates a one-shot, 5-minute, session-bound token.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const confirm = require('../scripts/lib/confirm');

const KNOWN = ['git-reset-hard', 'chmod-wide', 'terraform-destroy'];
function dir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-confirm-'));
  fs.mkdirSync(path.join(d, '.jspark-forge'));
  return d;
}
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);

test('CONFIRM <id> in a prompt grants a token that is used once', () => {
  const d = dir();
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'ok, CONFIRM git-reset-hard', KNOWN, T0), [], 'not on a line of its own (v0.5 review S9)');
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'ok, do it\nCONFIRM git-reset-hard', KNOWN, T0), ['git-reset-hard']);
  assert.equal(confirm.consume(d, 's1', 'git-reset-hard', T0 + 1000), true);
  assert.equal(confirm.consume(d, 's1', 'git-reset-hard', T0 + 2000), false);
});

test('a token expires after 5 minutes', () => {
  const d = dir();
  confirm.grantFromPrompt(d, 's1', 'CONFIRM chmod-wide', KNOWN, T0);
  assert.equal(confirm.consume(d, 's1', 'chmod-wide', T0 + 5 * 60 * 1000 + 1), false);
});

test('a token is bound to its session and its id', () => {
  const d = dir();
  confirm.grantFromPrompt(d, 's1', 'CONFIRM chmod-wide', KNOWN, T0);
  assert.equal(confirm.consume(d, 's2', 'chmod-wide', T0 + 1), false);
  assert.equal(confirm.consume(d, 's1', 'git-reset-hard', T0 + 1), false);
  assert.equal(confirm.consume(d, 's1', 'chmod-wide', T0 + 1), true);
});

test('unknown ids are not granted; several ids in one prompt are', () => {
  const d = dir();
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'CONFIRM made-up', KNOWN, T0), []);
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'CONFIRM chmod-wide and CONFIRM terraform-destroy', KNOWN, T0).sort(),
    ['chmod-wide', 'terraform-destroy']);
});

test('the keyword is case-insensitive, the id is exact', () => {
  const d = dir();
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'confirm chmod-wide', KNOWN, T0), ['chmod-wide']);
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'CONFIRM Chmod-Wide', KNOWN, T0), []);
});

test('a prompt that only mentions the word does not grant anything', () => {
  const d = dir();
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', 'what does CONFIRM do?', KNOWN, T0), []);
});

test('a corrupt token file fails closed for consume and is replaced on grant', () => {
  const d = dir();
  fs.mkdirSync(path.join(d, '.jspark-forge', 'state'), { recursive: true });
  fs.writeFileSync(path.join(d, '.jspark-forge', 'state', 'confirm.json'), '{oops');
  assert.equal(confirm.consume(d, 's1', 'chmod-wide', T0), false);
  confirm.grantFromPrompt(d, 's1', 'CONFIRM chmod-wide', KNOWN, T0);
  assert.equal(confirm.consume(d, 's1', 'chmod-wide', T0 + 1), true);
});

// Fable code review, low: a session-long CONFIRM must be the whole message, and it expires after 12 hours.
test('CONFIRM guest-quarantine counts only as the whole message, not inside other text', () => {
  const d = dir();
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', "please don't CONFIRM guest-quarantine yet", ['guest-quarantine'], T0), []);
  assert.deepEqual(confirm.grantFromPrompt(d, 's1', '  CONFIRM guest-quarantine. ', ['guest-quarantine'], T0), ['guest-quarantine']);
});

test('a session-long token expires after 12 hours', () => {
  const d = dir();
  confirm.grantFromPrompt(d, 's1', 'CONFIRM guest-quarantine', ['guest-quarantine'], T0);
  assert.equal(confirm.consume(d, 's1', 'guest-quarantine', T0 + 11 * 3600000), true);
  assert.equal(confirm.consume(d, 's1', 'guest-quarantine', T0 + 13 * 3600000), false);
});
