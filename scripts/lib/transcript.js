'use strict';
// v0.5.1 crash recovery: what Claude was saying when a session was cut off, from the tail of its transcript.
// The transcript (hook input `transcript_path`) is JSON lines and its format is not documented. Shape this was written
// for (seen on a real transcript, structure only): `type: "assistant"` lines hold message.content, a list of blocks
// ({type:"text",text} | {type:"thinking"} | {type:"tool_use",id,name,input}), one block per line; `type: "user"` lines
// hold results as {type:"tool_result",tool_use_id}. Every other line type is ignored, helper (isSidechain) lines are
// ignored, and a line that does not parse (a cut last line, NUL bytes) is skipped. Only the last 256 KB are read.
// Fails open: anything unexpected gives nothing.
const fs = require('fs');
const { redact } = require('./redact');

const TAIL_BYTES = 256 * 1024;
const WORDS = 60;
const NONE = () => ({ lastWords: null, lastTool: null });

function tailText(file) {
  let fd;
  try {
    if (typeof file !== 'string' || !/\.jsonl$/i.test(file)) return null;
    fd = fs.openSync(file, 'r');
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
function describe(name, input) {
  const ti = input && typeof input === 'object' ? input : {};
  let d = '';
  if (typeof ti.command === 'string') d = ti.description ? `${cut(ti.description, 80)} :: ${cut(ti.command, 200)}` : cut(ti.command, 200);
  else d = cut(ti.file_path || ti.notebook_path || ti.path || ti.subagent_type || ti.description || ti.pattern || ti.url || '', 200);
  return d ? `${name}: ${d}` : String(name);
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
      const w = lastText.split(/\s+/).filter(Boolean);
      lastWords = redact(w.length > WORDS ? `…${w.slice(-WORDS).join(' ')}` : w.join(' '), secrets);
    }
    const lastTool = lastCall && !(lastCall.id && answered.has(lastCall.id)) ? redact(describe(lastCall.name, lastCall.input), secrets) : null;
    return { lastWords, lastTool };
  } catch { return NONE(); }
}

module.exports = { summary, TAIL_BYTES };
