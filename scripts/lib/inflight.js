'use strict';
// v0.5.1 crash recovery: what a session had started and not yet finished (state/inflight-<session>.json, a list).
// PreToolUse adds an entry for an allowed call that can change things; PostToolUse and PostToolUseFailure remove it;
// Stop removes the file. After a crash, what is left is what was in flight. PreToolUse has a 3 second limit and runs
// on every call, so this is one small atomic write without fsync, and nothing here ever throws.
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');
const { redact } = require('./redact');
const state = require('./state');

const TOOLS = new Set(['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit', 'Agent']);
const CMD_MAX = 200;
const MAX_ENTRIES = 30;

const fileOf = (dir, sid) => path.join(state.stateDir(dir), `inflight-${String(sid || 'unknown').replace(/[^A-Za-z0-9-]/g, '')}.json`);
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// The text that says what the call is: the command (cut) with its description, the file path, or the agent type.
function whatOf(input, secrets) {
  const ti = input.tool_input || {};
  let w = '';
  switch (input.tool_name) {
    case 'Bash': case 'PowerShell': w = ti.description ? `${cut(ti.description, 80)} :: ${cut(ti.command, CMD_MAX)}` : cut(ti.command, CMD_MAX); break;
    case 'Write': case 'Edit': w = String(ti.file_path || ''); break;
    case 'NotebookEdit': w = String(ti.notebook_path || ti.file_path || ''); break;
    case 'Agent': w = String(ti.subagent_type || ti.description || 'agent'); break;
    default: w = '';
  }
  return redact(w, secrets || []);
}

function read(dir, sid) {
  try { const l = JSON.parse(fs.readFileSync(fileOf(dir, sid), 'utf8')); return Array.isArray(l) ? l.filter(e => e && typeof e === 'object') : []; } catch { return []; }
}
const save = (dir, sid, list) => writeAtomic(fileOf(dir, sid), `${JSON.stringify(list)}\n`, { sync: false });

function add(dir, input, secrets) {
  try {
    if (!TOOLS.has(input.tool_name) || !input.session_id) return;
    const list = read(dir, input.session_id);
    list.push({ tool: input.tool_name, what: whatOf(input, secrets), at: Date.now(), agent: input.agent_id || null, id: input.tool_use_id || null });
    save(dir, input.session_id, list.slice(-MAX_ENTRIES));
  } catch { /* never break a tool call */ }
}

// By tool_use_id when the hook input has it, else the oldest entry with the same tool and text.
function remove(dir, input, secrets) {
  try {
    if (!TOOLS.has(input.tool_name) || !input.session_id || !fs.existsSync(fileOf(dir, input.session_id))) return;
    const list = read(dir, input.session_id);
    let i = input.tool_use_id ? list.findIndex(e => e.id === input.tool_use_id) : -1;
    if (i < 0) { const what = whatOf(input, secrets); i = list.findIndex(e => e.tool === input.tool_name && e.what === what); }
    if (i < 0) return;
    list.splice(i, 1);
    if (list.length) save(dir, input.session_id, list); else clear(dir, input.session_id);
  } catch { /* fail open */ }
}

// A helper that has finished has nothing in flight.
function removeAgent(dir, sid, agentId) {
  try {
    if (!agentId || !fs.existsSync(fileOf(dir, sid))) return;
    const list = read(dir, sid), keep = list.filter(e => e.agent !== agentId);
    if (keep.length === list.length) return;
    if (keep.length) save(dir, sid, keep); else clear(dir, sid);
  } catch { /* fail open */ }
}

function clear(dir, sid) { try { fs.unlinkSync(fileOf(dir, sid)); } catch { /* none */ } }

module.exports = { add, remove, removeAgent, clear, read, fileOf, whatOf, TOOLS };
