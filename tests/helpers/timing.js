'use strict';
// Speed tests that hold on a busy machine.
//
// A speed test guards against code that got slower (a loop that re-reads its output, a pattern that backtracks). Such
// code uses more processor time. A busy machine (Docker, a second test run) makes the clock time longer but not the
// processor time this process used. So a piece of work is fast enough when EITHER its clock time OR its processor time
// is under the limit: a real regression is over both; a busy machine is over the clock only.
//
// Not for work that can stall while using no processor (waiting on a network path, a lock, a child process): there
// the clock is the only measure, and the test keeps its plain Date.now() check.

// -> { value, wall, cpu }: what fn returned, clock ms, and ms of processor time (user + system) this process used.
function cost(fn) {
  const c0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  const value = fn();
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  const c = process.cpuUsage(c0);
  return { value, wall, cpu: (c.user + c.system) / 1000 };
}

const fastEnough = (m, limitMs) => Math.min(m.wall, m.cpu) < limitMs;
const say = m => `${Math.round(m.wall)} ms on the clock, ${Math.round(m.cpu)} ms of processor time`;

module.exports = { cost, fastEnough, say };
