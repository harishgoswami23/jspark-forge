'use strict';
// v0.5.1 crash recovery: what Claude was saying when a session was cut off, from the tail of its transcript.
// The transcript (hook input `transcript_path`) is JSON lines and its format is not documented. Shape this was written
// for (seen on a real transcript, structure only): `type: "assistant"` lines hold message.content, a list of blocks
// ({type:"text",text} | {type:"thinking"} | {type:"tool_use",id,name,input}), one block per line; `type: "user"` lines
// hold results as {type:"tool_result",tool_use_id}. Every other line type is ignored, helper (isSidechain) lines are
// ignored, and a line that does not parse (a cut last line, NUL bytes) is skipped. Only the last 256 KB are read.
// The path comes from a session file, and a cloned repo could ship one: a transcript is read only when its real path is
// inside the Claude home, and a UNC path (two leading slashes or backslashes) is refused before the disk is touched.
// Redaction runs on the whole text before any cut. Fails open: anything unexpected gives nothing.
const fs = require('fs');
const path = require('path');
const { redact } = require('./redact');
const paths = require('./paths');

const TAIL_BYTES = 256 * 1024;
const WORDS = 60;
const WORDS_MAX = 600; // characters, after the word cut
const TOOL_MAX = 300;
const NONE = () => ({ lastWords: null, lastTool: null });

// -> the real path of a transcript we may read, or null.
function allowed(file) {
  if (typeof file !== 'string' || !file || !/\.jsonl$/i.test(file)) return null;
  if (/^[\\/]{2}/.test(file)) return null; // \\server\share, //server/share, \\?\...: before touching the disk
  try {
    const root = fs.realpathSync.native(paths.claudeHome());
    const real = fs.realpathSync.native(file);
    const rel = path.relative(root, real);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? real : null;
  } catch { return null; }
}

function tailText(file) {
  let fd;
  try {
    const real = allowed(file);
    if (!real) return null;
    fd = fs.openSync(real, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size === 0) return null;
    const len = Math.min(st.size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, st.size - len);
    let text = buf.toString('utf8', 0, n);
    if (st.size > len) { const i = text.indexOf('\n'); text = i < 0 ? '' : text.slice(i + 1); } // the first line is cut
    return text;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// What a tool call is, in one short line, without its content: command (with description), path, agent type, pattern.
// Redacted first, then cut.
function describe(name, input, secrets) {
  const ti = input && typeof input === 'object' ? input : {};
  const clean = (x, n) => cut(redact(String(x || ''), secrets), n);
  let d = '';
  if (typeof ti.command === 'string') d = ti.description ? `${clean(ti.description, 80)} :: ${clean(ti.command, 200)}` : clean(ti.command, 200);
  else d = clean(ti.file_path || ti.notebook_path || ti.path || ti.subagent_type || ti.description || ti.pattern || ti.url || '', 200);
  return cut(d ? `${name}: ${d}` : String(name), TOOL_MAX);
}

// -> { lastWords: string|null, lastTool: string|null }. secrets: extra values to hide (the project's .env values).
function summary(file, secrets = []) {
  try {
    const text = tailText(file);
    if (!text) return NONE();
    let lastText = null, lastCall = null;
    const answered = new Set();
    for (const raw of text.split('\n')) {
      if (!raw || raw.charCodeAt(0) !== 123) continue; // only a JSON object line
      let o;
      try { o = JSON.parse(raw); } catch { continue; }
      if (!o || typeof o !== 'object' || o.isSidechain === true) continue;
      const m = o.message;
      if (!m || typeof m !== 'object' || !Array.isArray(m.content)) continue;
      if (o.type === 'assistant') {
        for (const c of m.content) {
          if (!c || typeof c !== 'object') continue;
          if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) lastText = c.text;
          else if (c.type === 'tool_use' && typeof c.name === 'string') lastCall = { id: c.id, name: c.name, input: c.input };
        }
      } else if (o.type === 'user') {
        for (const c of m.content) if (c && c.type === 'tool_result' && c.tool_use_id) answered.add(c.tool_use_id);
      }
    }
    let lastWords = null;
    if (lastText) {
      const w = redact(lastText, secrets).split(/\s+/).filter(Boolean); // redact the whole text, then cut
      let s = w.length > WORDS ? `…${w.slice(-WORDS).join(' ')}` : w.join(' ');
      if (s.length > WORDS_MAX) s = `…${s.slice(-(WORDS_MAX - 1))}`;
      lastWords = s;
    }
    const lastTool = lastCall && !(lastCall.id && answered.has(lastCall.id)) ? describe(lastCall.name, lastCall.input, secrets) : null;
    return { lastWords, lastTool };
  } catch { return NONE(); }
}

module.exports = { summary, TAIL_BYTES };
