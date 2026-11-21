'use strict';
// v0.7 gate results: read the text a test command printed and say how many tests passed, failed, were skipped or did
// not run, which ones failed, and (while the command is still running) how far it has got, so nobody has to read the log.
// Knows eight runners: node-test, tap, jest, vitest, pytest, playwright, mocha, go. Pure functions: no files, no processes.
//
// How it reads: one pass over the lines collects what every runner would print (its own summary lines, one line per test,
// failed names). Then the format is chosen once: a runner whose final summary is present wins (the last one in the text);
// with no summary at all, the runner with the most per-test lines wins. Counts come from the summary when it exists (it
// is the truth) and from counting per-test lines only when it does not (the run was cut off). Every line is cut to
// 4000 characters and every pattern is anchored, so a huge or hostile log cannot make this slow.

const MAX_TEXT = 20000000;
const MAX_LINE = 4000;
const MAX_NAMES = 50;
const MAX_NAME = 160;
const FORMATS = ['playwright', 'pytest', 'go', 'tap', 'node-test', 'jest', 'vitest', 'mocha'];
const KEY = { playwright: 'pw', pytest: 'py', go: 'go', tap: 'tap', 'node-test': 'node', jest: 'jest', vitest: 'vt', mocha: 'mocha' };

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const NODE_TAIL = /^ \(\d+(?:\.\d+)?ms\)(?: #.*)?$/;
const NODE_DUR = /\(\d+(?:\.\d+)?ms\)/;
const JEST_TAIL = /^ \(\d+ ms\)$/;
const VITEST_TAIL = /^ \d+(?:\.\d+)?ms$/;
const PW_TAIL = /^ \(\d+(?:\.\d+)?(?:ms|s|m)\)$/;
const PW_COUNT = /^(\d+) (failed|flaky|skipped|did not run|passed|interrupted)(?: \(.*\))?$/;
const MOCHA_COUNT = /^(\d+) (passing|failing|pending)(?: \(.*\))?$/;
const PY_SUM = /^(?:=+ )?(\d+ \w+(?:, \d+ \w+)*) in [\d.:]+s?(?: \([\d:]+\))?(?: =+)?$/;
const GO_PKG = /^(ok|FAIL)\s+\S+\s+(?:\d+(?:\.\d+)?s|\(cached\)|\[.*\])$/;

// Text -> clean text, or null when it is not text we can read.
function prep(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let t = raw.length > MAX_TEXT ? raw.slice(raw.length - MAX_TEXT) : raw;
  if (t.indexOf('\u001b') !== -1) t = t.replace(ANSI, '').replace(/\u001b/g, '');
  if (t.indexOf('\r') !== -1) t = t.replace(/\r/g, '');
  return t;
}

const bag = () => ({ list: [], seen: new Set() });

function add(b, raw) {
  if (b.list.length >= MAX_NAMES) return;
  let n = String(raw).replace(/\s+/g, ' ').trim();
  if (!n) return;
  if (n.length > MAX_NAME) n = n.slice(0, MAX_NAME - 1) + '…';
  if (b.seen.has(n)) return;
  b.seen.add(n);
  b.list.push(n);
}

// Cut a trailing piece (a time such as " (12.3ms)") off a name, when the piece matches `re`.
function cutTail(s, re, from) {
  const i = s.lastIndexOf(from);
  return i >= 0 && re.test(s.slice(i)) ? s.slice(0, i) : s;
}

// "1 failed | 10 passed (11)" -> "1 failed | 10 passed". Done with string search, not a pattern that starts anywhere:
// that pattern took seconds on a long line of spaces (review of v0.7).
function dropTotal(s) {
  const t = String(s).trimEnd();
  const i = t.lastIndexOf('(');
  return i >= 0 && /^\(\d+\)$/.test(t.slice(i)) ? t.slice(0, i).trimEnd() : t;
}

// Words like "1 failed, 10 passed" -> { failed: 1, passed: 10 }.
function counts(str, sep) {
  const out = {};
  for (const part of str.split(sep)) {
    // Trimmed first, then one greedy match from the start: a long line of spaces cannot make this slow (review of v0.7).
    const m = /^(\d+) ([a-z ]+)$/.exec(part.trim());
    if (m) out[m[2]] = (out[m[2]] || 0) + Number(m[1]);
  }
  return out;
}

function newState() {
  const S = { sum: {}, per: {}, names: {}, head: {}, nodeBlock: false, mochaFailing: false, mochaHold: null, pwRunning: false, pwInFailed: false, jestFile: '' };
  for (const f of FORMATS) {
    S.per[KEY[f]] = { p: 0, f: 0, s: 0 };
    S.names[KEY[f]] = { a: bag(), b: bag() };
  }
  S.go = { pkg: 0, lone: false, at: -1 };
  return S;
}

function flushMocha(S, next) {
  const h = S.mochaHold;
  if (!h) return;
  S.mochaHold = null;
  if (next !== null && next.endsWith(':')) add(S.names.mocha.a, h + ' ' + next.slice(0, -1));
  else add(S.names.mocha.a, h);
}

function scan(raw) {
  const text = prep(raw);
  if (text === null) return null;
  const S = newState();
  const lines = text.split('\n');
  let m;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.length > MAX_LINE) line = line.slice(0, MAX_LINE);
    let k = 0;
    while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
    if (k === line.length) continue;
    const t = line.slice(k).trimEnd();
    const c = t.charCodeAt(0);
    if (S.mochaHold) flushMocha(S, t);

    // Playwright summary block: counts, then the failed names under "N failed".
    if (c >= 48 && c <= 57 && k >= 1 && (m = PW_COUNT.exec(t))) {
      const w = m[2];
      const n = Number(m[1]);
      const p = S.sum.pw || (S.sum.pw = { at: i });
      p.at = i;
      p[w] = (p[w] || 0) + n;
      S.pwInFailed = w === 'failed' || w === 'interrupted';
      continue;
    }
    if (S.pwInFailed) {
      if (k >= 3) { add(S.names.pw.a, t); continue; }
      S.pwInFailed = false;
    }

    // Digits first: plan line, mocha counts and numbered lines, pytest summary.
    if (c >= 48 && c <= 57) {
      if (k === 0 && (m = /^1\.\.(\d+)(?:\s|$)/.exec(t))) { S.head.tap = Number(m[1]); continue; }
      if (k >= 1 && (m = MOCHA_COUNT.exec(t))) {
        const s = S.sum.mocha || (S.sum.mocha = {});
        s.at = i;
        s[m[2]] = (s[m[2]] || 0) + Number(m[1]);
        if (m[2] === 'failing') S.mochaFailing = true;
        continue;
      }
      if (k === 2 && S.mochaFailing && (m = /^\d+\) (.*)$/.exec(t))) { S.mochaHold = m[1]; continue; }
      if (k >= 4 && (m = /^\d+\) (.*)$/.exec(t))) {
        S.per.mocha.f++;
        add(S.names.mocha.b, m[1]);
        continue;
      }
    }
    if (k === 0 && (c === 61 || (c >= 48 && c <= 57)) && (m = PY_SUM.exec(t))) {
      S.sum.py = { at: i, c: counts(m[1], ', ') };
      continue;
    }

    switch (c) {
      case 0x2139: // ℹ  node-test summary
        if ((m = /^ℹ (tests|pass|fail|skipped|cancelled|todo) (\d+)$/.exec(t))) {
          const s = S.sum.node || (S.sum.node = {});
          s.at = i;
          s[m[1]] = Number(m[2]);
        }
        break;
      case 0x2714: // ✔
      case 0x2716: // ✖
      case 0xfe63: { // ﹣
        if (t.charCodeAt(1) !== 32) break;
        const rest = t.slice(2);
        if (c === 0x2716 && rest.startsWith('failing tests:')) { S.nodeBlock = true; break; }
        const dur = NODE_DUR.test(rest);
        if (c === 0x2716) {
          if (S.nodeBlock) add(S.names.node.a, cutTail(rest, NODE_TAIL, ' ('));
          else if (dur) {
            S.per.node.f++;
            add(S.names.node.b, cutTail(rest, NODE_TAIL, ' ('));
          }
        } else if (dur) {
          if (!S.nodeBlock) {
            if (c === 0x2714) S.per.node.p++;
            else S.per.node.s++;
          }
        } else if (c === 0x2714 && k >= 2) S.per.mocha.p++;
        break;
      }
      case 0x2713: // ✓  jest, vitest, mocha or playwright
      case 0x2718: // ✘  playwright
        if (k >= 1 && pwLine(S, t, c === 0x2713 ? 'p' : 'f')) break;
        if (c === 0x2718) break;
        if (t.charCodeAt(1) !== 32) break;
        {
          const rest = t.slice(2);
          if (cutTail(rest, JEST_TAIL, ' (') !== rest) S.per.jest.p++;
          else if (/\(\d+ tests?\b/.test(rest)) break; // a vitest file line, not a test
          else if (cutTail(rest, VITEST_TAIL, ' ') !== rest) S.per.vt.p++;
          else if (k >= 2) S.per.mocha.p++;
        }
        break;
      case 0x2715: // ✕  jest fail
        if (t.charCodeAt(1) === 32) {
          S.per.jest.f++;
          add(S.names.jest.b, cutTail(t.slice(2), JEST_TAIL, ' ('));
        }
        break;
      case 0x25cb: // ○  jest skipped
        if (t.charCodeAt(1) === 32) S.per.jest.s++;
        break;
      case 0xd7: // ×  vitest fail
        if (k >= 1 && t.charCodeAt(1) === 32) {
          S.per.vt.f++;
          add(S.names.vt.b, cutTail(t.slice(2), VITEST_TAIL, ' '));
        }
        break;
      case 0x2193: // ↓  vitest skipped
        if (k >= 1 && t.charCodeAt(1) === 32) S.per.vt.s++;
        break;
      case 0x25cf: // ●  jest failed name
        if (k === 2 && t.charCodeAt(1) === 32) {
          const name = t.slice(2);
          if (name.startsWith('Console')) break;
          if (name.endsWith('Test suite failed to run')) {
            add(S.names.jest.a, S.jestFile ? S.jestFile + ' (test suite failed to run)' : 'Test suite failed to run');
          } else add(S.names.jest.a, name);
        }
        break;
      case 45: // -
        if (t.startsWith('--- ') && (m = /^--- (PASS|FAIL|SKIP): (\S+)/.exec(t))) {
          if (m[1] === 'PASS') S.per.go.p++;
          else if (m[1] === 'SKIP') S.per.go.s++;
          else { S.per.go.f++; add(S.names.go.a, m[2]); }
          break;
        }
        if (k >= 1 && pwLine(S, t, 's')) break;
        if (k >= 4 && t.charCodeAt(1) === 32) S.per.mocha.s++;
        break;
      case 111: // o  "ok 3 - name" or "ok  pkg 0.5s" or playwright "ok 12 ..."
        if (k === 0) {
          if ((m = /^ok (\d+)(.*)$/.exec(t))) { tapLine(S, true, m[2]); break; }
          if (GO_PKG.test(t)) { S.go.pkg++; S.go.at = i; }
        } else pwLine(S, t, 'p');
        break;
      case 120: // x  playwright on Windows
        if (k >= 1) pwLine(S, t, 'f');
        break;
      case 110: // n  "not ok 3 - name"
        if (k === 0 && (m = /^not ok (\d+)(.*)$/.exec(t))) tapLine(S, false, m[2]);
        break;
      case 35: // #  tap summary
        if (k === 0 && (m = /^# (tests|pass|fail|skipped|skip|cancelled|todo) (\d+)$/.exec(t))) {
          const s = S.sum.tap || (S.sum.tap = {});
          s.at = i;
          s[m[1] === 'skip' ? 'skipped' : m[1]] = Number(m[2]);
        }
        break;
      case 84: // T  jest "Tests:" or vitest "Tests  "
        if (k === 0 && t.startsWith('Tests:')) S.sum.jest = { at: i, c: counts(t.slice(6), ',') };
        else if ((m = /^Tests +(\d.*)$/.exec(t))) S.sum.vt = { at: i, c: counts(dropTotal(m[1]), '|') };
        break;
      case 82: // R  playwright header
        if (k === 0 && (m = /^Running (\d+) tests? using/.exec(t))) { S.head.pw = Number(m[1]); S.pwRunning = true; }
        break;
      case 99: // c  pytest "collected 63 items"
        if (k === 0 && (m = /^collected (\d+) items?/.exec(t))) S.head.py = Number(m[1]);
        break;
      case 80: // P  go "PASS"
        if (k === 0 && t === 'PASS') { S.go.lone = true; S.go.at = i; }
        break;
      case 70: // F  FAILED / FAIL
        if (k === 0 && t.startsWith('FAILED ')) {
          add(S.names.py.a, beforeDash(t.slice(7)));
        } else if (k === 0 && t === 'FAIL') {
          S.go.lone = true;
          S.go.at = i;
        } else if (k === 0 && GO_PKG.test(t)) {
          S.go.pkg++;
          S.go.at = i;
        } else if (k === 0 && (m = /^FAIL +(\S.*)$/.exec(t))) {
          S.jestFile = m[1].trim();
        } else if (k >= 1 && (m = /^FAIL {2}(.+)$/.exec(t))) {
          add(S.names.vt.a, m[1]);
        }
        break;
      case 69: // E  pytest "ERROR path::name - message"
        if (k === 0 && t.startsWith('ERROR ')) add(S.names.py.a, beforeDash(t.slice(6)));
        break;
      default:
        break;
    }
    // pytest progress lines: "tests/test_a.py ..F.s    [ 45%]"
    if (k === 0 && t.indexOf('.py ') > 0 && (m = /^(\S+\.py) +([.FEsxX]+)(?: +\[ *\d+%\])?$/.exec(t))) {
      const s = m[2];
      for (let j = 0; j < s.length; j++) {
        const ch = s[j];
        if (ch === '.' || ch === 'X') S.per.py.p++;
        else if (ch === 'F' || ch === 'E') S.per.py.f++;
        else S.per.py.s++;
      }
    }
  }
  if (S.mochaHold) flushMocha(S, null);
  return S;
}

function beforeDash(s) {
  const i = s.indexOf(' - ');
  return i < 0 ? s : s.slice(0, i);
}

// A playwright per-test line: "✓  12 [chromium] › file:1:1 › title (1.2s)". `kind` is p, f or s.
function pwLine(S, t, kind) {
  const m = /^(✓|✘|ok|x|-)\s+\d+\s+(.*)$/.exec(t);
  if (!m || t.indexOf('›') === -1) return false;
  const sym = m[1];
  if ((sym === 'ok' || sym === 'x') && !S.pwRunning) return false;
  if (t.indexOf('(retry #') !== -1) return true; // a retry of a test already counted
  const per = S.per.pw;
  if (sym === '✓' || sym === 'ok') per.p++;
  else if (sym === '✘' || sym === 'x') {
    per.f++;
    add(S.names.pw.b, cutTail(m[2], PW_TAIL, ' ('));
  } else per.s++;
  return true;
}

function tapLine(S, ok, rest) {
  let r = rest.startsWith(' - ') ? rest.slice(3) : rest.trim();
  let dir = '';
  const h = r.lastIndexOf(' # ');
  if (h >= 0) { dir = r.slice(h + 3).toLowerCase(); r = r.slice(0, h); }
  const per = S.per.tap;
  if (dir.startsWith('skip') || dir.startsWith('todo')) per.s++;
  else if (ok) per.p++;
  else { per.f++; add(S.names.tap.a, r); }
}

const n0 = v => v || 0;

// What a runner's own summary says, or null when it has not printed one.
function summaryOf(S, f) {
  const s = S.sum;
  switch (f) {
    case 'node-test':
    case 'tap': {
      const x = f === 'tap' ? s.tap : s.node;
      if (!x || x.tests === undefined) return null;
      return { at: x.at, passed: n0(x.pass), failed: n0(x.fail) + n0(x.cancelled), skipped: n0(x.skipped) + n0(x.todo), notRun: 0, flaky: 0 };
    }
    case 'jest': {
      const x = s.jest;
      if (!x) return null;
      return { at: x.at, passed: n0(x.c.passed), failed: n0(x.c.failed), skipped: n0(x.c.skipped) + n0(x.c.todo), notRun: 0, flaky: 0 };
    }
    case 'vitest': {
      const x = s.vt;
      if (!x) return null;
      return { at: x.at, passed: n0(x.c.passed), failed: n0(x.c.failed), skipped: n0(x.c.skipped) + n0(x.c.todo), notRun: 0, flaky: 0 };
    }
    case 'pytest': {
      const x = s.py;
      if (!x) return null;
      const c = x.c;
      return {
        at: x.at,
        passed: n0(c.passed) + n0(c.xpassed),
        failed: n0(c.failed) + n0(c.error) + n0(c.errors),
        skipped: n0(c.skipped) + n0(c.xfailed),
        notRun: 0,
        flaky: 0
      };
    }
    case 'playwright': {
      const x = s.pw;
      if (!x) return null;
      return { at: x.at, passed: n0(x.passed), failed: n0(x.failed) + n0(x.interrupted), skipped: n0(x.skipped), notRun: n0(x['did not run']), flaky: n0(x.flaky) };
    }
    case 'mocha': {
      const x = s.mocha;
      if (!x) return null;
      return { at: x.at, passed: n0(x.passing), failed: n0(x.failing), skipped: n0(x.pending), notRun: 0, flaky: 0 };
    }
    case 'go': {
      const per = S.per.go;
      if (!(S.go.pkg > 0 || (S.go.lone && per.p + per.f + per.s > 0))) return null;
      return { at: S.go.at, passed: per.p, failed: per.f, skipped: per.s, notRun: 0, flaky: 0 };
    }
    default:
      return null;
  }
}

// The one format to read: the last runner with a final summary, else the one with the most per-test lines.
function choose(S) {
  let best = null;
  let bestAt = -1;
  for (const f of FORMATS) {
    const sm = summaryOf(S, f);
    if (sm && sm.at >= bestAt) { best = f; bestAt = sm.at; }
  }
  if (best) return best;
  let score = 0;
  for (const f of FORMATS) {
    const per = S.per[KEY[f]];
    const sc = per.p + per.f + per.s + (hasHead(S, f) ? 1 : 0);
    if (sc > score) { best = f; score = sc; }
  }
  return best;
}

function hasHead(S, f) {
  return (f === 'playwright' && S.head.pw !== undefined) || (f === 'pytest' && S.head.py !== undefined) || (f === 'tap' && S.head.tap !== undefined);
}

function namesOf(S, f) {
  const n = S.names[KEY[f]];
  return (n.a.list.length ? n.a.list : n.b.list).slice(0, MAX_NAMES);
}

// Text -> the final counts and failed names, or null when no known runner's result is in the text.
function summarize(text) {
  try {
    const S = scan(text);
    if (!S) return null;
    const f = choose(S);
    if (!f) return null;
    const sm = summaryOf(S, f);
    const per = S.per[KEY[f]];
    const r = sm
      ? { passed: sm.passed, failed: sm.failed, skipped: sm.skipped, notRun: sm.notRun, runnerFlaky: sm.flaky }
      : { passed: per.p, failed: per.f, skipped: per.s, notRun: 0, runnerFlaky: 0 };
    return {
      format: f,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      notRun: r.notRun,
      total: r.passed + r.failed + r.skipped + r.notRun,
      runnerFlaky: r.runnerFlaky,
      failedNames: namesOf(S, f)
    };
  } catch (e) {
    return null;
  }
}

// Text of a run still being written -> { format, done, failed, total }, or null when nothing can be counted yet.
function progress(text) {
  try {
    const S = scan(text);
    if (!S) return null;
    const f = choose(S);
    if (!f) return null;
    const per = S.per[KEY[f]];
    const sm = summaryOf(S, f);
    let done = per.p + per.f + per.s;
    let failed = per.f;
    let total = null;
    if (f === 'playwright' && S.head.pw !== undefined) total = S.head.pw;
    else if (f === 'pytest' && S.head.py !== undefined) total = S.head.py;
    else if (f === 'tap' && S.head.tap !== undefined) total = S.head.tap;
    if (done === 0 && sm) {
      done = sm.passed + sm.failed + sm.skipped;
      failed = sm.failed;
    }
    if (total === null && sm) total = sm.passed + sm.failed + sm.skipped + sm.notRun;
    return { format: f, done, failed, total };
  } catch (e) {
    return null;
  }
}

function oneLine(sum) {
  const s = sum || {};
  let out = `${n0(s.passed)} passed, ${n0(s.failed)} failed, ${n0(s.skipped)} skipped`;
  if (n0(s.notRun) > 0) out += `, ${s.notRun} not run`;
  if (n0(s.runnerFlaky) > 0) out += `, ${s.runnerFlaky} flaky (the runner's own word)`;
  return out;
}

function progressLine(p) {
  const x = p || {};
  const head = x.total === null || x.total === undefined ? `${n0(x.done)} tests done` : `${n0(x.done)} of ${x.total} tests done`;
  return `${head}, ${n0(x.failed)} failed`;
}

module.exports = { summarize, progress, oneLine, progressLine };
