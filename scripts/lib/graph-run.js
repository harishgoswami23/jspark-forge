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
  const runs = g.steps.filter(s => s.kind === 'gate').flatMap(s => s.run);
  // What TRUST GRAPH covers (re-review M6): the gate commands and which steps are gates and human steps, so dropping
  // a gate or a human step is a change the user is asked about.
  const guard = { gates: g.steps.filter(s => s.kind === 'gate').map(s => [s.id, s.run]), human: g.steps.filter(s => s.kind === 'human').map(s => s.id) };
  return { text, g, errs, hash: sha(text), runs, guard, runHash: sha(JSON.stringify(guard)) };
}
// The part of the graph a run depends on, copied into the run state at start.
function snapshot(g) {
  return { maxParallel: g.maxParallel, steps: g.steps.map(s => ({ id: s.id, kind: s.kind, helper: s.helper || '', brief: s.brief || '',
    needs: s.needs.slice(), gives: s.gives.slice(), after: s.after.slice(), steps: s.steps.slice(), run: s.run.slice(), say: s.say || '',
    estimate: s.estimate || '' })) };
}
// Trust (design-v0.4 2, review M1): { asked: { name: hash of what `start` showed }, trusted: { name: hash } }.
// TRUST GRAPH <name> trusts only what was shown. A graph without commands needs no trust the first time, and its
// first start records its hash; from then on (and for any graph once trusted) a different hash asks again, even with
// no gate left (re-review M6).
const trustOf = dir => { const t = readJson(trustFile(dir)) || {}; return { asked: t.asked || {}, trusted: t.trusted || {} }; };
const trusted = (dir, n, L) => { const t = trustOf(dir).trusted[n]; return t === undefined ? !L.runs.length : t === L.runHash; };
// Another session that was active in the last 30 minutes owns the run: a command from here changes nothing.
function notOwner(s, n, sid) {
  if (s.owner === sid) return null;
  const idle = Date.now() - (s.lastSeen || s.startedAt || 0);
  if (idle >= OWNER_IDLE_MS) return null;
  return `Build graph ${n} is being run by another session (active ${Math.round(idle / 60000)} min ago); continue it there. ` +
    `If that session has ended, take the run over: node "${FORGE_JS}" graph takeover ${n}\n`;
}
const active = dir => readJson(activeFile(dir));
const setActive = (dir, v) => { if (v) writeJson(activeFile(dir), v); else { try { fs.unlinkSync(activeFile(dir)); } catch { /* none */ } } };
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
  if (!trusted(dir, n, L)) {
    const before = trustOf(dir).trusted[n] !== undefined;
    withLock(trustFile(dir), () => { const t = trustOf(dir); t.asked[n] = L.runHash; writeJson(trustFile(dir), t); });
    const names = list => list.join(', ') || 'none';
    return `${L.runs.length ? `Build graph ${n} will run these commands by itself at its check steps (you do not type them):\n${L.runs.map(r => `- ${r}`).join('\n')}\n` : `Build graph ${n} runs no commands.\n`}` +
      `${before ? `Its gates or human steps changed since it was last trusted; now gates: ${names(L.guard.gates.map(x => x[0]))}; human steps: ${names(L.guard.human)}.\n` : ''}` +
      `To allow it, send exactly this as your whole message: TRUST GRAPH ${n}\nAsked again whenever its commands, gates or human steps change.\n`;
  }
  const a = active(dir);
  if (a && a.name !== n) { const s = readJson(stateFile(dir, a.name)); if (s && !s.stopped && !s.finished) return `Another build graph is already running: ${a.name}. Stop it first: node "${FORGE_JS}" graph stop ${a.name}\n`; }
  if (a && a.name === n) { const s = readJson(stateFile(dir, n)); if (s && !s.stopped && !s.finished) return `Build graph ${n} is already running; continue with: node "${FORGE_JS}" graph next ${n}\n`; }
  if (trustOf(dir).trusted[n] === undefined) { // the first start of a graph without commands: what later edits are compared with
    withLock(trustFile(dir), () => { const t = trustOf(dir); if (t.trusted[n] === undefined) { t.trusted[n] = L.runHash; writeJson(trustFile(dir), t); } });
  }
  const steps = {};
  for (const s of L.g.steps) steps[s.id] = { state: 'waiting', retries: 0 };
  const now = Date.now();
  withLock(stateFile(dir, n), () => writeJson(stateFile(dir, n), { name: n, hash: L.hash, owner: sid, lastSeen: now, startedAt: now,
    graph: snapshot(L.g), steps, evidence: [] }));
  setActive(dir, { name: n });
  const est = L.g.steps.filter(s => s.estimate).map(s => `${s.id}: ${clean(s.estimate, 60)}`);
  return `Started build graph ${n} (${L.g.steps.length} steps).${est.length ? ` Estimates (estimate): ${est.join('; ')}.` : ''}\nNext: node "${FORGE_JS}" graph next ${n}\n`;
}

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

// opts.takeover: `graph takeover <name>`, the user's choice to move a live run to this session.
function next(dir, n, sid, opts = {}) {
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  return update(dir, n, s => {
    if (!s) return `Build graph ${n} has not started: node "${FORGE_JS}" graph start ${n}\n`;
    if (s.stopped) return `Build graph ${n} is stopped (${s.stopped}).\n`;
    if (s.finished) return `Build graph ${n} is finished.\n`;
    if (!s.graph) return OLD_RECORD(n);
    if (s.hash !== L.hash) { s.stopped = 'the graph file changed during the run'; setActive(dir, null); return `The graph file changed since the run started, so the run is stopped. Start it again: node "${FORGE_JS}" graph start ${n}\n`; }
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
    if (g.steps.every(x => s.steps[x.id].state === 'done')) { s.finished = Date.now(); setActive(dir, null); return `${out.concat([`Build graph ${n} finished.`]).join('\n')}\n`; }
    const deps = G.deps(g);
    const byId = new Map(g.steps.map(x => [x.id, x]));
    const ready = G.order(g).map(id => byId.get(id))
      .filter(x => x.kind !== 'parallel' && s.steps[x.id].state === 'waiting' && (deps.get(x.id) || []).every(d => s.steps[d].state === 'done'));
    const pct = planPct(dir, sid);
    let running = g.steps.filter(x => x.kind === 'agent' && s.steps[x.id].state === 'running').length;
    let capSaid = false, unknownSaid = false;
    const outputs = {};
    for (const v of Object.values(s.steps)) Object.assign(outputs, v.outputs || {});
    for (const x of ready) {
      const st = s.steps[x.id];
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
        // Printed exactly as stored and matched exactly (review M2); graph check refuses lines that would print otherwise.
        st.state = 'running'; st.handedAt = Date.now(); st.pending = x.run.slice(); st.passed = []; delete st.runner;
        out.push(`Step ${x.id} (gate): Run each command with the Bash tool exactly as written, one per call, from the project folder, not in the background:\n` +
          `${x.run.map(r => `  ${r}`).join('\n')}\nJSPARK Forge records each exit code; a failing one stops the run.\n` +
          `If a command can take longer than 9 minutes (one tool call waits 10 at most, and a command moved to the background is not recorded), run this instead, with the Bash tool, in the background: node "${FORGE_JS}" graph gate ${n} ${x.id}\n` +
          `It runs the same commands and records their exit codes itself. When it ends, run graph next again.`);
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
        if (left.length) out.push(`Step ${x.id} (gate) still needs: ${left.map(c => clean(c, 120)).join('; ')}. Run them with the Bash tool, or all of them (any length of time) in the background with: node "${FORGE_JS}" graph gate ${n} ${x.id}`);
      }
    }
    return `${out.join('\n')}\n`;
  });
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
    seen(s, sid); s.stopped = 'stopped by request'; return true;
  });
  if (typeof r === 'string') return r;
  const a = active(dir);
  if (a && a.name === n) setActive(dir, null);
  return r ? `Build graph ${n} stopped (its record is kept).\n` : `Build graph ${n} has not started.\n`;
}

// v0.6.2: what a step's state is called when shown. A gate is "running" in the record from the moment it is handed
// out, but nothing may be running: it is shown as running only while graph gate runs its commands, and as
// "not yet passed" otherwise. A human step that was handed out is waiting for the user.
function stateWord(kind, v) {
  if (!v || v.state !== 'running') return v ? v.state : 'unknown';
  if (kind === 'human') return 'waiting for the user';
  if (kind !== 'gate' || runnerLive(v.runner)) return 'running';
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
  return { task: `Build graph ${n}`, step: `${doneN} of ${ids.length} done${now.length ? `; ${now.join(', ')}` : ''}`, text: `Build graph ${n}: ${doneN} of ${ids.length} steps done${now.length ? `; ${now.join(', ')}` : ''}${s.stopped ? ` (stopped: ${s.stopped})` : ''}.` };
}
function status(dir, n) {
  if (!NAME.test(String(n || ''))) return BAD_NAME;
  const sum = summary(dir, n);
  if (!sum) return `Build graph ${n} has not started.\n`;
  const s = readJson(stateFile(dir, n));
  const kinds = new Map(s.graph.steps.map(x => [x.id, x.kind]));
  const lines = Object.entries(s.steps).map(([k, v]) => `- ${k}: ${stateWord(kinds.get(k), v)}${v.reason ? ` (${v.reason})` : ''}${v.state === 'running' && runnerLive(v.runner) ? ` (its commands are being run by graph gate since ${clockOf(v.runner.at)})` : ''}${v.tokens ? `, ${v.tokens} tokens` : ''}${v.minutes ? `, ${v.minutes} min` : ''}`);
  return `${sum.text}\n${lines.join('\n')}\n`;
}
// The running graph, for session start and the handoff (null when none).
function current(dir) {
  if (!paths.isOwn(dir)) return null;
  const a = active(dir);
  return a && NAME.test(String(a.name || '')) ? summary(dir, a.name) : null;
}

// ---------- hooks ----------
// The owner's activity, noted at most once a minute (review M3: a live owner is not replaced silently).
function touch(dir, n, sid) {
  const s = readJson(stateFile(dir, n));
  if (!s || s.owner !== sid || Date.now() - (s.lastSeen || 0) < SEEN_EVERY_MS) return;
  update(dir, n, x => seen(x, sid));
}
const runningGraph = dir => { const a = paths.isOwn(dir) && active(dir); return a && NAME.test(String(a.name || '')) ? a.name : null; };

function onSubagentStart(dir, input) {
  const n = runningGraph(dir);
  if (!n || !input.agent_type) return;
  update(dir, n, s => {
    if (!s) return;
    seen(s, input.session_id);
    s.evidence = (s.evidence || []).concat([{ type: String(input.agent_type), id: input.agent_id, session: input.session_id, at: Date.now() }]).slice(-50);
  });
}
function onAgentResult(dir, input) {
  const m = String((input.tool_input || {}).description || '').match(/\[graph ([a-z][a-z0-9-]{0,39})\/([a-z][a-z0-9-]{0,39})\]/);
  const n = runningGraph(dir);
  if (!m || !n || n !== m[1]) return;
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
  const n = runningGraph(dir);
  const ti = input.tool_input || {};
  const r = input.tool_response || {};
  const cmd = String(ti.command || '').trim();
  if (!n || !cmd) return;
  const s0 = readJson(stateFile(dir, n));
  if (!s0 || s0.owner !== input.session_id) return;
  const counts = !ti.run_in_background && !r.backgroundTaskId && !r.interrupted && sameDir(input.cwd, dir);
  const isGate = st => st.state === 'running' && Array.isArray(st.pending) && st.pending.includes(cmd);
  if (!(counts && Object.values(s0.steps || {}).some(isGate))) { touch(dir, n, input.session_id); return; }
  update(dir, n, s => {
    if (!s || s.owner !== input.session_id) return;
    seen(s, input.session_id);
    for (const st of Object.values(s.steps)) {
      if (!isGate(st)) continue;
      if (!ok) {
        const code = (String(input.error || '').match(/exit code (\d+)/i) || [])[1] || '?';
        st.state = 'failed'; st.reason = `"${clean(cmd, 120)}" exited ${code}`;
        return;
      }
      st.passed = [...new Set((st.passed || []).concat([cmd]))];
      if (st.pending.every(c => st.passed.includes(c))) { st.state = 'done'; st.doneAt = Date.now(); }
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
function runShell(dir, cmd) {
  return spawnSync(gateShell(), ['-c', cmd], { cwd: dir, stdio: 'inherit', windowsHide: true });
}
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
      write(`JSPARK Forge: step ${id} (gate): running: ${cmd}\n`);
      const r = (opts.run || (c => runShell(dir, c)))(cmd);
      if (r.error || r.signal || typeof r.status !== 'number') {
        return `Step ${id} (gate): "${clean(cmd, 120)}" did not finish (${clean(r.error ? r.error.message : `stopped by ${r.signal}`, 120)}); nothing was recorded for it. Run the same graph gate command again.\n`;
      }
      let verdict;
      try {
        verdict = updatePatiently(dir, n, x => {
        const t = x && x.steps[id];
        if (!x || !same(x, t) || !t.pending.includes(cmd)) return `${id} changed while its command ran (the run was stopped, started again or moved); the result was not recorded.\n`;
        seen(x, sid);
        if (r.status !== 0) { t.state = 'failed'; t.reason = `"${clean(cmd, 120)}" exited ${r.status}`; return `Step ${id} (gate) failed: ${t.reason}. Show the user the command and its output; the run is stopped.\n`; }
        t.passed = [...new Set((t.passed || []).concat([cmd]))];
        if (t.pending.every(c => t.passed.includes(c))) { t.state = 'done'; t.doneAt = Date.now(); delete t.runner; return `Step ${id} (gate) passed. Now run: node "${FORGE_JS}" graph next ${n}\n`; }
        return null;
        });
      } catch (e) {
        if (!e || !e.busy) throw e;
        return `Step ${id} (gate): "${clean(cmd, 120)}" finished with exit code ${r.status}, but the run's record stayed busy for a minute, so it was NOT recorded. Tell the user; run the same graph gate command again.\n`;
      }
      if (verdict) return verdict;
    }
  } finally { release(); }
}

// The user's own whole message: TRUST GRAPH <name> after `start` showed its commands, or, while a run is active,
// DONE <step> (or "done" when exactly one human step waits), from any attended session. -> a message for the user
// (the prompt is a control message, not stored as the last request), or null (an ordinary prompt).
function onPrompt(dir, prompt, sid) {
  if (!paths.isOwn(dir) || process.env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return null;
  const p = String(prompt || '').trim();
  const t = p.match(/^trust graph ([a-z][a-z0-9-]{0,39})$/i);
  if (t) {
    const n = t[1].toLowerCase();
    const asked = trustOf(dir).asked[n];
    if (!asked) return null; // nothing was shown for it: an ordinary prompt
    const L = load(dir, n);
    if (L.error || L.errs.length) return `JSPARK Forge: build graph ${n} cannot be trusted: ${L.error || `it has errors (node "${FORGE_JS}" graph check ${n})`}.`;
    if (L.runHash !== asked) return `JSPARK Forge: build graph ${n}'s commands changed since they were shown, so nothing was trusted. Run node "${FORGE_JS}" graph start ${n} again to see them.`;
    withLock(trustFile(dir), () => { const tr = trustOf(dir); tr.trusted[n] = L.runHash; delete tr.asked[n]; writeJson(trustFile(dir), tr); });
    return `JSPARK Forge: you trusted build graph ${n}'s commands: ${L.runs.join('; ') || 'none'}. They run only when Claude runs the graph; asked again if they change.`;
  }
  const n = runningGraph(dir);
  const d = p.match(/^done(?:\s+([a-z][a-z0-9-]{0,39}))?$/i);
  if (!n) return null;
  if (!d) { touch(dir, n, sid); return null; }
  const s0 = readJson(stateFile(dir, n));
  if (!s0 || !s0.graph || s0.stopped || s0.finished) return null;
  return update(dir, n, s => {
    if (!s || !s.graph) return null;
    seen(s, sid);
    const humans = s.graph.steps.filter(x => x.kind === 'human').map(x => x.id);
    const waiting = humans.filter(i => s.steps[i].state === 'running');
    let id;
    if (d[1]) {
      id = d[1].toLowerCase();
      if (!humans.includes(id)) return null;
      if (!waiting.includes(id)) return `JSPARK Forge: ${id} is not waiting for you now, so nothing changed.`;
    } else {
      if (waiting.length !== 1) return null;
      id = waiting[0];
    }
    s.steps[id].state = 'done'; s.steps[id].doneAt = Date.now();
    return `JSPARK Forge: ${id} done (your reply). The build graph continues: node "${FORGE_JS}" graph next ${n}`;
  });
}

module.exports = { check, start, next, takeover, done, fail, rerun, stop, status, current, gate, gateShell, onSubagentStart, onAgentResult, onCommand, onPrompt, NAME, load };
