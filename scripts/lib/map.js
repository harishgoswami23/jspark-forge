'use strict';
// v0.3 code map layer (design-v0.3 section 1). JSPARK Forge builds no index: Claude asks the engine (codebase-memory-
// mcp) directly. This module adds what the engine lacks: the commit its index is based on, a locked background refresh
// after commits and when HEAD moves, a freshness line on every map answer, and the decisions about the files in it.
// Own projects only (guest repos: off). Detected by use: the first engine tool call switches it on.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('./paths');

const ENGINE = /codebase-memory/i;
const QUERY_TOOLS = /(search_graph|trace_path|detect_changes|get_file_outline|get_architecture|get_code_snippet|search_code|query_graph)$/;
const BACKOFF_MIN = [1, 5, 30];
const RUNNER = path.join(__dirname, '..', 'map-refresh.js');
const INSTALL_PAGE = 'https://github.com/DeusData/codebase-memory-mcp';

const stateFile = dir => path.join(paths.forgeDir(dir), 'state', 'map.json');
const lockFile = dir => path.join(paths.forgeDir(dir), 'state', 'map.lock');
function readState(dir) { try { return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) || {}; } catch { return {}; } }
function writeState(dir, s) { try { require('./fsx').writeAtomic(stateFile(dir), `${JSON.stringify(s, null, 1)}\n`); } catch { /* fail open */ } }
function updateState(dir, fn) { const s = readState(dir); fn(s); writeState(dir, s); return s; }

const isEngineTool = name => /^mcp__/.test(String(name || '')) && ENGINE.test(String(name));
const isOn = dir => paths.isOwn(dir) && !!readState(dir).prefix;

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: dir, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? String(r.stdout) : null;
}
const headSha = dir => (git(dir, ['rev-parse', 'HEAD']) || '').trim();

// The engine command: JSPARK_FORGE_MAP_CMD (a JSON array, for tests and unusual installs) or the program on PATH.
function engineCmd() {
  try { const a = JSON.parse(process.env.JSPARK_FORGE_MAP_CMD || 'null'); if (Array.isArray(a) && a.length) return a.map(String); } catch { /* fall back */ }
  return ['codebase-memory-mcp'];
}

// First engine tool call: remember its prefix (switches the map layer on). -> true when it was off.
function noteTool(dir, toolName) {
  if (!paths.isOwn(dir) || !isEngineTool(toolName)) return false;
  const st = readState(dir);
  const name = String(toolName);
  const p = name.slice(0, name.lastIndexOf('__') + 2); // "mcp__codebase-memory__search_graph" -> "mcp__codebase-memory__"
  if (st.prefix === p) return false;
  st.prefix = p;
  writeState(dir, st);
  return true;
}

// Start the background refresh unless one is due later (back-off) or running. Never waits.
function startRefresh(dir) {
  if (!isOn(dir)) return false;
  const st = readState(dir);
  if (st.nextTryAt && Date.now() < st.nextTryAt) return false;
  if (fs.existsSync(lockFile(dir))) { updateState(dir, s => { s.pending = true; }); return false; }
  try {
    const child = spawn(process.execPath, [RUNNER, dir], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
    return true;
  } catch { return false; }
}

// Files changed in the working tree since the indexed commit (tracked) plus untracked files newer than the index.
function changedSince(dir, st) {
  const tracked = (git(dir, ['diff', '--name-only', '--relative', st.sha]) || '').split(/\r?\n/).filter(Boolean);
  const untracked = (git(dir, ['ls-files', '--others', '--exclude-standard']) || '').split(/\r?\n/).filter(Boolean)
    .filter(f => !f.startsWith('.jspark-forge/'))
    .filter(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs > (st.indexedAt || 0); } catch { return false; } });
  const modified = (git(dir, ['diff', '--name-only', '--relative']) || '').split(/\r?\n/).filter(Boolean)
    .filter(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs > (st.indexedAt || 0); } catch { return false; } });
  return [...new Set([...tracked, ...modified, ...untracked])].filter(f => !f.startsWith('.jspark-forge/'));
}

const stamp = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

// The last list sent per conversation and helper, so an unchanged list is not repeated (design 1.2).
const listFile = (dir, sid) => path.join(paths.forgeDir(dir), 'state', `maplist-${String(sid || 'none').replace(/[^A-Za-z0-9-]/g, '').slice(0, 80)}.json`);
function lastList(dir, sid, key) { try { return (JSON.parse(fs.readFileSync(listFile(dir, sid), 'utf8')) || {})[key] || ''; } catch { return ''; } }
function setLastList(dir, sid, key, v) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(listFile(dir, sid), 'utf8')) || {}; } catch { /* new */ }
  cur[key] = v;
  try { require('./fsx').writeAtomic(listFile(dir, sid), JSON.stringify(cur)); } catch { /* fail open */ }
}

// -> the freshness line for a map answer (and starts a refresh when HEAD moved). key: the helper or 'main'.
function freshness(dir, sid, key) {
  const st = readState(dir);
  const head = headSha(dir);
  if (!st.sha) { startRefresh(dir); return 'JSPARK Forge: the code map has not been indexed by JSPARK Forge yet (a refresh is starting); read the files before relying on this answer.'; }
  const short = st.sha.slice(0, 7);
  let files = [];
  let where;
  if (head && head !== st.sha) {
    startRefresh(dir);
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', st.sha, head], { cwd: dir, timeout: 3000, windowsHide: true, stdio: 'ignore' });
    if (anc.status !== 0) {
      return `JSPARK Forge: the code map was indexed on a different history (${short}); a refresh is running. Read the files before relying on this answer.`;
    }
    const n = Number((git(dir, ['rev-list', '--count', `${st.sha}..${head}`]) || '0').trim()) || 0;
    where = `Code map as of ${short} (${stamp(st.indexedAt)}); HEAD is ${n} commit${n === 1 ? '' : 's'} ahead.`;
  } else {
    where = null;
  }
  files = changedSince(dir, st).slice(0, 10);
  if (!where && !files.length) return `JSPARK Forge: Code map current (as of ${short}).`;
  const list = files.join(', ');
  const repeat = list && list !== lastList(dir, sid, key);
  if (list !== lastList(dir, sid, key)) setLastList(dir, sid, key, list);
  const base = where || `Code map as of ${short} (${stamp(st.indexedAt)}); files changed since.`;
  return `JSPARK Forge: ${base} Say "as of ${short}" when you use this answer${repeat ? `; read these changed files before relying on it: ${list}` : files.length ? '; the changed files listed earlier still apply' : ''}.`;
}

// File paths in a map answer that are real files in the project (at most 20), plus any path in the tool input.
function filesIn(dir, input, response) {
  const out = new Set();
  for (const v of Object.values(input || {})) if (typeof v === 'string' && /[\\/]|\.\w{1,6}$/.test(v)) out.add(v);
  const text = typeof response === 'string' ? response : JSON.stringify(response || '');
  for (const m of text.slice(0, 200000).matchAll(/[\w.@-]+(?:\/[\w.@-]+)+\.\w{1,8}|[\w.-]+\.\w{1,8}/g)) { out.add(m[0]); if (out.size > 200) break; }
  const real = [];
  for (const f of out) {
    const rel = String(f).replace(/\\/g, '/').replace(/^\.\//, '');
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    try { if (fs.statSync(path.join(dir, rel)).isFile()) real.push(rel); } catch { /* not a file */ }
    if (real.length >= 20) break;
  }
  return real;
}

// PostToolUse on an engine tool. -> context text or null.
function onTool(dir, input) {
  if (!paths.isOwn(dir) || !isEngineTool(input.tool_name)) return null;
  noteTool(dir, input.tool_name);
  if (!QUERY_TOOLS.test(String(input.tool_name))) return null;
  const key = input.agent_id || 'main';
  const parts = [freshness(dir, input.session_id, key)];
  try {
    const memory = require('./memory');
    const files = filesIn(dir, input.tool_input, input.tool_response);
    if (files.length) {
      const shownKey = `map:${key}`; // its own set: a map answer never uses up the note before an edit (review H5)
      const n = memory.notesFor(dir, dir, files, memory.readShown(dir, input.session_id)[shownKey] || [], { forMap: true });
      if (n) { parts.push(n.text); memory.addShown(dir, input.session_id, shownKey, n.ids); }
    }
  } catch { /* fail open */ }
  return parts.filter(Boolean).join('\n');
}

// Session start: one line when on (and a refresh when HEAD moved); the tip once when off.
function sessionLine(dir) {
  if (!isOn(dir)) return null;
  const st = readState(dir);
  const head = headSha(dir);
  if (!st.sha || (head && head !== st.sha)) startRefresh(dir);
  if (!st.sha) return 'JSPARK Forge: code map engine in use; its first JSPARK Forge refresh is starting.';
  return head === st.sha ? `JSPARK Forge: code map current (as of ${st.sha.slice(0, 7)}).`
    : `JSPARK Forge: code map as of ${st.sha.slice(0, 7)}; HEAD has moved (a refresh is starting). Map answers say how far behind they are.`;
}
function engineInstalled() {
  const home = require('./setup').claudeHome();
  const mention = f => { try { return /codebase-memory/i.test(fs.readFileSync(f, 'utf8')); } catch { return false; } };
  if (mention(path.join(home, 'plugins', 'installed_plugins.json'))) return true;
  return mention(path.join(require('os').homedir(), '.claude.json')); // a yes/no, nothing else is read or kept
}
function tip(dir) {
  if (!paths.isOwn(dir) || isOn(dir)) return null;
  const tipsFile = path.join(paths.forgeDir(dir), 'state', 'tips.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(tipsFile, 'utf8')) || {}; } catch { /* none */ }
  if (st.mapEngine) return null;
  const code = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile', 'composer.json', 'src'].some(f => fs.existsSync(path.join(dir, f)));
  if (!code) return null;
  st.mapEngine = true;
  try { fs.mkdirSync(path.dirname(tipsFile), { recursive: true }); fs.writeFileSync(tipsFile, `${JSON.stringify(st, null, 1)}\n`); } catch { return null; }
  if (engineInstalled()) return null;
  return `JSPARK Forge tip (once): for "where is X" and "what breaks if I change this" answers from a code map, add codebase-memory-mcp (${INSTALL_PAGE}). JSPARK Forge then keeps it tied to your commits. It installs nothing itself.`;
}

// `forge.js map status` and /check lines.
function status(dir) {
  if (!paths.isOwn(dir)) return 'The code map layer is off in a repo you are reviewing.\n';
  const st = readState(dir);
  if (!st.prefix) return 'No code map engine seen yet in this project. It switches on the first time Claude uses codebase-memory-mcp.\n';
  const L = [];
  const head = headSha(dir);
  if (!st.sha) L.push('Code map: not indexed by JSPARK Forge yet.');
  else if (head === st.sha) L.push(`Code map current (as of ${st.sha.slice(0, 7)}, ${stamp(st.indexedAt)}).`);
  else {
    const n = Number((git(dir, ['rev-list', '--count', `${st.sha}..${head}`]) || '').trim());
    L.push(Number.isFinite(n) && n > 0 ? `Code map ${n} commit${n === 1 ? '' : 's'} behind (as of ${st.sha.slice(0, 7)}).` : `Code map indexed on a different history (${st.sha.slice(0, 7)}).`);
  }
  if (st.lastError) L.push(`Last refresh failed: ${String(st.lastError).slice(0, 200)}${st.nextTryAt > Date.now() ? ` (next try after ${stamp(st.nextTryAt)})` : ''}.`);
  return `${L.join('\n')}\n`;
}
function checkLines(dir) {
  if (!isOn(dir)) return [];
  const st = readState(dir);
  const head = headSha(dir);
  const out = [];
  if (st.sha && head && head !== st.sha) out.push(`the code map is behind HEAD (as of ${st.sha.slice(0, 7)}): refresh now? (forge.js map refresh)`);
  if (st.lastError) out.push(`the last code map refresh failed (${String(st.lastError).slice(0, 120)}): refresh now? (forge.js map refresh)`);
  return out;
}

module.exports = { isEngineTool, isOn, noteTool, startRefresh, freshness, onTool, sessionLine, tip, status, checkLines,
  readState, writeState, updateState, lockFile, engineCmd, headSha, BACKOFF_MIN };
