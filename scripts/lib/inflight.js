'use strict';
// v0.5.1 crash recovery: what a session had started and not yet finished. One small file per call, in the folder
// state/inflight-<session>/ (crash review S2: a single list file lost entries when calls ran in parallel).
// PreToolUse adds a file for an allowed call that can change things (flushed to the disk: it is the record that matters
// most in a power cut); PostToolUse and PostToolUseFailure remove it; Stop empties the folder. After a crash, what is
// left is what was in flight. PreToolUse has a 3 second limit and runs on every call, so this is one small write, and
// nothing here ever throws. An old-style state/inflight-<session>.json (v0.5.1 before the review) is read when it is
// younger than 7 days and ignored otherwise.
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');
const { redact } = require('./redact');
const state = require('./state');

const TOOLS = new Set(['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit', 'Agent']);
const CMD_MAX = 200;
const PATH_MAX = 300;
const MAX_ENTRIES = 30;
const OLD_MS = 7 * 24 * 3600 * 1000;

const sidOf = sid => String(sid || 'unknown').replace(/[^A-Za-z0-9-]/g, '');
const dirOf = (dir, sid) => path.join(state.stateDir(dir), `inflight-${sidOf(sid)}`);
const legacyFile = (dir, sid) => path.join(state.stateDir(dir), `inflight-${sidOf(sid)}.json`);
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// Redact first, then cut: a secret that straddles the cut must not leak its prefix.
const clean = (s, n, secrets) => cut(redact(String(s || ''), secrets || []), n);
let counter = 0;

// The text that says what the call is: the command (cut) with its description, the file path, or the agent type.
function whatOf(input, secrets) {
  const ti = input.tool_input || {};
  switch (input.tool_name) {
    case 'Bash': case 'PowerShell': return ti.description ? `${clean(ti.description, 80, secrets)} :: ${clean(ti.command, CMD_MAX, secrets)}` : clean(ti.command, CMD_MAX, secrets);
    case 'Write': case 'Edit': return redact(String(ti.file_path || ''), secrets || []).slice(0, PATH_MAX);
    case 'NotebookEdit': return redact(String(ti.notebook_path || ti.file_path || ''), secrets || []).slice(0, PATH_MAX);
    case 'Agent': return clean(ti.subagent_type || ti.description || 'agent', 120, secrets);
    default: return '';
  }
}

const mtimeOf = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// -> [{ tool, what, at, agent, id, f }] oldest first (f: the file it came from, '' for an old-style list).
function read(dir, sid) {
  const out = [];
  const d = dirOf(dir, sid);
  let names = [];
  try { names = fs.readdirSync(d).filter(n => /\.json$/.test(n)); } catch { /* none */ }
  for (const n of names) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(d, n), 'utf8'));
      if (e && typeof e === 'object' && !Array.isArray(e)) out.push(Object.assign({}, e, { f: n }));
    } catch { /* a damaged or half-removed file is skipped */ }
  }
  try {
    const lf = legacyFile(dir, sid);
    if (Date.now() - mtimeOf(lf) < OLD_MS && mtimeOf(lf)) {
      const l = JSON.parse(fs.readFileSync(lf, 'utf8'));
      if (Array.isArray(l)) for (const e of l) if (e && typeof e === 'object') out.push(Object.assign({}, e, { f: '' }));
    }
  } catch { /* damaged old file */ }
  return out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0)).slice(-MAX_ENTRIES);
}

// The newest sign of life this session left in its in-flight records: the folder's time moves whenever a file is added
// or removed; an old-style file counts by its own time.
function mtime(dir, sid) {
  return Math.max(mtimeOf(dirOf(dir, sid)), mtimeOf(legacyFile(dir, sid)));
}

// Every hook run of a session is a sign of life: touch its session file (a few microseconds; no write, no lock).
function pulse(dir, sid) {
  try { const now = new Date(); fs.utimesSync(path.join(state.stateDir(dir), `session-${sidOf(sid)}.json`), now, now); } catch { /* no session file yet */ }
}

function add(dir, input, secrets) {
  try {
    if (!TOOLS.has(input.tool_name) || !input.session_id) return;
    const name = input.tool_use_id ? `${String(input.tool_use_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'x'}.json` : `${Date.now()}-${process.pid}-${counter++}.json`;
    const e = { tool: input.tool_name, what: whatOf(input, secrets), at: Date.now(), agent: input.agent_id || null, id: input.tool_use_id || null };
    writeAtomic(path.join(dirOf(dir, input.session_id), name), `${JSON.stringify(e)}\n`, { sync: true });
  } catch { /* never break a tool call */ }
}

function unlink(dir, sid, f) { try { fs.unlinkSync(path.join(dirOf(dir, sid), f)); } catch { /* gone already */ } }

// By tool_use_id when the hook input has it, else the oldest entry with the same tool and text. No flush.
function remove(dir, input, secrets) {
  try {
    if (!TOOLS.has(input.tool_name) || !input.session_id) return;
    const sid = input.session_id;
    if (input.tool_use_id) {
      const f = `${String(input.tool_use_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'x'}.json`;
      try { fs.unlinkSync(path.join(dirOf(dir, sid), f)); return; } catch { /* not there: look by text */ }
    }
    const what = whatOf(input, secrets);
    const hit = read(dir, sid).find(e => e.f && e.tool === input.tool_name && e.what === what);
    if (hit) unlink(dir, sid, hit.f);
  } catch { /* fail open */ }
}

// A helper that has finished has nothing in flight.
function removeAgent(dir, sid, agentId) {
  try {
    if (!agentId) return;
    for (const e of read(dir, sid)) if (e.f && e.agent === agentId) unlink(dir, sid, e.f);
  } catch { /* fail open */ }
}

function clear(dir, sid) {
  try { fs.rmSync(dirOf(dir, sid), { recursive: true, force: true }); } catch { /* none */ }
  try { fs.unlinkSync(legacyFile(dir, sid)); } catch { /* none */ }
}

module.exports = { add, remove, removeAgent, clear, read, mtime, pulse, dirOf, whatOf, TOOLS, OLD_MS };
