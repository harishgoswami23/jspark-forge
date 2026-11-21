'use strict';
// v0.4 build graph file (design-v0.4 section 2): `.jspark-forge/graphs/<name>.md`, one step per heading.
// parse() reads it leniently; validate() lists every problem with its line before any run; order() gives a run order
// that respects `after:` and the fields steps need from each other. Pure functions: no files, no processes.
const KINDS = new Set(['agent', 'parallel', 'gate', 'human']);
const HELPERS = new Set(['planner', 'reviewer', 'builder', 'checker']);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const FIELD = /^[a-z][a-z0-9_]{0,40}$/;
const LIST_KEYS = new Set(['needs', 'gives', 'after', 'steps']);
const MAX_RUN = 200;
// A gate command is printed and matched exactly as written, so it must already be what cleaning would show: one line,
// no tabs, double spaces or hidden characters, at most 200 characters (v0.4 code review M2).
const cleanRun = r => require('./memory').clean(r, MAX_RUN) === r;

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function parse(text) {
  const lines = String(text || '').replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').split(/\r?\n/);
  const g = { name: '', nameLine: 0, maxParallel: 1, maxParallelRaw: null, memLine: 0, steps: [] };
  let cur = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    const title = line.match(/^#\s+Graph:\s*(\S.*?)\s*$/);
    if (title && !g.name) { g.name = title[1]; g.nameLine = n; return; }
    const head = line.match(/^##\s+(\S.*?)\s+\(([^)]*)\)\s*$/);
    if (head) { cur = { id: head[1], kind: head[2].trim().toLowerCase(), line: n, needs: [], gives: [], after: [], steps: [], run: [], before: [], retries: [], fieldLines: {} }; g.steps.push(cur); return; }
    const f = line.match(/^-\s+([A-Za-z_]+):\s*(.*?)\s*$/);
    if (!f) return;
    const key = f[1].toLowerCase();
    const val = f[2];
    if (!cur) {
      if (key === 'max_parallel') { g.maxParallelRaw = val; g.maxParallel = Number(val); g.maxParallelLine = n; }
      if (key === 'min_free_memory_mb') g.memLine = n; // cut from v0.4 (design section 6): reported by validate()
      return;
    }
    cur.fieldLines[key] = cur.fieldLines[key] || n;
    if (key === 'run') { if (val) cur.run.push(val); return; }
    if (key === 'before') { cur.before.push({ value: val, line: n }); return; } // v0.7: what must be true before a gate starts
    if (key === 'retry') { cur.retries.push({ value: val, line: n }); return; } // v0.7: the command that runs only what failed
    if (LIST_KEYS.has(key)) { cur[key] = cur[key].concat(list(val)); return; }
    cur[key] = val;
  });
  if (g.maxParallelRaw === null) g.maxParallel = 1;
  return g;
}

// -> [{ line, message }], empty when the graph can run. fileName: the graph's file name without .md, which the
// title must match.
function validate(g, fileName) {
  const errs = [];
  const err = (line, message) => errs.push({ line: line || 1, message });
  if (!g.name) err(1, 'the first heading must be "# Graph: <name>"');
  else if (fileName && g.name !== fileName) err(g.nameLine, `the title must name the file: "# Graph: ${fileName}"`);
  if (g.maxParallelRaw !== null && !(Number.isInteger(g.maxParallel) && g.maxParallel >= 1 && g.maxParallel <= 8)) err(g.maxParallelLine, 'max_parallel must be a whole number from 1 to 8');
  if (g.memLine) err(g.memLine, '"min_free_memory_mb" is not supported in v0.4 (max_parallel and the plan-usage cap remain)');
  if (!g.steps.length) err(g.nameLine || 1, 'a graph needs at least one step ("## <id> (<kind>)")');
  const byId = new Map();
  for (const s of g.steps) {
    if (!ID.test(s.id)) err(s.line, `step id "${s.id}" must start with a letter, then lower-case letters, digits and dashes (at most 40)`);
    if (byId.has(s.id)) err(s.line, `step "${s.id}" is defined twice`);
    else byId.set(s.id, s);
    if (!KINDS.has(s.kind)) { err(s.line, `unknown kind "${s.kind}" (agent, parallel, gate or human)`); continue; }
    if (s.kind === 'agent') {
      if (!s.helper) err(s.line, `step "${s.id}" needs "helper:" (planner, reviewer, builder or checker)`);
      else if (s.helper.includes(':')) err(s.fieldLines.helper || s.line, `helper "${s.helper}" is not supported in v0.4 (planner, reviewer, builder or checker)`);
      else if (!HELPERS.has(s.helper)) err(s.fieldLines.helper || s.line, `unknown helper "${s.helper}" (planner, reviewer, builder or checker)`);
    }
    if (s.fieldLines.model) err(s.fieldLines.model, '"model:" is not supported in v0.4 (each helper runs on its own tier)');
    if (s.kind === 'gate' && !s.run.length) err(s.line, `gate needs at least one "run:" line`);
    // One simple command per line: no chaining, pipes, redirects or substitutions (design-v0.4 2, review H2/H4).
    if (s.kind === 'gate') {
      for (const r of s.run) {
        if (/[;&|<>`]|\$\(/.test(r) || !cleanRun(r)) err(s.fieldLines.run || s.line, `gate "${s.id}": each "run:" line must be one simple command (no ; && | > < \` or $( ), no tabs, double spaces or hidden characters, at most ${MAX_RUN} characters)`);
      }
    }
    if (s.kind === 'human' && !s.say) err(s.line, `human step needs "say:" (one plain instruction)`);
    // v0.7 (design-v0.7 1): "before:" and "retry:" belong to gates. A "before:" line is one of a few fixed forms, never
    // a command; "retry:" is a command like "run:", and needs a gate with one "run:" line so "what failed" has one meaning.
    if (s.kind !== 'gate') {
      if (s.before.length) err(s.before[0].line, `"before:" belongs to a gate step ("${s.id}" is ${s.kind})`);
      if (s.retries.length) err(s.retries[0].line, `"retry:" belongs to a gate step ("${s.id}" is ${s.kind})`);
    } else {
      for (const b of s.before) { const p = require('./preflight').parse(b.value); if (p.error) err(b.line, `gate "${s.id}": ${p.error}`); }
      if (s.retries.length > 1) err(s.retries[1].line, `gate "${s.id}" has more than one "retry:" line (one at most)`);
      if (s.retries.length && s.run.length !== 1) err(s.retries[0].line, `gate "${s.id}": "retry:" needs exactly one "run:" line (it has ${s.run.length})`);
      for (const r of s.retries) {
        if (!r.value || /[;&|<>`]|\$\(/.test(r.value) || !cleanRun(r.value)) err(r.line, `gate "${s.id}": the "retry:" line must be one simple command (no ; && | > < \` or $( ), no tabs, double spaces or hidden characters, at most ${MAX_RUN} characters)`);
        else if (s.run.includes(r.value)) err(r.line, `gate "${s.id}": the "retry:" command is the same as its "run:" command; it should run only what failed`);
      }
    }
    for (const k of ['needs', 'gives']) for (const name of s[k]) if (!FIELD.test(name)) err(s.fieldLines[k] || s.line, `field name "${name}" must be lower-case letters, digits and underscores`);
  }
  const giver = new Map();
  for (const s of g.steps) for (const name of s.gives) {
    if (giver.has(name)) err(s.fieldLines.gives || s.line, `field "${name}" is given twice (${giver.get(name)} and ${s.id})`);
    else giver.set(name, s.id);
  }
  for (const s of g.steps) {
    for (const a of s.after) if (!byId.has(a)) err(s.fieldLines.after || s.line, `step "${s.id}" runs after a missing step "${a}"`);
    if (s.kind === 'parallel') for (const c of s.steps) if (!byId.has(c)) err(s.fieldLines.steps || s.line, `parallel "${s.id}" names a missing step "${c}"`);
    for (const name of s.needs) if (!giver.has(name)) err(s.fieldLines.needs || s.line, `step "${s.id}" needs "${name}", which no earlier step gives`);
  }
  if (!errs.length) { const c = cycle(g); if (c) err(byId.get(c[0]).line, `cycle: ${c.join(' -> ')}`); }
  return errs;
}

// What each step waits for: its after: steps (a parallel stands for its children), the givers of its needs, and for a
// step inside a parallel, the parallel's own after:.
function deps(g) {
  const byId = new Map(g.steps.map(s => [s.id, s]));
  const giver = new Map();
  for (const s of g.steps) for (const f of s.gives) if (!giver.has(f)) giver.set(f, s.id);
  const parentOf = new Map();
  for (const s of g.steps) if (s.kind === 'parallel') for (const c of s.steps) parentOf.set(c, s.id);
  const expand = id => { const s = byId.get(id); return s && s.kind === 'parallel' ? [id, ...s.steps] : [id]; };
  const out = new Map();
  for (const s of g.steps) {
    const d = new Set();
    for (const a of s.after) for (const x of expand(a)) d.add(x);
    for (const f of s.needs) if (giver.has(f)) for (const x of expand(giver.get(f))) d.add(x);
    const p = parentOf.get(s.id);
    if (p) for (const a of byId.get(p).after) for (const x of expand(a)) d.add(x);
    d.delete(s.id);
    out.set(s.id, [...d].filter(x => byId.has(x) && x !== p));
  }
  return out;
}

function cycle(g) {
  const d = deps(g);
  const state = new Map();
  const stack = [];
  const visit = id => {
    state.set(id, 1); stack.push(id);
    for (const x of d.get(id) || []) {
      if (state.get(x) === 1) return [...stack.slice(stack.indexOf(x)), x];
      if (!state.get(x)) { const c = visit(x); if (c) return c; }
    }
    state.set(id, 2); stack.pop();
    return null;
  };
  for (const s of g.steps) if (!state.get(s.id)) { const c = visit(s.id); if (c) return c; }
  return null;
}

// A run order (file order where free). Assumes validate() returned no errors.
function order(g) {
  const d = deps(g);
  const done = new Set();
  const out = [];
  while (out.length < g.steps.length) {
    const next = g.steps.find(s => !done.has(s.id) && (d.get(s.id) || []).every(x => done.has(x)));
    if (!next) break;
    done.add(next.id); out.push(next.id);
  }
  return out;
}

module.exports = { parse, validate, order, deps, KINDS, HELPERS, ID };
