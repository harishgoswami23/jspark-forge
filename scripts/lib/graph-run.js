'use strict';
// v0.4 build graph runner (design-v0.4 revision 2). Claude runs the loop through /jspark-forge:build; this module keeps
// the record and checks what can be checked: a valid graph, trusted commands, protected state (the block list denies
// writes to it), outputs that are declared and real, helper evidence, gate results from real exit codes, human steps
// completed only by the user's own message, one run at a time, and a cap on handed-out steps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const paths = require('./paths');
const G = require('./graph');

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_VALUE = 500;
const FORGE_JS = path.join(__dirname, '..', 'forge.js').replace(/\\/g, '/');
const graphFile = (dir, n) => path.join(paths.repoForgeDir(dir), 'graphs', `${n}.md`);
const stateFile = (dir, n) => path.join(paths.forgeDir(dir), 'state', `graph-${n}.json`);
const trustFile = dir => path.join(paths.forgeDir(dir), 'state', 'graph-trust.json');
const activeFile = dir => path.join(paths.forgeDir(dir), 'state', 'graph-active.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); require('./fsx').writeAtomic(f, `${JSON.stringify(v, null, 1)}\n`); };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const clean = (s, n) => require('./memory').clean(s, n);

// A small lock around read-modify-write of one file: parallel reports and hooks never lose each other's updates.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd = null;
  for (let i = 0; i < 200 && fd === null; i++) {
    try { fd = fs.openSync(lock, 'wx'); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.unlinkSync(lock); } catch { /* gone */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try { return fn(); } finally { if (fd !== null) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lock); } catch {} } }
}
function update(dir, n, fn) {
  const f = stateFile(dir, n);
  return withLock(f, () => { const s = readJson(f); if (!s) return fn(null); const r = fn(s); writeJson(f, s); return r; });
}

function load(dir, n) {
  if (!NAME.test(String(n || ''))) return { error: 'A graph name is lower-case letters, digits and dashes (for example ship-feature).' };
  let text;
  try { text = fs.readFileSync(graphFile(dir, n), 'utf8'); } catch { return { error: `No graph .jspark-forge/graphs/${n}.md.` }; }
  const g = G.parse(text);
  const errs = G.validate(g);
  const runs = g.steps.filter(s => s.kind === 'gate').flatMap(s => s.run);
  return { text, g, errs, hash: sha(text), runs, runHash: sha(runs.join('\n')) };
}
const trusted = (dir, n, L) => !L.runs.length || ((readJson(trustFile(dir)) || {})[n] === L.runHash);
const active = dir => readJson(activeFile(dir));
const setActive = (dir, v) => { if (v) writeJson(activeFile(dir), v); else { try { fs.unlinkSync(activeFile(dir)); } catch { /* none */ } } };

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
  if (L.errs.length) return `Build graph ${n} cannot start:\n${check(dir, n)}`;
  if (!trusted(dir, n, L)) {
    return `Build graph ${n} runs these commands on your machine:\n${L.runs.map(r => `- ${clean(r, 200)}`).join('\n')}\n` +
      `To allow them, the user types: TRUST GRAPH ${n} (the whole message). Asked again whenever these commands change.\n`;
  }
  const a = active(dir);
  if (a && a.name !== n) { const s = readJson(stateFile(dir, a.name)); if (s && !s.stopped && !s.finished) return `Another build graph is already running: ${a.name}. Stop it first: forge.js graph stop ${a.name}\n`; }
  if (a && a.name === n) { const s = readJson(stateFile(dir, n)); if (s && !s.stopped && !s.finished) return `Build graph ${n} is already running; continue with: forge.js graph next ${n}\n`; }
  const steps = {};
  for (const s of L.g.steps) steps[s.id] = { state: 'waiting', retries: 0 };
  writeJson(stateFile(dir, n), { name: n, hash: L.hash, owner: sid, startedAt: Date.now(), steps, evidence: [] });
  setActive(dir, { name: n });
  const est = L.g.steps.filter(s => s.estimate).map(s => `${s.id}: ${clean(s.estimate, 60)}`);
  return `Started build graph ${n} (${L.g.steps.length} steps).${est.length ? ` Estimates (estimate): ${est.join('; ')}.` : ''}\nNext: node "${FORGE_JS}" graph next ${n}\n`;
}

// Plan usage only (not context): at 95 % nothing is handed out; unknown counts as under the limit.
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

function next(dir, n, sid) {
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  return update(dir, n, s => {
    if (!s) return `Build graph ${n} has not started: forge.js graph start ${n}\n`;
    if (s.stopped) return `Build graph ${n} is stopped (${s.stopped}).\n`;
    if (s.finished) return `Build graph ${n} is finished.\n`;
    if (s.hash !== L.hash) { s.stopped = 'the graph file changed during the run'; setActive(dir, null); return `The graph file changed since the run started, so the run is stopped. Start it again: forge.js graph start ${n}\n`; }
    const out = [];
    if (s.owner !== sid) {
      const was = Object.entries(s.steps).filter(([, v]) => v.state === 'running').map(([k]) => k);
      for (const k of was) s.steps[k].state = 'interrupted';
      s.owner = sid;
      if (was.length) out.push(`Interrupted in an earlier session: ${was.join(', ')}. Ask the user: run again (forge.js graph rerun ${n} <step>) or stop (forge.js graph stop ${n}).`);
    }
    settle(L.g, s);
    const failed = Object.entries(s.steps).find(([, v]) => v.state === 'failed');
    if (failed) { out.push(`Stopped: ${failed[0]} failed (${clean(failed[1].reason || 'no reason given', 200)}). Show this to the user.`); return `${out.join('\n')}\n`; }
    if (L.g.steps.every(x => s.steps[x.id].state === 'done')) { s.finished = Date.now(); setActive(dir, null); return `${out.concat([`Build graph ${n} finished.`]).join('\n')}\n`; }
    const deps = G.deps(L.g);
    const byId = new Map(L.g.steps.map(x => [x.id, x]));
    const ready = G.order(L.g).map(id => byId.get(id))
      .filter(x => x.kind !== 'parallel' && s.steps[x.id].state === 'waiting' && (deps.get(x.id) || []).every(d => s.steps[d].state === 'done'));
    const pct = planPct(dir, sid);
    let running = L.g.steps.filter(x => x.kind === 'agent' && s.steps[x.id].state === 'running').length;
    const outputs = {};
    for (const v of Object.values(s.steps)) Object.assign(outputs, v.outputs || {});
    for (const x of ready) {
      const st = s.steps[x.id];
      if (x.kind === 'agent') {
        if (pct !== null && pct >= 95) { out.push(`Plan usage is at ${pct} %: no new helper steps until it drops.`); break; }
        if (running >= L.g.maxParallel) continue;
        running++;
        st.state = 'running'; st.handedAt = Date.now();
        const inputs = x.needs.map(f => `${f}=${clean(outputs[f], 200)}`).join('; ');
        out.push(`Step ${x.id} (agent): use the Agent tool with subagent_type "jspark-forge:${x.helper}" and description "[graph ${n}/${x.id}] ${x.id}".` +
          `${x.brief ? ` Brief: ${clean(x.brief, 200)}.` : ''}${inputs ? ` Inputs: ${inputs}.` : ''} Return exactly: ${x.gives.length ? x.gives.join(', ') : 'nothing'}.` +
          ` Then write those fields as JSON to .jspark-forge/state/report-${x.id}.json and run: node "${FORGE_JS}" graph done ${n} ${x.id} --from .jspark-forge/state/report-${x.id}.json` +
          ` (if the step fails: node "${FORGE_JS}" graph fail ${n} ${x.id} "<reason>").`);
      } else if (x.kind === 'gate') {
        st.state = 'running'; st.handedAt = Date.now(); st.pending = x.run.slice(); st.passed = [];
        out.push(`Step ${x.id} (gate): Run each command with the Bash tool exactly as written: (one per call)\n` +
          `${x.run.map(r => `  ${clean(r, 200)}`).join('\n')}\nJSPARK Forge records each exit code; a failing one stops the run.`);
      } else if (x.kind === 'human') {
        st.state = 'running'; st.handedAt = Date.now();
        out.push(`Step ${x.id} (human): Show the user: ${clean(x.say, 300)} Then stop and wait; only the user's own message DONE ${x.id} completes it.`);
      }
    }
    if (!out.length) {
      const now = Object.entries(s.steps).filter(([, v]) => v.state === 'running' || v.state === 'interrupted').map(([k, v]) => `${k} ${v.state}`);
      out.push(now.length ? `Nothing new to start: waiting for ${now.join(', ')}.` : 'Nothing can start now.');
    }
    return `${out.join('\n')}\n`;
  });
}

function evidenceFor(s, helper, since) {
  return (s.evidence || []).find(e => !e.used && e.at >= since && (e.type === helper || e.type === `jspark-forge:${helper}` || String(e.type).endsWith(`:${helper}`)));
}
const git = (dir, args) => spawnSync('git', args, { cwd: dir, timeout: 3000, windowsHide: true, stdio: 'ignore' }).status === 0;

function done(dir, n, id, file, sid) {
  const L = load(dir, n);
  if (L.error) return `${L.error}\n`;
  const x = L.g.steps.find(s => s.id === id);
  if (!x) return `Build graph ${n} has no step "${clean(id, 40)}".\n`;
  if (x.kind === 'human') return `${id} is a human step: only the user's own message DONE ${id} completes it.\n`;
  if (x.kind === 'gate') return `${id} is a gate: it completes from its commands' exit codes, not from a report.\n`;
  if (x.kind !== 'agent') return `${id} is not a step that reports.\n`;
  let rep;
  try { rep = JSON.parse(fs.readFileSync(path.resolve(String(file || '')), 'utf8')); } catch { return 'Could not read the report file as JSON; nothing recorded.\n'; }
  if (!rep || typeof rep !== 'object' || Array.isArray(rep)) return 'The report must be a JSON object of the declared fields.\n';
  return update(dir, n, s => {
    if (!s) return `Build graph ${n} has not started.\n`;
    const st = s.steps[id];
    const same = () => JSON.stringify(Object.keys(rep).sort().map(k => [k, String(rep[k])])) === JSON.stringify(Object.keys(st.outputs || {}).sort().map(k => [k, String(st.outputs[k])]));
    if (st.state === 'done') return same() ? `${id} is already done; the same report is ignored.\n` : `Refused: ${id} was already reported with other values. Tell the user.\n`;
    if (st.state !== 'running') return `${id} is not running (not handed out yet); run forge.js graph next ${n} first.\n`;
    const extra = Object.keys(rep).filter(k => !x.gives.includes(k));
    if (extra.length) return `Refused: not declared: ${extra.join(', ')}. ${id} gives only: ${x.gives.join(', ') || 'nothing'}.\n`;
    const missing = x.gives.filter(k => !(k in rep));
    if (missing.length) return `Refused: missing: ${missing.join(', ')}.\n`;
    for (const k of x.gives) {
      const v = rep[k];
      if (!['string', 'number', 'boolean'].includes(typeof v) || String(v).length > MAX_VALUE) return `Refused: ${k} must be a short value (at most ${MAX_VALUE} characters).\n`;
      if (/(^|_)path$/.test(k)) {
        const abs = path.resolve(dir, String(v));
        const rel = path.relative(dir, abs);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) return `Refused: ${k} "${clean(v, 120)}" does not exist in the project.\n`;
      }
      if (/(^|_)commit$/.test(k) && (!/^[0-9a-f]{7,40}$/i.test(String(v)) || !git(dir, ['cat-file', '-e', `${v}^{commit}`]))) return `Refused: ${k} "${clean(v, 60)}" does not resolve to a commit.\n`;
    }
    const ev = evidenceFor(s, x.helper, st.handedAt || 0);
    if (!ev) return `Refused: no ${x.helper} helper ran since ${id} was handed out. Dispatch jspark-forge:${x.helper} for it first.\n`;
    ev.used = id;
    st.state = 'done'; st.doneAt = Date.now(); st.outputs = rep;
    st.minutes = Math.round((st.doneAt - (st.handedAt || st.doneAt)) / 6000) / 10;
    return `${id} done. Continue: node "${FORGE_JS}" graph next ${n}\n`;
  });
}

function fail(dir, n, id, reason) {
  return update(dir, n, s => {
    if (!s || !s.steps[id]) return `No running step "${clean(id, 40)}" in ${n}.\n`;
    const st = s.steps[id];
    if (st.state !== 'running') return `${id} is not running.\n`;
    if (!st.retries) { st.retries = 1; st.state = 'waiting'; st.reason = clean(reason, 200); return `${id} failed (${st.reason}); it will retry once at the next forge.js graph next ${n}.\n`; }
    st.state = 'failed'; st.reason = clean(reason, 200);
    return `${id} failed again (${st.reason}); the run is stopped. Show this to the user.\n`;
  });
}
function rerun(dir, n, id) {
  return update(dir, n, s => {
    if (!s || !s.steps[id]) return `No step "${clean(id, 40)}" in ${n}.\n`;
    const st = s.steps[id];
    if (!['interrupted', 'failed'].includes(st.state)) return `${id} is ${st.state}; only an interrupted or failed step can run again.\n`;
    st.state = 'waiting'; delete st.reason; delete s.stopped;
    return `${id} will run again (the retry is not used up). Continue: forge.js graph next ${n}\n`;
  });
}
function stop(dir, n) {
  const r = update(dir, n, s => { if (!s) return null; s.stopped = 'stopped by request'; return true; });
  const a = active(dir);
  if (a && a.name === n) setActive(dir, null);
  return r ? `Build graph ${n} stopped (its record is kept).\n` : `Build graph ${n} has not started.\n`;
}

function summary(dir, n) {
  const L = load(dir, n);
  const s = readJson(stateFile(dir, n));
  if (L.error || !s) return null;
  const ids = L.g.steps.filter(x => x.kind !== 'parallel').map(x => x.id);
  const doneN = ids.filter(i => s.steps[i] && s.steps[i].state === 'done').length;
  const now = ids.filter(i => s.steps[i] && ['running', 'interrupted', 'failed'].includes(s.steps[i].state)).map(i => `${i} ${s.steps[i].state === 'running' && L.g.steps.find(x => x.id === i).kind === 'human' ? 'waiting for the user' : s.steps[i].state}`);
  return { task: `Build graph ${n}`, step: `${doneN} of ${ids.length} done${now.length ? `; ${now.join(', ')}` : ''}`, text: `Build graph ${n}: ${doneN} of ${ids.length} steps done${now.length ? `; ${now.join(', ')}` : ''}${s.stopped ? ` (stopped: ${s.stopped})` : ''}.` };
}
function status(dir, n) {
  const sum = summary(dir, n);
  if (!sum) return `Build graph ${n} has not started.\n`;
  const s = readJson(stateFile(dir, n));
  const lines = Object.entries(s.steps).map(([k, v]) => `- ${k}: ${v.state}${v.reason ? ` (${v.reason})` : ''}${v.tokens ? `, ${v.tokens} tokens` : ''}${v.minutes ? `, ${v.minutes} min` : ''}`);
  return `${sum.text}\n${lines.join('\n')}\n`;
}
// The running graph, for session start and the handoff (null when none).
function current(dir) {
  if (!paths.isOwn(dir)) return null;
  const a = active(dir);
  return a ? summary(dir, a.name) : null;
}

// ---------- hooks ----------
function onSubagentStart(dir, input) {
  const a = paths.isOwn(dir) && active(dir);
  if (!a || !input.agent_type) return;
  update(dir, a.name, s => { if (s) s.evidence = (s.evidence || []).concat([{ type: String(input.agent_type), id: input.agent_id, at: Date.now() }]).slice(-50); });
}
function onAgentResult(dir, input) {
  const m = String((input.tool_input || {}).description || '').match(/\[graph ([a-z][a-z0-9-]{0,39})\/([a-z0-9-]{1,41})\]/);
  const a = paths.isOwn(dir) && active(dir);
  if (!m || !a || a.name !== m[1]) return;
  const r = input.tool_response || {};
  update(dir, m[1], s => {
    const st = s && s.steps[m[2]];
    if (!st) return;
    if (typeof r.totalTokens === 'number') st.tokens = r.totalTokens;
    if (typeof r.totalDurationMs === 'number') st.helperMs = r.totalDurationMs;
  });
}
// A gate's command ran through Claude's tool in the main session: record its exit status.
function onCommand(dir, input, ok) {
  if (input.agent_id) return;
  const a = paths.isOwn(dir) && active(dir);
  const cmd = String((input.tool_input || {}).command || '').trim();
  if (!a || !cmd) return;
  update(dir, a.name, s => {
    if (!s) return;
    for (const [id, st] of Object.entries(s.steps)) {
      if (st.state !== 'running' || !Array.isArray(st.pending) || !st.pending.includes(cmd)) continue;
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
// The user's own whole message: TRUST GRAPH <name>, DONE <step>, or "done" when exactly one human step waits.
// -> a message for the user, or null. Attended sessions only.
function onPrompt(dir, prompt) {
  if (!paths.isOwn(dir) || process.env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return null;
  const p = String(prompt || '').trim();
  const t = p.match(/^trust graph ([a-z][a-z0-9-]{0,39})$/i);
  if (t) {
    const n = t[1].toLowerCase();
    const L = load(dir, n);
    if (L.error || L.errs.length) return `JSPARK Forge: build graph ${n} cannot be trusted: ${L.error || 'it has errors (forge.js graph check)'}.`;
    withLock(trustFile(dir), () => { const tr = readJson(trustFile(dir)) || {}; tr[n] = L.runHash; writeJson(trustFile(dir), tr); });
    return `JSPARK Forge: you trusted build graph ${n}'s commands: ${L.runs.map(r => clean(r, 80)).join('; ') || 'none'}. They run only when Claude runs the graph; asked again if they change.`;
  }
  const d = p.match(/^done(?:\s+([a-z0-9-]{1,41}))?$/i);
  const a = active(dir);
  if (!d || !a) return null;
  const L = load(dir, a.name);
  if (L.error) return null;
  return update(dir, a.name, s => {
    if (!s) return null;
    const waiting = L.g.steps.filter(x => x.kind === 'human' && s.steps[x.id].state === 'running').map(x => x.id);
    const id = d[1] ? d[1].toLowerCase() : (waiting.length === 1 ? waiting[0] : null);
    if (!id || !waiting.includes(id)) return null;
    s.steps[id].state = 'done'; s.steps[id].doneAt = Date.now();
    return `JSPARK Forge: ${id} done (your reply). The build graph continues: forge.js graph next ${a.name}`;
  });
}

module.exports = { check, start, next, done, fail, rerun, stop, status, current, onSubagentStart, onAgentResult, onCommand, onPrompt, NAME };
