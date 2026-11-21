'use strict';
// tests/helpers/timing.js: a speed test must still fail for code that got slower, and must not fail only because the
// machine was busy (2026-11-22: a release waited on Docker being stopped).
const test = require('node:test');
const assert = require('node:assert/strict');
const { cost, fastEnough, say } = require('./helpers/timing');

const burn = ms => { const end = Date.now() + ms; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); return x; };
const idle = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); // the clock moves, the processor rests

test('work that uses the processor for longer than the limit is too slow', () => {
  const m = cost(() => burn(400));
  assert.ok(m.wall >= 390 && m.cpu >= 200, say(m));
  assert.equal(fastEnough(m, 150), false, say(m));
});

test('time that passed without processor work (a busy machine) does not count against the code', () => {
  const m = cost(() => idle(400));
  assert.ok(m.wall >= 390, say(m));
  assert.ok(m.cpu < 150, say(m));
  assert.equal(fastEnough(m, 150), true, say(m));
});

test('cost returns what the work returned, and say names both times', () => {
  const m = cost(() => 42);
  assert.equal(m.value, 42);
  assert.match(say(m), /^\d+ ms on the clock, \d+ ms of processor time$/);
});
