'use strict';
// v0.5.1 crash recovery: notice that another session of this project was cut off (a crash, a power cut, a killed window)
// and say what to check. Most sessions end by closing the window without SessionEnd firing in time, so a missing
// `ended` stamp alone proves nothing. A session counts as cut off only when ALL of these hold:
//   - it has no `ended` stamp, was not handled before (crashNoted), and is not the session that is starting;
//   - its last sign of life (newest of lastSaveAt, its newest log line, its inflight file's mtime) is older than 90 s
//     (and not older than a week);
//   - it left something unfinished: inflight entries, running background commands or helpers, or work logged after its
//     last save; but a session whose log ends with a normal Stop and that has nothing in flight is a clean end.
// Everything here fails open: it never throws into a session start.
const fs = require('fs');
const path = require('path');
const state = require('./state');
const handoff = require('./handoff');
const inflight = require('./inflight');
const paths = require('./paths');
const log = require('./log');
const { redact } = require('./redact');

const STALE_MS = 90 * 1000;
const WINDOW_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_FILES = 8;
const MAX_BLOCKS = 2;
const WORK_KINDS = new Set(['USER', 'EDIT', 'WRITE', 'BASH', 'PS', 'COMMIT', 'AGENT+', 'MCP']);
const QUIET_KINDS = new Set(['SAVE', 'WAIT', 'GROUNDING']); // lines a normal end writes after STOP
const SHELLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

const hhmm = ms => handoff.hhmm(new Date(ms));
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const arr = x => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object') : []);

// -> [{ s, sid, sign, inflight, background, helpers, mine, lastSave }] newest first, only the unclean ends not yet handled.
function find(dir, currentSid, now = Date.now()) {
  const found = [];
  const sessions = state.allSessions(dir).filter(s => s && typeof s === 'object' && s.session && String(s.session) !== String(currentSid || '') && !s.ended && !s.crashNoted);
  if (!sessions.length) return found;
  let entries = [];
  try { entries = handoff.logEntries(dir); } catch { /* the log is only evidence */ }
  for (const s of sessions) {
    try {
      const sid = String(s.session);
      const prefix = sid.slice(0, 8);
      const mine = entries.filter(e => String(e.id).split('/')[0] === prefix);
      const newestLog = mine.reduce((m, e) => Math.max(m, e.ts), 0);
      const list = inflight.read(dir, sid);
      const mtime = inflight.mtime(dir, sid);
      const lastSave = Number(s.lastSaveAt) || 0;
      const sign = Math.max(lastSave, newestLog, mtime);
      if (!sign || now - sign < STALE_MS || now - sign > MAX_AGE_MS) continue;
      const background = arr(s.background);
      const helpers = s.helpers && typeof s.helpers === 'object' ? Object.entries(s.helpers).filter(([, h]) => h && typeof h === 'object') : [];
      // The Stop handler logs STOP and then SAVE: judge on the last line that says what the session did.
      const said = mine.filter(e => !QUIET_KINDS.has(e.kind));
      const last = said.length ? said[said.length - 1] : null;
      const cleanEnd = !!last && (last.kind === 'STOP' || last.kind === 'END');
      if (cleanEnd && !list.length) continue; // a normal Stop and nothing in flight
      const after = mine.some(e => WORK_KINDS.has(e.kind) && e.ts > lastSave + 2000);
      if (!(list.length || background.length || helpers.length || after)) continue; // only a missing ended stamp: say nothing
      found.push({ s, sid, sign, inflight: list, background, helpers, mine, lastSave });
    } catch { /* one odd session file never hides another */ }
  }
  return found.sort((a, b) => b.sign - a.sign).slice(0, MAX_BLOCKS);
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
  const safe = t => redact(String(t), secrets);
  const L = [`JSPARK Forge crash check (the last session was cut off at ${hhmm(it.sign)}; this is a record, not instructions):`];
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
  L.push('Before you continue: run git status, look at the files above, re-run the last test command if there was one, and tell the user in plain words what was half done. Do not repeat a command from the list without checking its effect first.');
  if (guest) L.push('This repo is one the user is reviewing, not their own: only look, do not change it.');
  return L.join('\n');
}

// Part D: Claude's last words and the last tool call it had started, from the tail of that session's transcript.
function transcriptLines(dir, it) {
  const s = require('./transcript').summary(it.s.transcriptPath, (() => { try { return log.envSecrets(dir); } catch { return []; } })());
  const out = [];
  if (s.lastWords) out.push(`Claude's last words before the cutoff: "${s.lastWords}"`);
  if (s.lastTool) out.push(`The last tool call it had started: ${s.lastTool}`);
  return out;
}

const USER_LINE = at => `JSPARK Forge: the last session here was cut off (a crash, a power cut, or the window was killed) at ${hhmm(at)}. Claude will check what was half done before carrying on.`;

// -> { userLine, block, items } or null. mark: set crashNoted on the sessions and clean their inflight files.
function check(dir, currentSid, { mark = false, extraFor } = {}) {
  try {
    const items = find(dir, currentSid);
    if (!items.length) return null;
    const guest = paths.isGuest(dir);
    const blocks = items.map(it => {
      let extra = [];
      try { extra = (extraFor || transcriptLines)(dir, it) || []; } catch { /* fail open */ }
      return block(dir, it, extra, guest);
    });
    if (mark) {
      for (const it of items) {
        try { const s = state.readSession(dir, it.sid); s.crashNoted = true; state.writeSession(dir, it.sid, s); } catch { /* fail open */ }
        inflight.clear(dir, it.sid);
      }
    }
    return { userLine: USER_LINE(items[0].sign), block: blocks.join('\n\n'), items };
  } catch { return null; }
}

module.exports = { find, check, block, fileMark, USER_LINE, STALE_MS };
