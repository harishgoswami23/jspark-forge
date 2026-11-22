'use strict';
// v0.4 build graph runner (design-v0.4 revision 2). Claude runs the loop through /jspark-forge:build; this module keeps
// the record and checks what can be checked: a valid graph, trusted commands, protected state (the block list denies
// writes to it), outputs that are declared and real, helper evidence, gate results from real exit codes, human steps
// completed only by the user's own message, one run at a time, and a cap on handed-out steps.
// The run keeps the graph it started with (v0.4 code review H2): `start` records every step's kind, helper, needs,
// gives, run lines and say in the run state, and everything after uses only that copy. A changed graph file stops the
// run at the next `graph next`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const paths = require('./paths');
const G = require('./graph');
const P = require('./preflight'); // v0.7: what must be true before a gate starts
const R = require('./gate-results'); // v0.7: counts and failing test names read from a test runner's output

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const STEP = G.ID;
const MAX_VALUE = 500;
const OWNER_IDLE_MS = 30 * 60 * 1000; // an owner seen within this is live: another session must take over on purpose
const SEEN_EVERY_MS = 60 * 1000; // hooks note the owner's activity at most this often
const LOCK_WAIT_MS = 4000;
const LOCK_STALE_MS = 10000;
const FORGE_JS = path.join(__dirname, '..', 'forge.js').replace(/\\/g, '/');
const graphFile = (dir, n) => path.join(paths.repoForgeDir(dir), 'graphs', `${n}.md`);
const stateFile = (dir, n) => path.join(paths.forgeDir(dir), 'state', `graph-${n}.json`);
const trustFile = dir => path.join(paths.forgeDir(dir), 'state', 'graph-trust.json');
const activeFile = dir => path.join(paths.forgeDir(dir), 'state', 'graph-active.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); require('./fsx').writeAtomic(f, `${JSON.stringify(v, null, 1)}\n`); };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const clean = (s, n) => require('./memory').clean(s, n);
const BAD_NAME = 'A graph name is lower-case letters, digits and dashes, starting with a letter (for example ship-feature).\n';

// ---------- the lock ----------
// Around every read-modify-write of one file, so parallel reports and hooks never lose each other's updates. A lock
// is taken over only when it is older than 10 s and still holds the same token; after about 4 s of waiting the
// command fails with "busy" rather than run unlocked.
class Busy extends Error { constructor() { super('busy, try again'); this.busy = true; } }
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
function takeStale(lock) {
  try {
    const token = readText(lock);
    if (token === null || Date.now() - fs.statSync(lock).mtimeMs <= LOCK_STALE_MS) return;
    if (readText(lock) === token) fs.unlinkSync(lock);
  } catch { /* gone or taken */ }
}
function withLock(file, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const until = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch {
      takeStale(lock);
      if (Date.now() >= until) throw new Busy();
      sleep(10);
    }
  }
  try { fs.writeSync(fd, token); } catch { /* an empty lock still locks */ }
  try { return fn(); } finally {
    try { fs.closeSync(fd); } catch { /* closed */ }
    try { if (readText(lock) === token) fs.unlinkSync(lock); } catch { /* gone */ }
  }
}
function update(dir, n, fn) {
  const f = stateFile(dir, n);
  return withLock(f, () => { const s = readJson(f); if (!s) return fn(null); const r = fn(s); writeJson(f, s); return r; });
}

// ---------- the graph and its trust ----------
function load(dir, n) {
  if (!NAME.test(String(n || ''))) return { error: BAD_NAME.trim() };
  let text;
  try { text = fs.readFileSync(graphFile(dir, n), 'utf8'); } catch { return { error: `No graph .jspark-forge/graphs/${n}.md.` }; }
  const g = G.parse(text);
  const errs = G.validate(g, n);
  // v0.7: a gate's "retry:" line is a command too, so it is shown and trusted with the "run:" lines. A gate without
  // one keeps its old entry, so a graph trusted before v0.7 is not asked about again.
  const runs = g.steps.filter(s => s.kind === 'gate').flatMap(s => s.run.concat(retryOf(s) ? [retryOf(s)] : []));
  // What TRUST GRAPH covers (re-review M6): the gate commands and which steps are gates and human steps, so dropping
  // a gate or a human step is a change the user is asked about.
  const guard = { gates: g.steps.filter(s => s.kind === 'gate').map(s => (retryOf(s) ? [s.id, s.run, retryOf(s)] : [s.id, s.run])), human: g.steps.filter(s => s.kind === 'human').map(s => s.id) };
  // A human step marked "- ahead: no" can never be approved ahead; taking the mark away is a change the user is asked
  // about. A graph without the mark keeps its old entry, so it is not asked about again.
  const noAhead = g.steps.filter(s => s.kind === 'human' && s.ahead === 'no').map(s => s.id);
  if (noAhead.length) guard.noAhead = noAhead;
  // "- lock: <name>" declares the graph safe to run beside graphs with another lock name: the person's call.
  if (g.lock) guard.lock = g.lock;
  // An approval given ahead holds only while every step is as it was: any change to the steps cancels it.
  let stepsHash = '';
  if (!errs.length) { try { stepsHash = sha(JSON.stringify(snapshot(g))); } catch { /* cannot be approved ahead */ } }
  return { text, g, errs, hash: sha(text), runs, guard, runHash: sha(JSON.stringify(guard)), stepsHash };
}
const retryOf = s => (s.retries && s.retries[0] && s.retries[0].value) || '';
// The part of the graph a run depends on, copied into the run state at start.
// v0.7: a gate's "before:" lines (already read into their fixed forms) and its "retry:" command.
function snapshot(g) {
  return { maxParallel: g.maxParallel, lock: g.lock || '', steps: g.steps.map(s => ({ id: s.id, kind: s.kind, helper: s.helper || '', brief: s.brief || '',
    needs: s.needs.slice(), gives: s.gives.slice(), after: s.after.slice(), steps: s.steps.slice(), run: s.run.slice(), say: s.say || '',
    estimate: s.estimate || '', ahead: s.kind === 'human' && s.ahead === 'no' ? 'no' : '',
    before: s.kind === 'gate' ? (s.before || []).map(b => P.parse(b.value)).filter(p => !p.error) : [],
    retry: s.kind === 'gate' ? retryOf(s) : '' })) };
}
// Trust (design-v0.4 2, review M1): { asked: { name: hash of what `start` showed }, trusted: { name: hash } }.
// TRUST GRAPH <name> trusts only what was shown. A graph without commands needs no trust the first time, and its
// first start records its hash; from then on (and for any graph once trusted) a different hash asks again, even with
// no gate left (re-review M6).
// ahead: { name: { step: { at, say, steps } } }: approvals the person gave before the graph was started (below).
const trustOf = dir => { const t = readJson(trustFile(dir)) || {}; return { asked: t.asked || {}, trusted: t.trusted || {}, ahead: t.ahead || {} }; };
const trusted = (dir, n, L) => { const t = trustOf(dir).trusted[n]; return t === undefined ? !L.runs.length : t === L.runHash; };
// Another session that was active in the last 30 minutes owns the run: a command from here changes nothing.
function notOwner(s, n, sid) {
  if (s.owner === sid) return null;
  const idle = Date.now() - (s.lastSeen || s.startedAt || 0);
  if (idle >= OWNER_IDLE_MS) return null;
  return `Build graph ${n} is being run by another session (active ${Math.round(idle / 60000)} min ago); continue it there. ` +
    `If that session has ended, take the run over: node "${FORGE_JS}" graph takeover ${n}\n`;
}
// The open graphs (started, not stopped or finished): { names: [...] }. More than one can be open (owner 2026-11-22);
// a version before that wrote { name }, which is still read.
function openNames(dir) {
  const a = readJson(activeFile(dir)) || {};
  return [...new Set([].concat(Array.isArray(a.names) ? a.names : [], a.name ? [a.name] : []))].filter(x => NAME.test(String(x || '')));
}
function setOpen(dir, n, on) {
  withLock(activeFile(dir), () => {
    const names = openNames(dir).filter(x => x !== n).concat(on ? [n] : []);
    if (names.length) writeJson(activeFile(dir), { names }); else { try { fs.unlinkSync(activeFile(dir)); } catch { /* none */ } }
  });
}
const openRuns = dir => (paths.isOwn(dir) ? openNames(dir).filter(m => openRun(readJson(stateFile(dir, m)))) : []);
// Two graphs never run helper steps or gates at the same moment, unless both carry a lock line and the names differ
// (the test suites of one project often share a database). -> the other open graph that has such a step under way
// and that this graph must wait for, or null. A graph that only waits at a human step holds nothing.
// Called with the hand-out lock held, so two sessions cannot both find the way free.
const runLockFile = dir => path.join(paths.forgeDir(dir), 'state', 'graph-handout');
function busyOther(dir, n, lock) {
  for (const m of openNames(dir)) {
    if (m === n) continue;
    const s = readJson(stateFile(dir, m));
    if (!openRun(s)) continue;
    const theirs = s.graph.lock || '';
    if (lock && theirs && lock !== theirs) continue;
    const x = s.graph.steps.find(k => (k.kind === 'agent' || k.kind === 'gate') && s.steps[k.id] && s.steps[k.id].state === 'running');
    if (x) return { name: m, step: x.id, why: lock && theirs ? `both carry the lock "${lock}"` : 'a graph with no "- lock:" line runs alone' };
  }
  return null;
}
const OLD_RECORD = n => `Build graph ${n} was started by an older JSPARK Forge; stop it (node "${FORGE_JS}" graph stop ${n}) and start it again.\n`;

function check(dir, n) {
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  if (!L.errs.length) return `Build graph ${n}: valid (${L.g.steps.length} steps).\n`;
  return `${L.errs.map(e => `.jspark-forge/graphs/${n}.md line ${e.line}: ${e.message}`).join('\n')}\n`;
}

function start(dir, n, sid) {
  if (!paths.isOwn(dir)) return 'Build graphs are off in a repo you are reviewing.\n';
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  try { require('./setup').shareGraphs(dir); } catch { /* fail open */ } // graphs are committed (owner 2026-11-20); only once the graph has loaded
  if (L.errs.length) return `Build graph ${n} cannot start:\n${check(dir, n)}`;
  const lost = dropChangedAhead(dir, n, L); // approvals given ahead for a graph that has changed since
  return `${startRun(dir, n, sid, L)}${lost.length ? `${AHEAD_LOST(lost, 'the graph\'s steps changed since it was given')}\n` : ''}`;
}
function startRun(dir, n, sid, L) {
  if (!trusted(dir, n, L)) {
    const before = trustOf(dir).trusted[n] !== undefined;
    withLock(trustFile(dir), () => { const t = trustOf(dir); t.asked[n] = L.runHash; writeJson(trustFile(dir), t); });
    const names = list => list.join(', ') || 'none';
    return `${L.runs.length ? `Build graph ${n} will run these commands by itself at its check steps (you do not type them):\n${L.runs.map(r => `- ${r}`).join('\n')}\n` : `Build graph ${n} runs no commands.\n`}` +
      `${before ? `Its gates or human steps changed since it was last trusted; now gates: ${names(L.guard.gates.map(x => x[0]))}; human steps: ${names(L.guard.human)}.\n` : ''}` +
      `${L.guard.noAhead ? `Never approved ahead: ${L.guard.noAhead.join(', ')}.\n` : ''}` +
      `${L.guard.lock ? `Lock: ${L.guard.lock} (its helper steps and gates may run beside graphs that carry another lock name).\n` : ''}` +
      `To allow it, send exactly this as your whole message: TRUST GRAPH ${n}\nAsked again whenever its commands, gates or human steps change.\n`;
  }
  // Another open graph does not stop this one from starting: its helper steps and gates wait their turn at graph next.
  if (openNames(dir).includes(n)) { const s = readJson(stateFile(dir, n)); if (s && !s.stopped && !s.finished) return `Build graph ${n} is already running; continue with: node "${FORGE_JS}" graph next ${n}\n`; }
  if (trustOf(dir).trusted[n] === undefined) { // the first start of a graph without commands: what later edits are compared with
    withLock(trustFile(dir), () => { const t = trustOf(dir); if (t.trusted[n] === undefined) { t.trusted[n] = L.runHash; writeJson(trustFile(dir), t); } });
  }
  const steps = {};
  for (const s of L.g.steps) steps[s.id] = { state: 'waiting', retries: 0 };
  const now = Date.now();
  // Approvals the person gave before the start go with the run (the graph is as it was when they were given).
  const ahead = takeAhead(dir, n, L);
  const rec = { name: n, hash: L.hash, owner: sid, lastSeen: now, startedAt: now, graph: snapshot(L.g), steps, evidence: [] };
  if (Object.keys(ahead).length) rec.ahead = ahead;
  withLock(stateFile(dir, n), () => writeJson(stateFile(dir, n), rec));
  setOpen(dir, n, true);
  const others = openRuns(dir).filter(m => m !== n);
  const est = L.g.steps.filter(s => s.estimate).map(s => `${s.id}: ${clean(s.estimate, 60)}`);
  const carried = Object.keys(ahead).map(k => `${k} (${stamp(ahead[k].at)})`);
  return `Started build graph ${n} (${L.g.steps.length} steps).${est.length ? ` Estimates (estimate): ${est.join('; ')}.` : ''}\nNext: node "${FORGE_JS}" graph next ${n}\n` +
    `${others.length ? `Also open: ${others.join(', ')}. ${L.g.lock ? `This graph's helper steps and gates wait for graphs with the lock "${L.g.lock}" or with none` : 'This graph has no "- lock:" line, so its helper steps and gates wait for every other graph\'s'}; a graph that waits for the person holds nothing up.\n` : ''}` +
    `${carried.length ? `Approved ahead by the person, completed by itself when the run gets there: ${carried.join(', ')}.\n` : ''}`;
}

// ---------- approvals given ahead (owner 2026-11-22) ----------
// The person may give their decision on a human step before the run reaches it: their own whole message
// APPROVE AHEAD <graph> <step> (onPrompt, below; no command and no helper can give it). It is kept with the time and
// the step's "say:" text as it was; the run completes the step by itself when it gets there and records that it was
// approved ahead. A step marked "- ahead: no" never takes one. Any change to the graph's steps cancels it: during a run
// the changed file stops the run (as before), before a run the hash of the steps is compared at the start.
// Kept in the run's record while a run is open; given before the start, beside the trust record until the start.
const stamp = at => { const d = new Date(at); const p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const AHEAD_NOTE = at => `approved ahead by the person at ${stamp(at)}`;
const AHEAD_LOST = (ids, why) => `The approval given ahead for ${ids.join(', ')} was cancelled: ${why}. Tell the user; the step${ids.length === 1 ? '' : 's'} will wait for them.`;
const openRun = s => !!s && !!s.graph && !s.stopped && !s.finished;
function dropChangedAhead(dir, n, L) {
  if (!Object.keys(trustOf(dir).ahead[n] || {}).length) return [];
  return withLock(trustFile(dir), () => {
    const t = trustOf(dir);
    const mine = t.ahead[n] || {};
    const gone = Object.keys(mine).filter(k => !L.stepsHash || mine[k].steps !== L.stepsHash);
    if (!gone.length) return [];
    for (const k of gone) delete mine[k];
    if (Object.keys(mine).length) t.ahead[n] = mine; else delete t.ahead[n];
    writeJson(trustFile(dir), t);
    return gone;
  });
}
function takeAhead(dir, n, L) {
  if (!Object.keys(trustOf(dir).ahead[n] || {}).length) return {};
  return withLock(trustFile(dir), () => {
    const t = trustOf(dir);
    const mine = t.ahead[n] || {};
    delete t.ahead[n];
    writeJson(trustFile(dir), t);
    const out = {};
    for (const [k, a] of Object.entries(mine)) {
      const x = L.g.steps.find(s => s.id === k);
      if (x && x.kind === 'human' && x.ahead !== 'no' && a.steps === L.stepsHash && a.say === x.say) out[k] = { at: a.at, say: a.say };
    }
    return out;
  });
}
// Why a step cannot be approved ahead (null when it can). x: the step; st: its state in an open run, if any.
function aheadRefusal(n, id, x, st) {
  if (!x) return `build graph ${n} has no step "${id}"`;
  if (x.kind !== 'human') return `${id} is not a human step (it is ${x.kind}), so there is no decision of yours to give`;
  if (st && st.state === 'done') return `${id} is already done`;
  if (st && st.state === 'running') return `${id} is waiting for you now. To complete it, send as your whole message: DONE ${id}`;
  if (x.ahead === 'no') return `${id} needs you at the time: the graph marks it "- ahead: no", so it can never be approved ahead`;
  return null;
}
function approveAhead(dir, n, id) {
  const no = why => `JSPARK Forge: nothing was approved: ${why}${/[.!?]$/.test(why) ? '' : '.'}`;
  const L = load(dir, n);
  if (L.error) return no(L.error);
  if (L.errs.length) return no(`build graph ${n} is not valid (node "${FORGE_JS}" graph check ${n})`);
  if (!trusted(dir, n, L)) return no(`build graph ${n} is not trusted yet. First run node "${FORGE_JS}" graph start ${n} to see its commands, and send TRUST GRAPH ${n}`);
  const ok = (at, text) => `JSPARK Forge: approved ahead: ${id} of build graph ${n}, recorded at ${stamp(at)}. What you approved without having read it at the time: "${clean(text, 300)}" ` +
    `When the run reaches ${id}, it is completed by itself and recorded as approved ahead. To withdraw: CANCEL APPROVAL ${n} ${id}. It is cancelled if the graph's steps change.`;
  if (openRun(readJson(stateFile(dir, n)))) {
    return update(dir, n, s => {
      if (!openRun(s)) return no(`build graph ${n} ended just now`);
      if (s.hash !== L.hash) return no('the graph file changed since the run started (the run stops at its next step)');
      const x = s.graph.steps.find(k => k.id === id);
      const why = aheadRefusal(n, id, x, x && s.steps[id]);
      if (why) return no(why);
      s.ahead = s.ahead || {};
      s.ahead[id] = { at: Date.now(), say: x.say };
      return ok(s.ahead[id].at, x.say);
    });
  }
  const x = L.g.steps.find(k => k.id === id);
  const why = aheadRefusal(n, id, x, null);
  if (why) return no(why);
  const at = Date.now();
  withLock(trustFile(dir), () => { const t = trustOf(dir); t.ahead[n] = Object.assign({}, t.ahead[n], { [id]: { at, say: x.say, steps: L.stepsHash } }); writeJson(trustFile(dir), t); });
  return ok(at, x.say);
}
function cancelAhead(dir, n, id) {
  let had = false;
  if (readJson(stateFile(dir, n))) {
    had = update(dir, n, s => {
      if (!s || !s.ahead || !s.ahead[id]) return false;
      delete s.ahead[id];
      if (!Object.keys(s.ahead).length) delete s.ahead;
      return true;
    });
  }
  if ((trustOf(dir).ahead[n] || {})[id]) {
    withLock(trustFile(dir), () => { const t = trustOf(dir); if (t.ahead[n]) { delete t.ahead[n][id]; if (!Object.keys(t.ahead[n]).length) delete t.ahead[n]; writeJson(trustFile(dir), t); } });
    had = true;
  }
  return had ? `JSPARK Forge: the approval given ahead for ${id} of build graph ${n} is withdrawn; the step will wait for you.`
    : `JSPARK Forge: there is no approval given ahead for ${id} of build graph ${n}; nothing changed.`;
}
// Approvals waiting for a run that has not started, for graph status.
const pendingAheadLines = (dir, n) => Object.entries(trustOf(dir).ahead[n] || {}).map(([k, a]) => `- ${k}: ${AHEAD_NOTE(a.at)} (it goes with the run when the graph starts)`);

// Plan usage only (not context): at 95 % no new helper step is handed out; unknown counts as under the limit.
function planPct(dir, sid) {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(paths.forgeDir(dir), 'usage', `${String(sid).replace(/[^A-Za-z0-9-]/g, '')}.json`), 'utf8'));
    if (!u || Date.now() - u.ts > 2 * 60 * 1000) return null;
    const p = [u.five_hour_pct, u.seven_day_pct].filter(v => typeof v === 'number');
    return p.length ? Math.max(...p) : null;
  } catch { return null; }
}

function settle(g, s) { // a parallel step is done when all its steps are
  for (const p of g.steps.filter(x => x.kind === 'parallel')) {
    if (s.steps[p.id].state !== 'done' && p.steps.every(c => s.steps[c] && s.steps[c].state === 'done')) s.steps[p.id].state = 'done';
  }
}
const seen = (s, sid) => { if (s.owner === sid) s.lastSeen = Date.now(); };

// ---------- v0.7: better gates (design-v0.7) ----------
// A gate's round: the full command(s); with a "retry:" line a failing full run is followed by the retry of what
// failed, and then by the full command once more. Only a passing full run completes a gate.
const PHASE_NOTE = { retry: 'the full command failed; this runs only what failed', confirm: 'the retry passed; the full command must pass once more' };
const LOG_KEEP = 5;
const LOG_READ_MAX = 20 * 1000 * 1000;
const logFile = (dir, n, id, k) => path.join(paths.forgeDir(dir), 'state', `gatelog-${n}-${id}-${k}.log`);
const nextRunNo = st => ((st.runs || []).length ? st.runs[st.runs.length - 1].n + 1 : 1);
// The end of a log (a long run's log can be large; the summary and the failing names are at the end).
function readLog(f) {
  try {
    const size = fs.statSync(f).size;
    const len = Math.min(size, LOG_READ_MAX);
    const fd = fs.openSync(f, 'r');
    try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len); return b.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
function pruneLogs(dir, n, id, newest) {
  for (let k = newest - LOG_KEEP; k > 0 && k > newest - LOG_KEEP - 20; k--) { try { fs.unlinkSync(logFile(dir, n, id, k)); } catch { /* none */ } }
}

// What must be true before a gate starts (its "before:" lines), for every gate that could be handed out now.
// -> { <step>: [what is missing, in plain words] }. Run before the record is locked: a port or a Docker check takes time.
function preflightFor(dir, n, probes) {
  const out = {};
  try {
    const s = readJson(stateFile(dir, n));
    if (!s || !s.graph || s.stopped || s.finished) return out;
    settle(s.graph, s); // on this copy only: a parallel step whose steps are all done counts as done, as next() will see it (review of v0.7)
    const deps = G.deps(s.graph);
    for (const x of s.graph.steps) {
      if (x.kind !== 'gate' || !(x.before || []).length) continue;
      const st = s.steps[x.id];
      if (!st || st.state !== 'waiting' || !(deps.get(x.id) || []).every(d => s.steps[d] && s.steps[d].state === 'done')) continue;
      out[x.id] = P.failures(P.check(x.before, probes));
    }
  } catch { /* the record could not be read: next() says so itself */ }
  return out;
}

// The state of the code, as far as git can see it: the commit, the uncommitted changes to tracked files, and every
// untracked file that git does not ignore, with its size and the time it was last written (a fix made in a new file
// that was never added must not look like "no change": review of v0.7). JSPARK Forge's own folder is left out: its
// record and logs change at every run and are not the project's code. Files git ignores are not seen.
// null when git cannot say, or when there are too many untracked files to look at. Two equal values: no change.
const UNTRACKED_MAX = 5000;
function codeState(dir) {
  try {
    const o = { cwd: dir, timeout: 5000, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
    const h = spawnSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], o);
    const d = spawnSync('git', ['--no-optional-locks', 'diff', 'HEAD'], o);
    const u = spawnSync('git', ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z'], o);
    if (h.status !== 0 || d.status !== 0 || u.status !== 0) return null;
    const own = `${path.relative(dir, paths.forgeDir(dir)).replace(/\\/g, '/')}/`;
    const names = u.stdout.split('\0').filter(f => f && !f.startsWith('.jspark-forge/') && !(own !== '/' && !own.startsWith('..') && f.startsWith(own)));
    if (names.length > UNTRACKED_MAX) return null;
    const files = names.sort().map(f => { try { const s = fs.statSync(path.join(dir, f)); return `${f}:${s.size}:${Math.round(s.mtimeMs)}`; } catch { return `${f}:gone`; } });
    return sha(`${h.stdout.trim()}\n${d.stdout}\n${files.join('\n')}`);
  } catch { return null; }
}
// What a test runner's output says, read outside the record's lock (a large log takes time).
function readResults(text) { try { return text ? R.summarize(text) : null; } catch { return null; } }

const namesText = (names, max = 5) => `${names.slice(0, max).join('; ')}${names.length > max ? ` (+${names.length - max} more)` : ''}`;
const runCounts = run => { try { return run && run.format ? R.oneLine({ passed: run.passed, failed: run.failed, skipped: run.skipped, notRun: run.notRun || 0, runnerFlaky: 0 }) : ''; } catch { return ''; } };
const flakyText = st => (!st ? '' : (st.flaky && st.flaky.length ? namesText(st.flaky, 10)
  : (st.flakyUnnamed ? 'the command failed and then passed unchanged (the test names could not be read)' : '')));

// One run of one gate command, added to the step's record (the last 10 are kept).
// extra: { ms, sum (readResults of the command's output, made before the lock was taken), code (codeState),
// log (the log file, as shown to the user) }. Nothing slow happens here: the record is locked.
function runRecord(st, cmd, exit, extra = {}) {
  const sum = extra.sum || null; // none: an output nobody could read; the exit code stands
  const run = { n: nextRunNo(st), cmd, kind: st.phase === 'retry' ? 'retry' : 'full', at: Date.now(), exit };
  if (Number.isFinite(extra.ms)) run.ms = Math.round(extra.ms);
  if (extra.code) run.code = extra.code;
  if (extra.log) run.log = extra.log;
  if (sum) Object.assign(run, { format: sum.format, passed: sum.passed, failed: sum.failed, skipped: sum.skipped, notRun: sum.notRun || 0,
    names: (sum.failedNames || []).slice(0, 50).map(x => clean(x, 160)) });
  st.runs = (st.runs || []).concat([run]).slice(-10);
  return run;
}

// A full run just passed. The tests that failed in the full runs before it, back to the last one that passed, are
// flaky when the code did not change in between; when it changed they may have been fixed, so nothing is said.
function noteFlaky(st, run) {
  if (run.kind !== 'full' || !run.code) return;
  const runs = st.runs || [];
  const names = [];
  let any = false, unnamed = false;
  for (let i = runs.length - 2; i >= 0; i--) {
    const r = runs[i];
    if (r.kind !== 'full' || r.cmd !== run.cmd) continue;
    if (typeof r.exit !== 'number') continue; // no exit code (the tool call timed out or was cut): not a test failure (review of v0.7)
    if (r.exit === 0 || !r.code || r.code !== run.code) break;
    any = true;
    if (r.names && r.names.length) names.push(...r.names); else unnamed = true;
  }
  if (!any) return;
  st.flaky = [...new Set((st.flaky || []).concat(names))].slice(0, 50);
  if (unnamed && !st.flaky.length) st.flakyUnnamed = true;
}

// One gate command ended with this exit code: record the run and move the gate on.
// -> { msg, cont }: cont true = the gate needs another command (msg may be null); otherwise the gate is done or failed.
function settleGate(n, id, x, st, cmd, exit, extra) {
  const run = runRecord(st, cmd, exit, extra);
  const counts = runCounts(run);
  const what = `"${clean(cmd, 120)}"`;
  const tail = `${counts ? ` ${counts}.` : ''}${run.names && run.names.length ? ` Failed: ${namesText(run.names)}.` : ''}${run.log ? ` Full output: ${run.log}` : ''}`;
  if (exit !== 0) {
    if (x.retry && st.phase === 'full' && !st.retried) {
      st.phase = 'retry'; st.retried = true; st.pending = [x.retry]; st.passed = [];
      return { cont: true, msg: `Step ${id} (gate): ${what} exited ${exit}.${tail}\nNot failed yet: only what failed runs again now (${clean(x.retry, 120)}); then the full command must pass once more.` };
    }
    const where = st.phase === 'retry' ? ' (the retry of what failed)' : (st.phase === 'confirm' ? ' (the full run after the retry)' : '');
    st.state = 'failed'; st.reason = `${what} exited ${exit}${where}`;
    return { msg: `Step ${id} (gate) failed: ${st.reason}.${tail} Show the user the command and its output; the run is stopped.` };
  }
  if (st.phase === 'retry') {
    st.phase = 'confirm'; st.pending = x.run.slice(); st.passed = [];
    return { cont: true, msg: `Step ${id} (gate): the retry passed.${counts ? ` ${counts}.` : ''} A retry alone never completes a gate: the full command runs once more now.` };
  }
  st.passed = [...new Set((st.passed || []).concat([cmd]))];
  noteFlaky(st, run);
  if (!st.pending.every(c => st.passed.includes(c))) return { cont: true, msg: null };
  st.state = 'done'; st.doneAt = Date.now(); delete st.runner; delete st.phase;
  st.minutes = Math.round((st.doneAt - (st.handedAt || st.doneAt)) / 6000) / 10;
  const fl = flakyText(st);
  return { msg: `Step ${id} (gate) passed.${counts ? ` ${counts}.` : ''}${fl ? ` Flaky (failed, then passed with no change to the code; a flaky test is not a fixed test), tell the user: ${fl}.` : ''} Now run: node "${FORGE_JS}" graph next ${n}` };
}

// Time and tokens so far, printed by every graph next: an expensive step shows while there is still a choice.
const kTok = t => (t >= 1000 ? `${Math.round(t / 1000)}k` : String(t));
function costLine(g, s) {
  const ids = g.steps.filter(x => x.kind !== 'parallel').map(x => x.id);
  const done = ids.filter(i => s.steps[i] && s.steps[i].state === 'done' && s.steps[i].doneAt);
  if (!done.length) return '';
  const fig = (m, t) => `${Math.round(m * 10) / 10} min${t ? `, ${kTok(t)} tokens` : ''}`;
  const min = done.reduce((a, i) => a + (s.steps[i].minutes || 0), 0);
  const tok = done.reduce((a, i) => a + (s.steps[i].tokens || 0), 0);
  const last = done.slice().sort((a, b) => s.steps[b].doneAt - s.steps[a].doneAt)[0];
  return `So far: ${done.length} of ${ids.length} steps done, ${fig(min, tok)} (last: ${last}, ${fig(s.steps[last].minutes || 0, s.steps[last].tokens || 0)}). Tokens are counted for helper steps only.`;
}

// opts.takeover: `graph takeover <name>`, the user's choice to move a live run to this session.
function next(dir, n, sid, opts = {}) {
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  const pre = preflightFor(dir, n, opts.probes); // before the record is locked: these checks can take seconds
  // One hand-out at a time for the whole project: what another graph is running is read and this graph's steps are
  // marked as running under the same lock.
  return withLock(runLockFile(dir), () => update(dir, n, s => {
    if (!s) return `Build graph ${n} has not started: node "${FORGE_JS}" graph start ${n}\n`;
    if (s.stopped) return `Build graph ${n} is stopped (${s.stopped}).\n`;
    if (s.finished) return `Build graph ${n} is finished.\n`;
    if (!s.graph) return OLD_RECORD(n);
    if (s.hash !== L.hash) {
      s.stopped = 'the graph file changed during the run'; setOpen(dir, n, false);
      const lost = Object.keys(s.ahead || {}); delete s.ahead;
      return `The graph file changed since the run started, so the run is stopped. Start it again: node "${FORGE_JS}" graph start ${n}\n${lost.length ? `${AHEAD_LOST(lost, 'the graph changed')}\n` : ''}`;
    }
    const g = s.graph;
    const out = [];
    if (s.owner !== sid) {
      const idle = Date.now() - (s.lastSeen || s.startedAt || 0);
      if (!opts.takeover && idle < OWNER_IDLE_MS) {
        return `Build graph ${n} is being run by another session (active ${Math.round(idle / 60000)} min ago); continue it there. ` +
          `If that session has ended, take the run over: node "${FORGE_JS}" graph takeover ${n}\n`;
      }
      // Helpers die with their session; a gate's commands and a human step's answer do not need it (review M3).
      const was = g.steps.filter(x => x.kind === 'agent' && s.steps[x.id].state === 'running').map(x => x.id);
      for (const k of was) s.steps[k].state = 'interrupted';
      s.owner = sid;
      if (was.length) out.push(`Interrupted in an earlier session: ${was.join(', ')}. Ask the user: run again (node "${FORGE_JS}" graph rerun ${n} <step>) or stop (node "${FORGE_JS}" graph stop ${n}).`);
    }
    s.lastSeen = Date.now();
    settle(g, s);
    const failed = Object.entries(s.steps).find(([, v]) => v.state === 'failed');
    if (failed) { out.push(`Stopped: ${failed[0]} failed (${clean(failed[1].reason || 'no reason given', 200)}). Show this to the user.`); return `${out.join('\n')}\n`; }
    // A human step the person approved ahead: the run has reached it, so it is completed here, by their decision, and
    // the record and the output say that it was given ahead. Repeated, since one may free the next.
    const deps = G.deps(g);
    for (let again = true; again;) {
      again = false;
      for (const x of g.steps) {
        const a = s.ahead && s.ahead[x.id];
        const hx = s.steps[x.id];
        if (!a || x.kind !== 'human' || hx.state !== 'waiting' || !(deps.get(x.id) || []).every(d => s.steps[d].state === 'done')) continue;
        delete s.ahead[x.id];
        if (x.ahead === 'no' || a.say !== x.say) { out.push(AHEAD_LOST([x.id], 'the step is not what was approved')); continue; }
        hx.state = 'done'; hx.handedAt = hx.doneAt = Date.now(); hx.ahead = { at: a.at, say: a.say }; hx.note = AHEAD_NOTE(a.at);
        out.push(`Step ${x.id} (human) is done: ${hx.note}, before the run got here, so nobody read it at this point. Its instruction: "${clean(x.say, 300)}" Tell the user that it was approved ahead, with the instruction; then go on.`);
        again = true;
      }
      settle(g, s);
    }
    if (s.ahead && !Object.keys(s.ahead).length) delete s.ahead;
    if (g.steps.every(x => s.steps[x.id].state === 'done')) {
      s.finished = Date.now(); setOpen(dir, n, false);
      const fl = g.steps.filter(x => flakyText(s.steps[x.id])).map(x => `${x.id}: ${flakyText(s.steps[x.id])}`);
      if (fl.length) out.push(`Flaky in this run (failed, then passed with no change to the code; a flaky test is not a fixed test). Tell the user: ${fl.join(' | ')}`);
      const c = costLine(g, s);
      return `${out.concat([`Build graph ${n} finished.`], c ? [c] : []).join('\n')}\n`;
    }
    const byId = new Map(g.steps.map(x => [x.id, x]));
    const ready = G.order(g).map(id => byId.get(id))
      .filter(x => x.kind !== 'parallel' && s.steps[x.id].state === 'waiting' && (deps.get(x.id) || []).every(d => s.steps[d].state === 'done'));
    const pct = planPct(dir, sid);
    let running = g.steps.filter(x => x.kind === 'agent' && s.steps[x.id].state === 'running').length;
    let capSaid = false, unknownSaid = false;
    const outputs = {};
    for (const v of Object.values(s.steps)) Object.assign(outputs, v.outputs || {});
    const held = ready.some(x => x.kind !== 'human') ? busyOther(dir, n, g.lock || '') : null;
    for (const x of ready) {
      const st = s.steps[x.id];
      if (held && x.kind !== 'human') { // another graph's helper step or gate is under way: this one waits its turn
        out.push(`Step ${x.id} (${x.kind}) is not started: build graph ${held.name} is running ${held.step}, and the two never run at the same moment (${held.why}). Nothing failed; run graph next again when that step is done.`);
        continue;
      }
      if (x.kind === 'agent') {
        if (pct !== null && pct >= 95) { // the cap holds back helpers only: human steps and gates go ahead
          if (!capSaid) out.push(`Plan usage is at ${pct} %: no new helper steps until it drops.`);
          capSaid = true;
          continue;
        }
        if (running >= g.maxParallel) continue;
        if (pct === null && !unknownSaid) { out.push('Plan usage unknown: treated as under the limit.'); unknownSaid = true; }
        running++;
        st.state = 'running'; st.handedAt = Date.now();
        const inputs = x.needs.map(f => `${f}=${clean(outputs[f], 200)}`).join('; ');
        out.push(`Step ${x.id} (agent): use the Agent tool with subagent_type "jspark-forge:${x.helper}" and description "[graph ${n}/${x.id}] ${x.id}".` +
          `${x.brief ? ` Brief: ${clean(x.brief, 200)}.` : ''}${inputs ? ` Inputs: ${inputs}.` : ''} Return exactly: ${x.gives.length ? x.gives.join(', ') : 'nothing'}.` +
          ` Then write those fields as JSON with the Write tool to .jspark-forge/state/report-${x.id}.json and run, as a command of its own: node "${FORGE_JS}" graph done ${n} ${x.id} --from .jspark-forge/state/report-${x.id}.json` +
          ` (if the step fails: node "${FORGE_JS}" graph fail ${n} ${x.id} "<reason>").`);
      } else if (x.kind === 'gate') {
        // v0.7: what the gate needs before it starts. Not met: it is not handed out, and nothing fails.
        // A gate with "before:" lines is never handed out unchecked: if it became ready only now (another command
        // finished a step in between), it is checked at the next graph next (review of v0.7).
        if ((x.before || []).length && !(x.id in pre)) {
          out.push(`Step ${x.id} (gate) is ready; what it needs before it starts is checked first. Run graph next again.`);
          continue;
        }
        const miss = pre[x.id] || [];
        if (miss.length) {
          out.push(`Step ${x.id} (gate) is not started. Before it can run: ${miss.join('; ')}. Tell the user; when that is fixed, run graph next again.`);
          continue;
        }
        // Printed exactly as stored and matched exactly (review M2); graph check refuses lines that would print otherwise.
        // v0.7: each hand-out is a new round (full, then at most one retry of what failed, then full again); the runs
        // already recorded and the flaky names are kept.
        st.state = 'running'; st.handedAt = Date.now(); st.pending = x.run.slice(); st.passed = []; delete st.runner;
        st.phase = 'full'; st.retried = false;
        out.push(`Step ${x.id} (gate): Run each command with the Bash tool exactly as written, one per call, from the project folder, not in the background:\n` +
          `${x.run.map(r => `  ${r}`).join('\n')}\nJSPARK Forge records each exit code; a failing one stops the run.\n` +
          `If a command can take longer than 9 minutes (one tool call waits 10 at most, and a command moved to the background is not recorded), run this instead, with the Bash tool, in the background: node "${FORGE_JS}" graph gate ${n} ${x.id}\n` +
          `It runs the same commands and records their exit codes itself, keeps each run's output in a log file and reports the counts and the failing tests. When it ends, run graph next again.` +
          `${x.retry ? `\nIf the command fails, the gate is not failed yet: only what failed runs again (${x.retry}), and then the full command must pass once more. graph gate does all three by itself.` : ''}`);
      } else if (x.kind === 'human') {
        st.state = 'running'; st.handedAt = Date.now();
        out.push(`Step ${x.id} (human): Show the user: ${clean(x.say, 300)} Then stop and wait; only the user's own message DONE ${x.id} completes it.`);
      }
    }
    if (!out.length || out.every(l => /^Plan usage/.test(l))) {
      const now = Object.entries(s.steps).filter(([, v]) => v.state === 'running' || v.state === 'interrupted').map(([k, v]) => `${k} ${stateWord((byId.get(k) || {}).kind, v)}`);
      out.push(now.length ? `Nothing new to start: waiting for ${now.join(', ')}.` : 'Nothing can start now.');
      // A gate left running with nobody running it (its command was moved to the background, or the session was cut off).
      for (const x of g.steps) {
        const v = s.steps[x.id];
        if (x.kind !== 'gate' || v.state !== 'running' || runnerLive(v.runner)) continue;
        const left = (v.pending || []).filter(c => !(v.passed || []).includes(c));
        if (left.length) out.push(`Step ${x.id} (gate) still needs: ${left.map(c => clean(c, 120)).join('; ')}${PHASE_NOTE[v.phase] ? ` (${PHASE_NOTE[v.phase]})` : ''}. Run them with the Bash tool, or all of them (any length of time) in the background with: node "${FORGE_JS}" graph gate ${n} ${x.id}`);
      }
    }
    const c = costLine(g, s); // v0.7: time and tokens so far, at every step, not only at the end
    if (c) out.push(c);
    return `${out.join('\n')}\n`;
  }));
}
const takeover = (dir, n, sid) => next(dir, n, sid, { takeover: true });

// Evidence (review M4): a SubagentStart of exactly jspark-forge:<helper> (plugin helpers report their plugin's name,
// spike J), in the run's own session, since the step was handed out, not used for another step.
function evidenceFor(s, helper, since) {
  return (s.evidence || []).find(e => !e.used && e.at >= since && e.type === `jspark-forge:${helper}` && e.session === s.owner);
}
const git = (dir, args) => spawnSync('git', ['--no-optional-locks', ...args], { cwd: dir, timeout: 3000, windowsHide: true, stdio: 'ignore' }).status === 0;
const sameReport = (rep, st) => JSON.stringify(Object.keys(rep).sort().map(k => [k, String(rep[k])])) ===
  JSON.stringify(Object.keys(st.outputs || {}).sort().map(k => [k, String(st.outputs[k])]));

function done(dir, n, id, file, sid) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  const s0 = readJson(stateFile(dir, n));
  if (!s0) return `Build graph ${n} has not started.\n`;
  if (!s0.graph) return OLD_RECORD(n);
  const x = STEP.test(String(id || '')) && s0.graph.steps.find(s => s.id === id);
  if (!x) return `Build graph ${n} has no step "${clean(id, 40)}".\n`;
  if (x.kind === 'human') return `${id} is a human step: only the user's own message DONE ${id} completes it.\n`;
  if (x.kind === 'gate') return `${id} is a gate: it completes from its commands' exit codes, not from a report.\n`;
  if (x.kind !== 'agent') return `${id} is not a step that reports.\n`;
  let rep;
  try { rep = JSON.parse(fs.readFileSync(path.resolve(String(file || '')), 'utf8')); } catch { return 'Could not read the report file as JSON; nothing recorded.\n'; }
  if (!rep || typeof rep !== 'object' || Array.isArray(rep)) return 'The report must be a JSON object of the declared fields.\n';
  const judge = st => {
    if (st.state === 'done') return sameReport(rep, st) ? `${id} is already done; the same report is ignored.\n` : `Refused: ${id} was already reported with other values. Tell the user.\n`;
    if (st.state !== 'running') return `${id} is not running (not handed out yet); run node "${FORGE_JS}" graph next ${n} first.\n`;
    return null;
  };
  const early = judge(s0.steps[id]);
  if (early) return early;
  const extra = Object.keys(rep).filter(k => !x.gives.includes(k));
  if (extra.length) return `Refused: not declared: ${extra.join(', ')}. ${id} gives only: ${x.gives.join(', ') || 'nothing'}.\n`;
  const missing = x.gives.filter(k => !(k in rep));
  if (missing.length) return `Refused: missing: ${missing.join(', ')}.\n`;
  for (const k of x.gives) { // checked before the lock is taken: git can take a while
    const v = rep[k];
    if (!['string', 'number', 'boolean'].includes(typeof v) || String(v).length > MAX_VALUE) return `Refused: ${k} must be a short value (at most ${MAX_VALUE} characters).\n`;
    if (/(^|_)path$/.test(k)) {
      const abs = path.resolve(dir, String(v));
      const rel = path.relative(dir, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) return `Refused: ${k} "${clean(v, 120)}" does not exist in the project.\n`;
    }
    if (/(^|_)commit$/.test(k) && (!/^[0-9a-f]{7,40}$/i.test(String(v)) || !git(dir, ['cat-file', '-e', `${v}^{commit}`]))) return `Refused: ${k} "${clean(v, 60)}" does not resolve to a commit.\n`;
  }
  return update(dir, n, s => {
    if (!s || s.startedAt !== s0.startedAt) return `Build graph ${n} was restarted while this report was checked; nothing recorded.\n`;
    seen(s, sid);
    const st = s.steps[id];
    const again = judge(st);
    if (again) return again;
    const ev = evidenceFor(s, x.helper, st.handedAt || 0);
    if (!ev) return `Refused: no ${x.helper} helper ran since ${id} was handed out. Dispatch jspark-forge:${x.helper} for it first.\n`;
    ev.used = id;
    st.state = 'done'; st.doneAt = Date.now(); st.outputs = rep;
    st.minutes = Math.round((st.doneAt - (st.handedAt || st.doneAt)) / 6000) / 10;
    return `${id} done. Continue: node "${FORGE_JS}" graph next ${n}\n`;
  });
}

function fail(dir, n, id, reason, sid) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  if (!STEP.test(String(id || ''))) return `No running step "${clean(id, 40)}" in ${n}.\n`;
  return update(dir, n, s => {
    if (!s || !s.steps[id]) return `No running step "${clean(id, 40)}" in ${n}.\n`;
    const other = notOwner(s, n, sid); // re-review low: like done, only the run's own session
    if (other) return other;
    seen(s, sid);
    const st = s.steps[id];
    if (st.state !== 'running') return `${id} is not running.\n`;
    if (!st.retries) { st.retries = 1; st.state = 'waiting'; st.reason = clean(reason, 200); return `${id} failed (${st.reason}); it will retry once at the next node "${FORGE_JS}" graph next ${n}.\n`; }
    st.state = 'failed'; st.reason = clean(reason, 200);
    return `${id} failed again (${st.reason}); the run is stopped. Show this to the user.\n`;
  });
}
function rerun(dir, n, id, sid) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  if (!STEP.test(String(id || ''))) return `No step "${clean(id, 40)}" in ${n}.\n`;
  return update(dir, n, s => {
    if (!s || !s.steps[id]) return `No step "${clean(id, 40)}" in ${n}.\n`;
    // re-review M8: a stopped run has no active record, so its steps could never be reported again
    if (s.stopped) return `Build graph ${n} is stopped (${s.stopped}), so no step can run again in it. Start it again: node "${FORGE_JS}" graph start ${n}\n`;
    const other = notOwner(s, n, sid);
    if (other) return other;
    seen(s, sid);
    const st = s.steps[id];
    if (!['interrupted', 'failed'].includes(st.state)) return `${id} is ${st.state}; only an interrupted or failed step can run again.\n`;
    st.state = 'waiting'; delete st.reason;
    return `${id} will run again (the retry is not used up). Continue: node "${FORGE_JS}" graph next ${n}\n`;
  });
}
function stop(dir, n, sid) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  const r = update(dir, n, s => {
    if (!s) return null;
    if (!s.stopped && !s.finished) { const other = notOwner(s, n, sid); if (other) return other; }
    seen(s, sid); s.stopped = 'stopped by request';
    const lost = Object.keys(s.ahead || {}); delete s.ahead; // an approval given ahead belongs to this run
    return { lost };
  });
  if (typeof r === 'string') return r;
  setOpen(dir, n, false);
  return r ? `Build graph ${n} stopped (its record is kept).\n${r.lost.length ? `${AHEAD_LOST(r.lost, 'the run was stopped')}\n` : ''}` : `Build graph ${n} has not started.\n`;
}

// v0.6.2: what a step's state is called when shown. A gate is "running" in the record from the moment it is handed
// out, but nothing may be running: it is shown as running only while graph gate runs its commands, and as
// "not yet passed" otherwise. A human step that was handed out is waiting for the user.
function stateWord(kind, v) {
  if (!v || v.state !== 'running') return v ? v.state : 'unknown';
  if (kind === 'human') return 'waiting for the user';
  if (kind !== 'gate' || runnerLive(v.runner)) return 'running';
  if (v.phase === 'retry') return 'not yet passed (the full command failed; the retry of what failed is next, none running)';
  if (v.phase === 'confirm') return 'not yet passed (the retry passed; the full command must pass once more, none running)';
  const all = Array.isArray(v.pending) ? v.pending : [];
  const ok = all.filter(c => (v.passed || []).includes(c)).length;
  return `not yet passed (${ok} of ${all.length} commands passed, none running)`;
}

function summary(dir, n) {
  const s = readJson(stateFile(dir, n));
  if (!s || !s.graph) return null;
  const kind = new Map(s.graph.steps.map(x => [x.id, x.kind]));
  const ids = s.graph.steps.filter(x => x.kind !== 'parallel').map(x => x.id);
  const doneN = ids.filter(i => s.steps[i] && s.steps[i].state === 'done').length;
  const now = ids.filter(i => s.steps[i] && ['running', 'interrupted', 'failed'].includes(s.steps[i].state)).map(i => `${i} ${stateWord(kind.get(i), s.steps[i])}`);
  return { name: n, task: `Build graph ${n}`, step: `${doneN} of ${ids.length} done${now.length ? `; ${now.join(', ')}` : ''}`, text: `Build graph ${n}: ${doneN} of ${ids.length} steps done${now.length ? `; ${now.join(', ')}` : ''}${s.stopped ? ` (stopped: ${s.stopped})` : ''}.` };
}
function status(dir, n) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  const sum = summary(dir, n);
  const pend = pendingAheadLines(dir, n);
  if (!sum) return `Build graph ${n} has not started.\n${pend.length ? `${pend.join('\n')}\n` : ''}`;
  const s = readJson(stateFile(dir, n));
  // Approved ahead: a step still to come says so, and a step completed that way keeps saying so.
  const aheadOf = (k, v) => (v.note ? ` (${v.note})` : (s.ahead && s.ahead[k] && v.state === 'waiting' ? ` (${AHEAD_NOTE(s.ahead[k].at)}; it completes by itself when the run gets there)` : ''));
  const kinds = new Map(s.graph.steps.map(x => [x.id, x.kind]));
  // v0.7: a gate that graph gate is running shows how far it has got (read from the run's log); every gate lists its
  // runs, so two runs can be compared without opening a log; flaky tests are always named.
  const live = (k, v) => {
    if (!(v.state === 'running' && runnerLive(v.runner))) return '';
    let far = '';
    try { const p = R.progress(readLog(logFile(dir, n, k, nextRunNo(v)))); if (p) far = `; ${R.progressLine(p)}`; } catch { /* no log yet */ }
    return ` (its commands are being run by graph gate since ${clockOf(v.runner.at)}${far})`;
  };
  const runLine = r => `    run ${r.n}, ${r.kind === 'retry' ? 'only what failed' : 'full'}, ${clockOf(r.at)}${Number.isFinite(r.ms) ? `, ${Math.round(r.ms / 6000) / 10} min` : ''}: exit ${r.exit}` +
    `${runCounts(r) ? `; ${runCounts(r)}` : ''}${r.names && r.names.length ? `; failed: ${namesText(r.names)}` : ''}`;
  const lines = [];
  for (const [k, v] of Object.entries(s.steps)) {
    lines.push(`- ${k}: ${stateWord(kinds.get(k), v)}${aheadOf(k, v)}${v.reason ? ` (${v.reason})` : ''}${live(k, v)}${v.tokens ? `, ${v.tokens} tokens` : ''}${v.minutes ? `, ${v.minutes} min` : ''}`);
    for (const r of (v.runs || []).slice(-5)) lines.push(runLine(r));
    if (flakyText(v)) lines.push(`    flaky (failed, then passed with no change to the code; not fixed): ${flakyText(v)}`);
    const lastLog = (v.runs || []).map(r => r.log).filter(Boolean).pop();
    if (lastLog) lines.push(`    output of the last run: ${lastLog}`);
  }
  const c = costLine(s.graph, s);
  return `${sum.text}\n${lines.concat(pend).join('\n')}\n${c ? `${c}\n` : ''}`;
}
// Every open graph, for session start and the handoff; current() is the first of them (null when none).
const currentAll = dir => openRuns(dir).map(m => summary(dir, m)).filter(Boolean);
const current = dir => currentAll(dir)[0] || null;
// `graph status` with no name: every open graph and what each is waiting for.
function statusAll(dir) {
  const all = currentAll(dir);
  if (!all.length) return 'No build graph is open.\n';
  const lines = all.map(g => { const s = readJson(stateFile(dir, g.name)); return `- ${g.text.replace(/^Build graph /, '').replace(/\.$/, '')}${s.graph.lock ? ` (lock: ${s.graph.lock})` : ''}`; });
  return `${all.length === 1 ? '1 build graph is open' : `${all.length} build graphs are open`}:\n${lines.join('\n')}\nOne graph in detail: node "${FORGE_JS}" graph status <name>\n`;
}

// ---------- hooks ----------
// The owner's activity, noted at most once a minute (review M3: a live owner is not replaced silently).
function touch(dir, n, sid) {
  const s = readJson(stateFile(dir, n));
  if (!s || s.owner !== sid || Date.now() - (s.lastSeen || 0) < SEEN_EVERY_MS) return;
  update(dir, n, x => seen(x, sid));
}
// One helper start is evidence for one step: it goes to the open graph, run by this session, that has a helper step
// of this kind handed out and not yet covered by a start; with none such, to the first open graph, as before.
function onSubagentStart(dir, input) {
  const names = openRuns(dir);
  if (!names.length || !input.agent_type) return;
  const type = String(input.agent_type);
  const need = m => {
    const s = readJson(stateFile(dir, m));
    if (!openRun(s) || s.owner !== input.session_id) return 0;
    const steps = s.graph.steps.filter(k => k.kind === 'agent' && `jspark-forge:${k.helper}` === type && s.steps[k.id].state === 'running');
    if (!steps.length) return 0;
    const since = Math.min(...steps.map(k => s.steps[k.id].handedAt || 0));
    return steps.length - (s.evidence || []).filter(e => !e.used && e.type === type && e.session === s.owner && e.at >= since).length;
  };
  const n = names.find(m => need(m) > 0) || names[0];
  update(dir, n, s => {
    if (!s) return;
    seen(s, input.session_id);
    s.evidence = (s.evidence || []).concat([{ type, id: input.agent_id, session: input.session_id, at: Date.now() }]).slice(-50);
  });
}
function onAgentResult(dir, input) {
  const m = String((input.tool_input || {}).description || '').match(/\[graph ([a-z][a-z0-9-]{0,39})\/([a-z][a-z0-9-]{0,39})\]/);
  if (!m || !openRuns(dir).includes(m[1])) return;
  const n = m[1];
  const r = input.tool_response || {};
  update(dir, n, s => {
    const st = s && s.steps[m[2]];
    if (!st) return;
    seen(s, input.session_id);
    if (typeof r.totalTokens === 'number') st.tokens = r.totalTokens;
    if (typeof r.totalDurationMs === 'number') st.helperMs = r.totalDurationMs;
  });
}
const sameDir = (a, b) => !!a && !!b && paths.normPath(a) === paths.normPath(b);
// A gate's command ran through Claude's tool: record its exit status, only when it is the run's own session (not a
// helper), in the project folder, in the foreground and not interrupted (review H4).
function onCommand(dir, input, ok) {
  if (input.agent_id) return;
  const ti = input.tool_input || {};
  const r = input.tool_response || {};
  const cmd = String(ti.command || '').trim();
  const mine = cmd ? openRuns(dir).filter(m => (readJson(stateFile(dir, m)) || {}).owner === input.session_id) : [];
  if (!mine.length) return;
  const counts = !ti.run_in_background && !r.backgroundTaskId && !r.interrupted && sameDir(input.cwd, dir);
  const isGate = st => st.state === 'running' && Array.isArray(st.pending) && st.pending.includes(cmd);
  // The command belongs to the one open graph whose gate is waiting for it.
  const n = counts ? mine.find(m => Object.values((readJson(stateFile(dir, m)) || {}).steps || {}).some(isGate)) : undefined;
  if (!n) { for (const m of mine) touch(dir, m, input.session_id); return; }
  // v0.7: the run is recorded like one made by graph gate, from the output the tool reports (it may be cut short; the
  // exit code is the truth). Read before the record is locked: git can take a moment.
  const text = ok ? [r.stdout, r.stderr].filter(x => typeof x === 'string').join('\n') : String(input.error || '');
  const sum = readResults(text);
  const code = codeState(dir);
  update(dir, n, s => {
    if (!s || s.owner !== input.session_id || !s.graph) return;
    seen(s, input.session_id);
    for (const [id, st] of Object.entries(s.steps)) {
      if (!isGate(st)) continue;
      const x = s.graph.steps.find(k => k.id === id) || { run: st.pending.slice(), retry: '' };
      const exit = ok ? 0 : (Number((String(input.error || '').match(/exit code (\d+)/i) || [])[1]) || '?');
      settleGate(n, id, x, st, cmd, exit, { sum, code });
      return;
    }
  });
}
// ---------- a gate that outlasts one tool call (v0.5.2) ----------
// The Bash tool waits 10 minutes at most; a command moved to the background reaches no hook with its exit code, so
// such a gate stayed "running" whatever the tests said. `graph gate <name> <step>` runs the gate's own commands (the
// ones stored at start and trusted by the user), one after another, in the project folder, with no time limit, and
// records each real exit code itself. Only the run's own session; only commands still pending; nothing the block
// list would hold (those go through the Bash tool, where the user is asked). A runner that is killed records nothing:
// the gate stays running and the same command runs it again.
const RUNNER_MAX_MS = 24 * 3600 * 1000; // a runner mark older than this is a leftover (its pid may belong to something else now)
const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; } };
const runnerLive = r => !!r && typeof r === 'object' && Number.isFinite(r.at) && Date.now() - r.at < RUNNER_MAX_MS && pidAlive(r.pid);
const clockOf = at => new Date(at).toTimeString().slice(0, 5);
// The shell that runs a gate's commands: a fixed absolute path, never $SHELL, MSYSTEM or the first bash on PATH (review
// of v0.5.2 H1, H2: `SHELL=/bin/true` or a fake bash made every command "pass"; cmd.exe reads quotes differently).
// POSIX: /bin/bash, else /bin/sh. Windows: Git Bash, as Claude's Bash tool uses; none found -> null (the runner refuses).
function gateShell(env = process.env) {
  const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (process.platform !== 'win32') return ['/bin/bash', '/bin/sh'].find(isFile) || null;
  const tries = [];
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, 'C:\\Program Files', env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
    if (base) tries.push(path.join(base, 'Git', 'bin', 'bash.exe'));
  }
  const set = String(env.CLAUDE_CODE_GIT_BASH_PATH || '');
  if (path.isAbsolute(set) && /[\\/]bash\.exe$/i.test(set)) tries.push(set);
  return tries.find(isFile) || null;
}
// v0.7: the command's output goes to a log file, not the screen: the runner reads it for the counts and the failing
// tests, graph status reads it for progress, and Claude gets a summary instead of the whole output.
function runShell(dir, cmd, log) {
  let fd = null;
  try { fs.mkdirSync(path.dirname(log), { recursive: true }); fd = fs.openSync(log, 'w'); } catch { /* no log: the output is shown instead */ }
  try { return spawnSync(gateShell(), ['-c', cmd], { cwd: dir, stdio: fd === null ? 'inherit' : ['ignore', fd, fd], windowsHide: true }); }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}
const TAIL_LINES = 25;
const tailOf = text => { const l = String(text || '').replace(/\r/g, '').split('\n'); while (l.length && !l[l.length - 1].trim()) l.pop(); return l.slice(-TAIL_LINES).join('\n'); };
// The record can be busy for a moment (another hook holds it): after a long command, wait up to a minute for it.
function updatePatiently(dir, n, fn, waitMs = 60000) {
  const until = Date.now() + waitMs;
  for (;;) {
    try { return update(dir, n, fn); } catch (e) {
      if (!e || !e.busy || Date.now() >= until) throw e;
      sleep(250);
    }
  }
}
// opts: write (progress lines), blocked (cmd -> reason or null), run (cmd -> { status, signal, error }; for tests).
function gate(dir, n, id, sid, opts = {}) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  const write = opts.write || (t => process.stdout.write(t));
  const mine = { pid: process.pid, at: Date.now() };
  if (!opts.run && !gateShell()) return 'Git Bash was not found on this machine, so the gate runner cannot run the commands the way Claude\'s Bash tool does. Nothing was run. Run the gate\'s commands with the Bash tool instead.\n';
  let runStarted = 0, handed = 0; // this run and this hand-out of the step: a result is recorded only into the same ones
  // v0.7: what the gate needs before it starts is checked again here (time has passed since it was handed out), before
  // the record is locked. Not met: nothing is run and nothing fails.
  try {
    const s0 = readJson(stateFile(dir, n));
    const x0 = s0 && s0.graph && STEP.test(String(id || '')) && s0.graph.steps.find(k => k.id === id);
    const fresh = x0 && s0.steps[id] && !(s0.steps[id].runs || []).some(r => r.at >= (s0.steps[id].handedAt || 0));
    if (x0 && x0.kind === 'gate' && fresh && (x0.before || []).length) {
      const miss = P.failures(P.check(x0.before, opts.probes));
      if (miss.length) return `Step ${id} (gate) was not run. Before it can run: ${miss.join('; ')}. Tell the user; when that is fixed, run the same graph gate command again.\n`;
    }
  } catch { /* the record could not be read: said below */ }
  const refused = update(dir, n, s => {
    if (!s) return `Build graph ${n} has not started.\n`;
    if (!s.graph) return OLD_RECORD(n);
    if (s.stopped) return `Build graph ${n} is stopped (${s.stopped}).\n`;
    if (s.finished) return `Build graph ${n} is finished.\n`;
    const x = STEP.test(String(id || '')) && s.graph.steps.find(k => k.id === id);
    if (!x) return `Build graph ${n} has no step "${clean(id, 40)}".\n`;
    if (x.kind !== 'gate') return `${id} is not a gate.\n`;
    if (s.owner !== sid) return `Build graph ${n} is being run by another session; its gate runs there.\n`;
    const st = s.steps[id];
    if (st.state !== 'running' || !Array.isArray(st.pending)) return `${id} is not running (${st.state}); run node "${FORGE_JS}" graph next ${n} first.\n`;
    if (runnerLive(st.runner)) return `${id} is already being run (started ${clockOf(st.runner.at)}); wait for it to end.\n`;
    st.runner = mine; seen(s, sid);
    runStarted = s.startedAt || 0; handed = st.handedAt || 0;
    return null;
  });
  const same = (x, t) => !!t && x.owner === sid && !x.stopped && !x.finished && (x.startedAt || 0) === runStarted && (t.handedAt || 0) === handed && t.state === 'running';
  if (refused) return refused;
  const release = () => { try { update(dir, n, s => { const st = s && s.steps[id]; if (st && st.runner && st.runner.pid === mine.pid) delete st.runner; }); } catch { /* the mark names a dead process: it does not block */ } };
  try {
    for (;;) {
      const s = readJson(stateFile(dir, n));
      const st = s && s.steps[id];
      if (!s || !same(s, st)) return `${id} is no longer running in this session and run; nothing more was run.\n`;
      const cmd = st.pending.find(c => !(st.passed || []).includes(c));
      if (cmd === undefined) return `Step ${id} (gate) passed. Now run: node "${FORGE_JS}" graph next ${n}\n`;
      const why = opts.blocked ? opts.blocked(cmd) : null;
      if (why) return `Not run: "${clean(cmd, 120)}" (${clean(why, 200)}). The gate runner never runs what the block list would hold: run that command with the Bash tool instead.\n`;
      const runNo = nextRunNo(st);
      const log = logFile(dir, n, id, runNo);
      const logShown = paths.display(dir, log);
      write(`JSPARK Forge: step ${id} (gate): running: ${cmd}\nIts output goes to ${logShown} (how far it has got: node "${FORGE_JS}" graph status ${n})\n`);
      // An older log with this number is removed first: if the new one cannot be written, the old one's counts and
      // names must not be read as this run's (review of v0.7).
      try { fs.unlinkSync(log); } catch { /* none */ }
      const t0 = Date.now();
      const r = (opts.run || (c => runShell(dir, c, log)))(cmd, log);
      if (r.error || r.signal || typeof r.status !== 'number') {
        return `Step ${id} (gate): "${clean(cmd, 120)}" did not finish (${clean(r.error ? r.error.message : `stopped by ${r.signal}`, 120)}); nothing was recorded for it. Run the same graph gate command again.\n`;
      }
      // Read before the record is locked: the log can be large, and git can take a moment.
      const text = readLog(log);
      const extra = { ms: Date.now() - t0, sum: readResults(text), code: codeState(dir), log: text ? logShown : '' };
      pruneLogs(dir, n, id, runNo);
      let verdict;
      try {
        verdict = updatePatiently(dir, n, x => {
        const t = x && x.steps[id];
        if (!x || !same(x, t) || !t.pending.includes(cmd)) return { msg: `${id} changed while its command ran (the run was stopped, started again or moved); the result was not recorded.` };
        seen(x, sid);
        const step = x.graph.steps.find(k => k.id === id) || { run: t.pending.slice(), retry: '' };
        return settleGate(n, id, step, t, cmd, r.status, extra);
        });
      } catch (e) {
        if (!e || !e.busy) throw e;
        return `Step ${id} (gate): "${clean(cmd, 120)}" finished with exit code ${r.status}, but the run's record stayed busy for a minute, so it was NOT recorded. Tell the user; run the same graph gate command again.\n`;
      }
      // What Claude sees instead of the whole output: the end of it on a failure, one line on a pass.
      if (r.status !== 0 && text) write(`--- last lines of the output ---\n${tailOf(text)}\n--- end ---\n`);
      if (verdict.cont) { if (verdict.msg) write(`${verdict.msg}\n`); continue; }
      return `${verdict.msg}\n`;
    }
  } finally { release(); }
}

// ---------- TRUST GRAPH <name>, the person's own whole message ----------
// Never dropped in silence (owner 2026-11-22: sent four times before `graph start` had asked, it was ignored each time
// and looked like a fault). A valid graph is trusted as it is now, whether or not `start` has shown it, and the answer
// lists what was trusted; a graph that is missing or not valid gets one line; a message that is close but not exact
// trusts nothing and is told the exact text. Commands that changed after `start` showed them are still refused (M1).
const graphNames = dir => { try { return fs.readdirSync(path.join(paths.repoForgeDir(dir), 'graphs')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).filter(x => NAME.test(x)).sort(); } catch { return []; } };
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function trustGraph(dir, n) {
  const L = load(dir, n);
  if (L.error) return `JSPARK Forge: nothing was trusted: ${L.error}`;
  if (L.errs.length) return `JSPARK Forge: nothing was trusted: build graph ${n} is not valid (node "${FORGE_JS}" graph check ${n} says what is wrong).`;
  const t0 = trustOf(dir);
  const asked = t0.asked[n];
  if (asked && L.runHash !== asked) return `JSPARK Forge: build graph ${n}'s commands changed since they were shown, so nothing was trusted. Run node "${FORGE_JS}" graph start ${n} again to see them.`;
  const names = list => list.join(', ') || 'none';
  const cmds = L.runs.length ? `the commands it runs by itself at its check steps: ${L.runs.join('; ')}` : 'it runs no commands';
  const rest = `gates: ${names(L.guard.gates.map(x => x[0]))}; human steps: ${names(L.guard.human)}${L.guard.noAhead ? `; never approved ahead: ${L.guard.noAhead.join(', ')}` : ''}${L.guard.lock ? `; lock: ${L.guard.lock}` : ''}`;
  if (!asked && t0.trusted[n] === L.runHash) return `JSPARK Forge: build graph ${n} is already trusted as it is now (${cmds}; ${rest}). Nothing changed.`;
  withLock(trustFile(dir), () => { const tr = trustOf(dir); tr.trusted[n] = L.runHash; delete tr.asked[n]; writeJson(trustFile(dir), tr); });
  const tail = 'They run only when Claude runs the graph; asked again if its commands, gates or human steps change.';
  if (asked) return `JSPARK Forge: you trusted build graph ${n}'s commands: ${L.runs.join('; ') || 'none (it runs no commands)'}. ${tail}`;
  return `JSPARK Forge: you trusted build graph ${n} as it is now. JSPARK Forge had not asked yet, so this is what you just trusted: ${cmds}; ${rest}. ${tail}`;
}
// -> the answer, or undefined when the message is not about trusting a graph (an ordinary prompt).
function trustPrompt(dir, p) {
  const exact = p.match(/^trust[ \t]+graph[ \t]+([a-z][a-z0-9-]{0,39})$/i);
  if (exact) return trustGraph(dir, exact[1].toLowerCase());
  // Close but not exact: a short one-line message that has the words with something extra, or the words misspelt.
  if (p.length > 80 || /[\r\n]/.test(p)) return undefined;
  const words = p.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return undefined;
  const letters = w => w.toLowerCase().replace(/[^a-z]/g, '');
  const has = p.match(/\btrust[ \t]+(?:the[ \t]+)?graph\b(.*)$/i);
  let rest = null;
  if (has) rest = has[1];
  else if (letters(words[0]).length >= 8 && editDistance(letters(words[0]), 'trustgraph') <= 2) rest = words.slice(1).join(' ');
  else if (words.length >= 2 && editDistance(`${letters(words[0])} ${letters(words[1])}`, 'trust graph') <= 2) rest = words.slice(2).join(' ');
  if (rest === null) return undefined;
  const here = graphNames(dir);
  const named = (rest.toLowerCase().match(/[a-z][a-z0-9-]*/g) || []).map(w => w.replace(/-+$/, '')).filter(w => here.includes(w));
  const n = named.length === 1 ? named[0] : '<name>';
  return `JSPARK Forge: that is close to TRUST GRAPH but not exact, so nothing was trusted.${n === '<name>' ? ` Graphs here: ${here.join(', ') || 'none'}.` : ''} Send exactly this as your whole message: TRUST GRAPH ${n}`;
}

// The user's own whole message: TRUST GRAPH <name> after `start` showed its commands, or, while a run is active,
// DONE <step> (or "done" when exactly one human step waits), from any attended session. -> a message for the user
// (the prompt is a control message, not stored as the last request), or null (an ordinary prompt).
function onPrompt(dir, prompt, sid) {
  if (!paths.isOwn(dir) || process.env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return null;
  // Text the harness wraps (a helper's report, a notice, command output) is never the person typing, wherever in the
  // message it sits: such a message is never a control message (the same test CONFIRM uses).
  if (require('./confirm').WRAPPED.test(String(prompt || ''))) return null;
  const p = String(prompt || '').trim();
  // The person's decision on a human step, given before the run reaches it, and its withdrawal. Always answered.
  const ap = p.match(/^approve[ \t]+ahead[ \t]+([a-z][a-z0-9-]{0,39})[ \t]+([a-z][a-z0-9-]{0,39})$/i);
  if (ap) return approveAhead(dir, ap[1].toLowerCase(), ap[2].toLowerCase());
  const ca = p.match(/^cancel[ \t]+approval[ \t]+([a-z][a-z0-9-]{0,39})[ \t]+([a-z][a-z0-9-]{0,39})$/i);
  if (ca) return cancelAhead(dir, ca[1].toLowerCase(), ca[2].toLowerCase());
  const tg = trustPrompt(dir, p);
  if (tg !== undefined) return tg;
  // DONE <step>, DONE <graph> <step> (needed when the same step waits in two open graphs), or "done" when exactly one
  // human step waits in all open graphs.
  const names = openRuns(dir);
  if (!names.length) return null;
  const d = p.match(/^done(?:[ \t]+([a-z][a-z0-9-]{0,39}))?(?:[ \t]+([a-z][a-z0-9-]{0,39}))?$/i);
  if (!d) { for (const m of names) touch(dir, m, sid); return null; }
  const a1 = d[1] && d[1].toLowerCase();
  const a2 = d[2] && d[2].toLowerCase();
  const humansOf = m => { const s = readJson(stateFile(dir, m)); return openRun(s) ? s.graph.steps.filter(x => x.kind === 'human').map(x => ({ id: x.id, waits: s.steps[x.id].state === 'running' })) : []; };
  let n, id;
  if (a2) {
    if (!names.includes(a1) || !humansOf(a1).some(h => h.id === a2)) return null;
    n = a1; id = a2;
  } else if (a1) {
    const has = names.filter(m => humansOf(m).some(h => h.id === a1));
    if (!has.length) return null;
    const waits = has.filter(m => humansOf(m).some(h => h.id === a1 && h.waits));
    if (waits.length > 1) return `JSPARK Forge: ${a1} is waiting in more than one build graph (${waits.join(', ')}), so nothing changed. Say which one: send DONE <graph> ${a1}`;
    n = waits[0] || has[0]; id = a1;
  } else {
    const all = names.flatMap(m => humansOf(m).filter(h => h.waits).map(h => [m, h.id]));
    if (all.length !== 1) return null;
    [n, id] = all[0];
  }
  return update(dir, n, s => {
    if (!openRun(s)) return null;
    seen(s, sid);
    const x = s.graph.steps.find(k => k.id === id && k.kind === 'human');
    if (!x) return null;
    if (s.steps[id].state !== 'running') {
      const can = s.steps[id].state === 'waiting' && x.ahead !== 'no' && !(s.ahead && s.ahead[id]);
      return `JSPARK Forge: ${id} is not waiting for you now, so nothing changed.${can ? ` To give your decision before the run reaches it, send as your whole message: APPROVE AHEAD ${n} ${id}` : ''}`;
    }
    s.steps[id].state = 'done'; s.steps[id].doneAt = Date.now();
    return `JSPARK Forge: ${id} done (your reply). The build graph continues: node "${FORGE_JS}" graph next ${n}`;
  });
}

module.exports = { check, start, next, takeover, done, fail, rerun, stop, status, statusAll, current, currentAll, gate, gateShell, onSubagentStart, onAgentResult, onCommand, onPrompt, NAME, load };
