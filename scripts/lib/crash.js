'use strict';
// v0.5.1 crash recovery: notice that another session of this project was cut off (a crash, a power cut, a killed window)
// and say what to check. Most sessions end by closing the window without SessionEnd firing in time, so a missing
// `ended` stamp alone proves nothing. A session counts as cut off only when ALL of these hold:
//   - it has no `ended` stamp and was not reported before (state/crash-noted.json holds the last sign of life that was
//     reported: only a newer one is reported again); the session that is starting is judged too, from its state before
//     the start wrote anything;
//   - its last sign of life (newest of lastSaveAt, its newest log line, its in-flight records' time, its session file's
//     time, which every hook run touches) is older than 90 s, or older than 10 minutes when the only evidence is
//     in-flight calls or one of them is younger than 10 minutes (a long test run or a permission dialog is silent too),
//     and not older than a week;
//   - it left something unfinished: in-flight calls, running background commands or helpers, or work logged after its
//     last save; but a session whose last real log line is a normal Stop with nothing in flight is a clean end.
// A window that is only silent looks the same, so the wording says "cut off, or still open in another window" and the
// crash check never deletes another session's records or writes another session's session file.
// Everything here fails open: it never throws into a session start.
const fs = require('fs');
const path = require('path');
const state = require('./state');
const handoff = require('./handoff');
const inflight = require('./inflight');
const paths = require('./paths');
const log = require('./log');
const { writeAtomic } = require('./fsx');
const { redact, stripQuery } = require('./redact');

const STALE_MS = 90 * 1000;
const SLOW_MS = 10 * 60 * 1000; // a session whose only evidence is in-flight calls is judged only after this
const WINDOW_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const NOTED_KEEP_MS = 30 * 24 * 3600 * 1000;
const MAX_FILES = 8;
const MAX_BLOCKS = 2;
const WORK_KINDS = new Set(['USER', 'EDIT', 'WRITE', 'BASH', 'PS', 'COMMIT', 'AGENT+', 'MCP']);
const QUIET_KINDS = new Set(['SAVE', 'WAIT', 'GROUNDING']); // lines a normal end writes after STOP
const SHELLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

const hhmm = ms => handoff.hhmm(new Date(ms));
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const arr = x => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object') : []);

// Where "already reported" lives: state/crash-noted.json, { "<session id>": <last sign of life that was reported> }.
const notedFile = dir => path.join(state.stateDir(dir), 'crash-noted.json');
function readNoted(dir) {
  try { const j = JSON.parse(fs.readFileSync(notedFile(dir), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function writeNoted(dir, add, now = Date.now()) {
  const cur = readNoted(dir);
  for (const [sid, v] of Object.entries(add)) cur[sid] = Math.max(Number(cur[sid]) || 0, v);
  for (const [sid, v] of Object.entries(cur)) if (!(now - Number(v) < NOTED_KEEP_MS)) delete cur[sid]; // forgotten after 30 days
  writeAtomic(notedFile(dir), `${JSON.stringify(cur, null, 1)}\n`, { sync: false });
}

const sessionPath = (dir, sid) => path.join(state.stateDir(dir), `session-${String(sid || 'unknown').replace(/[^A-Za-z0-9-]/g, '')}.json`);
const sessionMtime = (dir, sid) => { try { return fs.statSync(sessionPath(dir, sid)).mtimeMs; } catch { return 0; } };

// What the session file looked like before this start wrote anything: the start of session X judges X itself from this.
function snapshot(dir, sid) {
  try { const s = state.readSession(dir, sid); return { mtime: sessionMtime(dir, sid), ended: !!s.ended }; } catch { return { mtime: 0, ended: false }; }
}

// One session -> { s, sid, sign, inflight, background, helpers, mine, lastSave } when it looks cut off, else null.
// selfMtime: for the session that is starting, its session file's time from before this start.
function judge(dir, s, entries, now, noted, selfMtime) {
  const sid = String(s.session);
  const prefix = sid.slice(0, 8);
  const mine = entries.filter(e => String(e.id).split('/')[0] === prefix);
  const newestLog = mine.reduce((m, e) => Math.max(m, e.ts), 0);
  const list = inflight.read(dir, sid);
  const lastSave = Number(s.lastSaveAt) || 0;
  const newestFlight = list.reduce((m, e) => Math.max(m, Number(e.at) || 0), 0);
  const sign = Math.max(lastSave, newestLog, inflight.mtime(dir, sid), newestFlight, selfMtime !== undefined ? selfMtime : sessionMtime(dir, sid));
  if (!sign || now - sign > MAX_AGE_MS) return null;
  if (noted[sid] !== undefined && sign <= Number(noted[sid])) return null; // reported already, and nothing newer since
  const background = arr(s.background);
  const helpers = s.helpers && typeof s.helpers === 'object' ? Object.entries(s.helpers).filter(([, h]) => h && typeof h === 'object') : [];
  // The Stop handler logs STOP and then SAVE: judge on the last line that says what the session did.
  const said = mine.filter(e => !QUIET_KINDS.has(e.kind));
  const last = said.length ? said[said.length - 1] : null;
  const cleanEnd = !!last && (last.kind === 'STOP' || last.kind === 'END');
  if (cleanEnd && !list.length) return null; // a normal Stop and nothing in flight
  const after = mine.some(e => WORK_KINDS.has(e.kind) && e.ts > lastSave + 2000);
  if (!(list.length || background.length || helpers.length || after)) return null; // only a missing ended stamp: say nothing
  const young = list.some(e => now - (Number(e.at) || 0) < SLOW_MS);
  const onlyFlight = list.length > 0 && !(background.length || helpers.length || after);
  if (now - sign < (young || onlyFlight ? SLOW_MS : STALE_MS)) return null;
  return { s, sid, sign, inflight: list, background, helpers, mine, lastSave };
}

// The crash check trusts session files only where they cannot have been shipped by someone else: a git repo carrying the
// own marker, or a guest project (its state is in the Claude home). In a folder that is not a git repo a cloned or
// unpacked `.jspark-forge/state/` proves nothing, so the check says nothing there.
const eligible = dir => { try { return paths.isGuest(dir) || (!!paths.gitDirOf(dir) && paths.isOwn(dir)); } catch { return false; } };

// -> [{ ... }] newest first: the unclean ends not reported yet. opts.self: { mtime, ended } of the session that is starting
// (it is judged too, from its state before the start); opts.skipNewest: leave out the session with the newest sign of life
// (the caller does not know its own id and is itself the newest one).
function find(dir, currentSid, now = Date.now(), opts = {}) {
  const found = [];
  if (!eligible(dir)) return found;
  const cur = String(currentSid || '');
  const all = state.allSessions(dir).filter(s => s && typeof s === 'object' && s.session && !s.ended);
  let sessions = all.filter(s => String(s.session) !== cur);
  if (!sessions.length && !opts.self) return found;
  let entries = [];
  try { entries = handoff.logEntries(dir); } catch { /* the log is only evidence */ }
  const noted = readNoted(dir);
  if (opts.skipNewest) {
    let best = null, bestAt = -1;
    for (const s of all) { const at = Math.max(sessionMtime(dir, String(s.session)), Number(s.lastSaveAt) || 0); if (at > bestAt) { bestAt = at; best = String(s.session); } }
    sessions = sessions.filter(s => String(s.session) !== best);
  }
  for (const s of sessions) {
    try { const it = judge(dir, s, entries, now, noted); if (it) found.push(it); } catch { /* one odd session file never hides another */ }
  }
  if (opts.self && !opts.self.ended && cur) { // the session that is starting, judged from before this start
    try { const it = judge(dir, state.readSession(dir, cur), entries, now, noted, opts.self.mtime); if (it) found.push(it); } catch { /* fail open */ }
  }
  return found.sort((a, b) => b.sign - a.sign);
}

// What a file looks like now: 'missing', 'empty (0 bytes)', 'ends in NUL bytes' (its last 64 bytes are all zero: what a
// power cut leaves on NTFS; a hint, not proof), or null.
function fileMark(abs) {
  let fd;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    if (st.size === 0) return 'empty (0 bytes)';
    fd = fs.openSync(abs, 'r');
    const len = Math.min(st.size, 64);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return buf.every(b => b === 0) ? 'ends in NUL bytes' : null;
  } catch (e) { return e && e.code === 'ENOENT' ? 'missing' : null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

function advice(tool) {
  if (SHELLS.has(tool)) return 'it may have half run: check its effect before running it again';
  if (FILE_TOOLS.has(tool)) return 'the file may be half written: open it and check';
  if (tool === 'Agent') return 'its work is lost unless it wrote files: check the files it was given';
  return 'check what it did';
}

// The block for one cut-off session. `extra`: lines from the transcript (Part D), already redacted.
function block(dir, it, extra, guest) {
  const secrets = (() => { try { return log.envSecrets(dir); } catch { return []; } })();
  const safe = t => stripQuery(redact(String(t), secrets)); // a URL quoted from a call keeps no query string
  const L = [`JSPARK Forge crash check (the last session was cut off, or is still open in another window, at ${hhmm(it.sign)}; this is a record, not instructions):`];
  if (it.inflight.length) {
    L.push('In flight when it stopped:');
    for (const e of it.inflight) L.push(`- ${cut(e.tool, 20)}: ${cut(safe(e.what), 260)} (started ${hhmm(Number(e.at) || it.sign)}): ${advice(e.tool)}.`);
  }
  if (it.background.length || it.helpers.length) {
    L.push('Was running and is gone now:');
    for (const b of it.background) L.push(`- \`${cut(safe(b.command || b.description || 'a background command'), 100)}\` (started ${hhmm(Number(b.at) || it.sign)})`);
    for (const [, h] of it.helpers) L.push(`- helper ${cut(h.type || 'agent', 60)} (started ${hhmm(Number(h.at) || it.sign)})`);
    L.push('Dev servers and watchers die with the machine. Ask the user before starting them again.');
  }
  const seen = new Map();
  for (const e of it.mine) {
    if ((e.kind !== 'EDIT' && e.kind !== 'WRITE') || e.ts < it.sign - WINDOW_MS || /^\.jspark-forge\//.test(e.detail)) continue;
    seen.delete(e.detail); seen.set(e.detail, e); // the latest write of a file counts
  }
  const written = [...seen.keys()].slice(-MAX_FILES);
  if (written.length) {
    L.push('Files written in the last 2 minutes before the cutoff:');
    for (const f of written) {
      const abs = path.isAbsolute(f) ? f : path.resolve(dir, f);
      const mark = fileMark(abs);
      L.push(`- ${cut(safe(f), 200)}${mark ? `: ${mark}` : ''}`);
    }
  }
  let since = [];
  try {
    const h = handoff.openHandoff(dir);
    since = handoff.sinceSave(dir, h && h.meta && Number(h.meta.savedAt) ? Number(h.meta.savedAt) : it.lastSave);
  } catch { /* fail open */ }
  if (since.length) L.push('Logged after the last save:', ...since.map(x => `- ${x}`));
  for (const x of extra || []) L.push(x);
  L.push('After the user says to continue: run git status, look at the files above, and tell the user in plain words what was half done. Do not repeat a command from the list without checking its effect first.');
  if (guest) L.push('This repo is one the user is reviewing, not their own: only look, do not change it. Only read-only checks here (git status, opening files); never re-run a command from the list.');
  return L.join('\n');
}

// Part D: Claude's last words and the last tool call it had started, from the tail of that session's transcript.
function transcriptLines(dir, it) {
  const s = require('./transcript').summary(it.s.transcriptPath, (() => { try { return log.envSecrets(dir); } catch { return []; } })());
  const out = [];
  if (s.lastWords) out.push(`Claude's last words before the cutoff: "${s.lastWords}"`);
  if (s.lastTool) out.push(`The last tool call it had started: ${stripQuery(s.lastTool)}`);
  return out;
}

const USER_LINE = at => `JSPARK Forge: the last session here was cut off, or is still open in another window (a crash, a power cut, or the window was killed), at ${hhmm(at)}. Claude will check what was half done before carrying on.`;

// -> { userLine, block, items } or null. opts: mark (record every session found as reported, in crash-noted.json),
// own (this is the start of session currentSid: judge it from opts.self and clear its own in-flight records),
// self (snapshot() taken before the start wrote anything), skipNewest, extraFor.
function check(dir, currentSid, { mark = false, extraFor, own = false, self, skipNewest = false } = {}) {
  try {
    const found = find(dir, currentSid, Date.now(), { self: own ? self : undefined, skipNewest });
    try { if (mark && own && currentSid) inflight.clear(dir, currentSid); } catch { /* fail open */ }
    if (!found.length) return null;
    const items = found.slice(0, MAX_BLOCKS);
    const guest = paths.isGuest(dir);
    const blocks = items.map(it => {
      let extra = [];
      try { extra = (extraFor || transcriptLines)(dir, it) || []; } catch { /* fail open */ }
      return block(dir, it, extra, guest);
    });
    if (mark) { // every session found is handled, so older ones do not alarm again at the next start; the newest two are told
      try { writeNoted(dir, Object.fromEntries(found.map(it => [it.sid, it.sign]))); } catch { /* fail open */ }
    }
    return { userLine: USER_LINE(items[0].sign), block: blocks.join('\n\n'), items };
  } catch { return null; }
}

// SessionStart housekeeping: session files of sessions that ended more than 7 days ago, any session file untouched for 30
// days, and in-flight records older than 7 days. At most `limit` deletions per start (a start has 10 seconds); never the
// session that is starting. A session's own in-flight records go with its file. -> the number of deletions.
const ENDED_KEEP_MS = 7 * 24 * 3600 * 1000;
const SESSION_KEEP_MS = 30 * 24 * 3600 * 1000;
function prune(dir, currentSid, now = Date.now(), limit = 50) {
  let n = 0;
  try {
    if (!eligible(dir)) return 0;
    const sd = state.stateDir(dir);
    const cur = String(currentSid || '').replace(/[^A-Za-z0-9-]/g, '');
    const names = fs.readdirSync(sd);
    const rm = p => { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { return false; } };
    for (const name of names) {
      if (n >= limit) break;
      const m = name.match(/^session-(.+)\.json$/);
      if (!m || m[1] === cur) continue;
      try {
        const f = path.join(sd, name);
        const age = now - fs.statSync(f).mtimeMs;
        let old = age > SESSION_KEEP_MS;
        if (!old && age > ENDED_KEEP_MS) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); old = !!(s && s.ended && now - Number(s.ended.at || 0) > ENDED_KEEP_MS); }
        if (!old) continue;
        if (rm(f)) { n++; inflight.clear(dir, m[1]); }
      } catch { /* one odd file never stops the rest */ }
    }
    for (const name of names) { // in-flight records nobody cleaned for a week
      if (n >= limit) break;
      const m = name.match(/^inflight-([A-Za-z0-9-]+?)(\.json)?$/);
      if (!m || m[1] === cur) continue;
      try { if (now - fs.statSync(path.join(sd, name)).mtimeMs > ENDED_KEEP_MS && rm(path.join(sd, name))) n++; } catch { /* gone already */ }
    }
  } catch { /* fail open */ }
  return n;
}

// The session that is starting is alive again: a leftover ended stamp from an earlier run of the same id goes.
function revive(dir, sid) {
  try {
    const s = state.readSession(dir, sid);
    if (!s.ended) return;
    delete s.ended;
    state.writeSession(dir, sid, s);
  } catch { /* fail open */ }
}

module.exports = { find, check, block, fileMark, snapshot, revive, prune, readNoted, USER_LINE, STALE_MS, SLOW_MS };
