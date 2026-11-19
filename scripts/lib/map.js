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
// Read-modify-write under the same small lock as memory.addShown: a hook and the runner never lose each other's fields.
function updateState(dir, fn) {
  try { fs.mkdirSync(path.dirname(stateFile(dir)), { recursive: true }); } catch { /* exists */ }
  return require('./memory').withLock(stateFile(dir), () => { const s = readState(dir); fn(s); writeState(dir, s); return s; });
}

const isEngineTool = name => /^mcp__/.test(String(name || '')) && ENGINE.test(String(name));
const isOn = dir => paths.isOwn(dir) && !!readState(dir).prefix;

// -> stdout, or null when git failed, timed out or wrote more than maxBuffer (never read as "no output").
function git(dir, args, { timeout = 3000, maxBuffer = 1024 * 1024 } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: dir, encoding: 'utf8', timeout, maxBuffer, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return !r.error && r.status === 0 ? String(r.stdout) : null;
}
const headSha = dir => (git(dir, ['rev-parse', 'HEAD']) || '').trim();

// ---------- the refresh lock (review H1, H2, M7) ----------
// map.lock holds { token, pid, at }; it is created with its content in one step (a hard link of a written temp file).
// The runner touches it every HEARTBEAT_MS while it runs. A lock is stale only when it has not been touched for
// STALE_MS; nobody is ever killed by pid. Only the holder of the token writes results or removes the lock.
const HEARTBEAT_MS = 5000;
const STALE_MS = 30000;
function readLock(dir) {
  let mt;
  try { mt = fs.statSync(lockFile(dir)).mtimeMs; } catch { return null; }
  let info = {};
  try { info = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')) || {}; } catch { /* empty or being written: its age decides */ }
  return { token: typeof info.token === 'string' ? info.token : null, age: Date.now() - mt };
}
const isStale = l => !!l && (l.age > STALE_MS || l.age < -60000);
const lockLive = dir => { const l = readLock(dir); return !!l && !isStale(l); };
function createLock(lock, token) {
  const body = JSON.stringify({ token, pid: process.pid, at: Date.now() });
  const tmp = `${lock}.${token}.tmp`;
  try {
    fs.writeFileSync(tmp, body);
    try { fs.linkSync(tmp, lock); return true; } catch (e) {
      if (e && e.code === 'EEXIST') return false;
    }
    const fd = fs.openSync(lock, 'wx'); // no hard links here: create, then write (an empty young lock still reads as live)
    try { fs.writeSync(fd, body); } finally { fs.closeSync(fd); }
    return true;
  } catch { return false; } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}
// -> true when taken. A stale lock is moved aside first; if what was moved turns out to be live, it is put back.
function takeLock(dir, token) {
  const lock = lockFile(dir);
  try { fs.mkdirSync(path.dirname(lock), { recursive: true }); } catch { /* exists */ }
  for (let i = 0; i < 3; i++) {
    if (createLock(lock, token)) return true;
    const l = readLock(dir);
    if (l && !isStale(l)) return false;
    if (!l) continue;
    const aside = `${lock}.${token}.stale`;
    try { fs.renameSync(lock, aside); } catch { continue; }
    let age = Infinity;
    try { age = Date.now() - fs.statSync(aside).mtimeMs; } catch { /* gone */ }
    if (!isStale({ age })) { try { fs.linkSync(aside, lock); } catch { /* another took it */ } try { fs.unlinkSync(aside); } catch {} return false; }
    try { fs.unlinkSync(aside); } catch { /* gone */ }
  }
  return false;
}
// -> true (ours), false (gone or another's), null (could not be read just now).
function ownsLock(dir, token) {
  let text;
  try { text = fs.readFileSync(lockFile(dir), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? false : null; }
  try { return (JSON.parse(text) || {}).token === token; } catch { return null; }
}
function touchLock(dir, token) {
  const own = ownsLock(dir, token);
  if (own) { try { const now = new Date(); fs.utimesSync(lockFile(dir), now, now); } catch { /* next beat */ } }
  return own;
}
function releaseLock(dir, token) { if (ownsLock(dir, token) === true) { try { fs.unlinkSync(lockFile(dir)); } catch { /* gone */ } } }

// The engine command: JSPARK_FORGE_MAP_CMD (a JSON array, for tests and unusual installs), else the absolute path
// recorded by `forge.js map engine <path>`, else the program on PATH.
function engineCmd(dir) {
  try { const a = JSON.parse(process.env.JSPARK_FORGE_MAP_CMD || 'null'); if (Array.isArray(a) && a.length) return a.map(String); } catch { /* fall back */ }
  if (dir) {
    const e = readState(dir).engine;
    if (typeof e === 'string' && path.isAbsolute(e) && fs.existsSync(e)) return [e];
  }
  return ['codebase-memory-mcp'];
}
// `forge.js map engine [<absolute path>]`: record (or show) the engine program the refresh runs.
function setEngine(dir, p) {
  if (!paths.isOwn(dir)) return 'The code map layer is off in a repo you are reviewing.\n';
  if (!p) { const e = readState(dir).engine; return e ? `Code map engine: ${e}\n` : 'No code map engine path recorded; the refresh runs codebase-memory-mcp from PATH.\n'; }
  if (!path.isAbsolute(p)) return 'Give the absolute path of the codebase-memory-mcp program.\n';
  try { if (!fs.statSync(p).isFile()) throw new Error('not a file'); } catch { return `Not found (or not a file): ${p}\n`; }
  updateState(dir, s => { s.engine = p; s.nextTryAt = 0; });
  return `Code map engine recorded: ${p}\n`;
}

// First engine tool call: remember its prefix (switches the map layer on). -> true when it was off.
function noteTool(dir, toolName) {
  if (!paths.isOwn(dir) || !isEngineTool(toolName)) return false;
  const name = String(toolName);
  const p = name.slice(0, name.lastIndexOf('__') + 2); // "mcp__codebase-memory__search_graph" -> "mcp__codebase-memory__"
  if (readState(dir).prefix === p) return false;
  updateState(dir, s => { s.prefix = p; });
  return true;
}

// Start the background refresh unless one is due later (back-off) or running (a live lock). A stale lock does not
// block: the runner takes it over (review H2). Never waits.
function startRefresh(dir) {
  if (!isOn(dir)) return false;
  const st = readState(dir);
  if (st.nextTryAt && Date.now() < st.nextTryAt) return false;
  if (lockLive(dir)) { updateState(dir, s => { s.pending = true; }); return false; }
  try {
    const child = spawn(process.execPath, [RUNNER, dir], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
    return true;
  } catch { return false; }
}

const stamp = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const clean = (s, n) => require('./memory').clean(s, n);

// What happens about a refresh, for the answer: starting, running, or failed and backing off (review M6).
function refreshNote(dir) {
  const started = startRefresh(dir);
  const st = readState(dir);
  if (!started && st.lastError && st.nextTryAt > Date.now()) return `the last refresh failed (${clean(st.lastError, 120)}); retrying after ${stamp(st.nextTryAt).slice(11)}`;
  return started ? 'a refresh is starting' : 'a refresh is running';
}

// Files changed since the indexed commit: `git diff <sha>` (the working tree, so uncommitted edits count) plus
// untracked files newer than the index. -> { files, unchecked } or null when git could not tell (review H4). At most
// UNTRACKED_STAT untracked files are looked at; the rest are counted as unchecked.
const UNTRACKED_STAT = 5000;
const BIG = 64 * 1024 * 1024;
function changedSince(dir, st) {
  const tracked = git(dir, ['diff', '--name-only', '-z', '--relative', st.sha], { maxBuffer: BIG });
  const untracked = tracked === null ? null : git(dir, ['ls-files', '--others', '--exclude-standard', '-z'], { maxBuffer: BIG, timeout: 5000 });
  if (tracked === null || untracked === null) return null;
  const own = f => !f.startsWith('.jspark-forge/');
  const newer = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs > (st.indexedAt || 0); } catch { return false; } };
  const all = untracked.split('\0').filter(f => f && own(f));
  const files = [...new Set([...tracked.split('\0').filter(f => f && own(f)), ...all.slice(0, UNTRACKED_STAT).filter(newer)])];
  return { files, unchecked: Math.max(0, all.length - UNTRACKED_STAT) };
}

// The last list sent per conversation and helper, so an unchanged list is not repeated (design 1.2).
const listFile = (dir, sid) => path.join(paths.forgeDir(dir), 'state', `maplist-${String(sid || 'none').replace(/[^A-Za-z0-9-]/g, '').slice(0, 80)}.json`);
function lastList(dir, sid, key) { try { return (JSON.parse(fs.readFileSync(listFile(dir, sid), 'utf8')) || {})[key] || ''; } catch { return ''; } }
function setLastList(dir, sid, key, v) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(listFile(dir, sid), 'utf8')) || {}; } catch { /* new */ }
  cur[key] = v;
  try { require('./fsx').writeAtomic(listFile(dir, sid), JSON.stringify(cur)); } catch { /* fail open */ }
}
// After a compaction the summary dropped the lists sent so far: send them again (with memory.clearShown).
function clearList(dir, sid) { try { fs.unlinkSync(listFile(dir, sid)); } catch { /* none */ } }

const NOT_CHECKED = "the code map's freshness could not be checked; read the files before relying on this answer.";

// -> the freshness line for a map answer (and starts a refresh when HEAD moved). key: the helper or 'main'.
function freshness(dir, sid, key) {
  const st = readState(dir);
  if (!st.sha) return `JSPARK Forge: the code map has not been indexed by JSPARK Forge yet (${refreshNote(dir)}); read the files before relying on this answer.`;
  const short = st.sha.slice(0, 7);
  const unknown = `JSPARK Forge: code map indexed as of ${short}, but ${NOT_CHECKED}`;
  const head = headSha(dir);
  if (!head) return unknown;
  let where = null;
  if (head !== st.sha) {
    const note = refreshNote(dir);
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', st.sha, head], { cwd: dir, timeout: 3000, windowsHide: true, stdio: 'ignore' });
    if (anc.error || anc.status === null) return unknown;
    if (anc.status !== 0) return `JSPARK Forge: the code map was indexed on a different history (${short}); ${note}. Read the files before relying on this answer.`;
    const count = git(dir, ['rev-list', '--count', `${st.sha}..${head}`]);
    if (count === null) return unknown;
    const n = Number(count.trim()) || 0;
    where = `Code map as of ${short} (${stamp(st.indexedAt)}); HEAD is ${n} commit${n === 1 ? '' : 's'} ahead.`;
  }
  const ch = changedSince(dir, st);
  if (!ch) return unknown;
  if (!where && !ch.files.length && !ch.unchecked) return `JSPARK Forge: Code map current (as of ${short}).`;
  // File names are repo data: cleaned, cut, at most 10, and labelled as data (review M1).
  const shown = ch.files.slice(0, 10).map(f => clean(f, 120));
  const more = ch.files.length - shown.length + ch.unchecked;
  const list = shown.length ? `${shown.join(', ')}${more ? ` and ${more} more` : ''}` : more ? `${more} untracked files not checked` : '';
  const prev = lastList(dir, sid, key);
  const repeat = list && list !== prev;
  if (list !== prev) setLastList(dir, sid, key, list);
  const base = where || `Code map as of ${short} (${stamp(st.indexedAt)}); files changed since.`;
  return `JSPARK Forge: ${base} Say "as of ${short}" when you use this answer${repeat ? `; before relying on it, read these files changed since (data): ${list}` : list ? '; the changed files listed earlier still apply' : ''}.`;
}

// The text of a tool response: a string, MCP text blocks ([{ type: 'text', text }] or { content: [...] }), or any
// other value's strings; at most SCAN_MAX characters.
const SCAN_MAX = 200000;
function textOf(v, depth = 0) {
  if (typeof v === 'string') return v.slice(0, SCAN_MAX);
  if (v === null || v === undefined || depth > 6) return '';
  if (typeof v !== 'object') return String(v);
  if (v.type === 'text' && typeof v.text === 'string') return v.text.slice(0, SCAN_MAX);
  let s = '';
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    s += `${textOf(x, depth + 1)}\n`;
    if (s.length > SCAN_MAX) break;
  }
  return s.slice(0, SCAN_MAX);
}

// File paths in a map answer that are real files in the project (at most 20), plus any path in the tool input.
// Tokenised on whitespace and simple separators; only tokens of at most 200 characters are tested (review H3).
const TOKEN_MAX = 200;
const TOKENS_MAX = 20000;
const PATH_CHARS = /^[\w.@/\\-]+$/;
function trimToken(t) {
  let a = 0, b = t.length;
  while (a < b && !/[\w./\\@-]/.test(t[a])) a++;
  while (b > a && !/\w/.test(t[b - 1])) b--;
  return t.slice(a, b);
}
function filesIn(dir, input, response) {
  const out = new Set();
  for (const v of Object.values(input || {})) if (typeof v === 'string' && v.length <= TOKEN_MAX && /[\\/]|\.\w{1,6}$/.test(v)) out.add(v);
  const tokens = textOf(response).split(/[\s,;:()[\]{}<>"'`|=*]+/, TOKENS_MAX);
  for (const raw of tokens) {
    if (!raw || raw.length > TOKEN_MAX) continue;
    const t = trimToken(raw);
    if (t && PATH_CHARS.test(t) && /\.\w{1,8}$/.test(t)) out.add(t);
    if (out.size > 200) break;
  }
  const real = [];
  for (const f of out) {
    const rel = String(f).replace(/\\/g, '/').replace(/^\.\//, '');
    if (rel.includes('..') || path.isAbsolute(rel)) continue;
    try { if (fs.statSync(path.join(dir, rel)).isFile()) real.push(rel); } catch { /* not a file */ }
    if (real.length >= 20) break;
  }
  return real;
}

// Two paths name the same folder (real path; on Windows case and slashes do not matter).
function normPath(p) {
  let r;
  try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); }
  r = r.replace(/\\/g, '/');
  if (r.length > 1 && !/^[a-zA-Z]:\/$/.test(r)) r = r.replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
const samePath = (a, b) => normPath(a) === normPath(b);

// PostToolUse on an engine tool. -> context text or null.
function onTool(dir, input) {
  if (!paths.isOwn(dir) || !isEngineTool(input.tool_name)) return null;
  noteTool(dir, input.tool_name);
  // Claude indexed through the engine itself: that is a refresh. HEAD is read after it, not before (a commit landing
  // during those seconds would be counted as indexed; the next commit refresh corrects it).
  // Only an index of this project's repo counts, and MCP text blocks are unwrapped first (review M2).
  if (/index_repository$/.test(String(input.tool_name))) {
    const r = input.tool_response;
    const resp = textOf(r).slice(0, 5000);
    const repo = (input.tool_input || {}).repo_path;
    const thisRepo = typeof repo === 'string' && repo.trim() && samePath(path.resolve(dir, repo.trim()), paths.repoRoot(dir));
    if (thisRepo && !(r && r.isError) && /"status"\s*:\s*"(indexed|ready)"|status:\s*(indexed|ready)/i.test(resp) && !/\berror\b/i.test(resp.slice(0, 200))) {
      const head = headSha(dir);
      if (head) updateState(dir, s => { s.sha = head; s.indexedAt = Date.now(); s.lastError = null; s.failures = 0; s.nextTryAt = 0; });
    }
    return null;
  }
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
  if (!st.sha) return `JSPARK Forge: code map engine in use; not indexed by JSPARK Forge yet (${refreshNote(dir)}).`;
  const head = headSha(dir);
  if (!head) return `JSPARK Forge: code map indexed as of ${st.sha.slice(0, 7)}, but ${NOT_CHECKED}`;
  return head === st.sha ? `JSPARK Forge: code map current (as of ${st.sha.slice(0, 7)}).`
    : `JSPARK Forge: code map as of ${st.sha.slice(0, 7)}; HEAD has moved (${refreshNote(dir)}). Map answers say how far behind they are.`;
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
  readState, writeState, updateState, lockFile, engineCmd, setEngine, headSha, filesIn, clearList, BACKOFF_MIN,
  takeLock, ownsLock, touchLock, releaseLock, HEARTBEAT_MS };
