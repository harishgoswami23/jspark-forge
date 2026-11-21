'use strict';
// v0.6 token care, step 1: measure. Where one session's tokens went, from its transcript: the main conversation, the
// helpers, what JSPARK Forge's own hooks added, the biggest tool outputs, and what would save most.
// The transcript format is not documented (see transcript.js); this reads only what it needs and skips the rest:
//   assistant lines: message.id, message.model, message.usage (one API call can be several lines: counted once by id),
//                    message.content tool_use blocks (id -> tool name);
//   user lines: tool_result blocks (their size: text by length, an image as a fixed small amount);
//   attachment lines of type hook_additional_context: the text a hook added.
// Helper transcripts sit beside it: <transcript without .jsonl>/subagents/<name>.jsonl with <name>.meta.json
// ({ agentType }). Read-only; every file only from inside the Claude home (transcript.allowed); every name that comes
// from a transcript (model, tool, helper kind) is reduced to plain characters before it is printed, because Claude
// reads this output; fails open with a plain line.
const fs = require('fs');
const path = require('path');
const { allowed } = require('./transcript');

const MAX_BYTES = 100 * 1024 * 1024; // a transcript larger than this is not read (reading takes about 3x its size in memory)
const META_MAX = 64 * 1024;
const CHARS_PER_TOKEN = 4; // a rough rule for text that is not counted by the API
const IMAGE_CHARS = 6000; // an image in a tool result: about 1.5k tokens, whatever its size as base64
const LONG_CONTEXT = 150000; // tokens re-read per step above which a new session pays off
const BIG_RESULT = 10000; // tokens: one tool output this large is worth pointing out
const MANY_STEPS = 40; // helper steps per helper above which smaller jobs pay off
const FRESH_START = 30000; // tokens a new session re-reads at first (system text, tools, the handoff)

const k = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const plain = (s, n) => String(typeof s === 'string' ? s : '').replace(/[^\w:.-]/g, '').slice(0, n) || '?';

// -> the parsed lines, 'big' (over the cap) or null (cannot be read).
function entries(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return 'big';
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.charCodeAt(0) !== 123) continue; // not "{"
      try { const e = JSON.parse(line); if (e && typeof e === 'object') out.push(e); } catch { /* a cut or damaged line */ }
    }
    return out;
  } catch { return null; }
}

// -> { calls, input, cacheWrite, cacheRead, output, models: { name: calls }, last } (last: what the newest call read)
function usageOf(es) {
  const seen = new Map();
  for (const e of es) {
    const m = e.type === 'assistant' && e.message;
    if (!m || !m.usage || typeof m.usage !== 'object') continue;
    seen.set(m.id || e.uuid || seen.size, m);
  }
  const t = { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, models: Object.create(null), last: 0 };
  const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
  for (const m of seen.values()) {
    const read = num(m.usage.input_tokens) + num(m.usage.cache_creation_input_tokens) + num(m.usage.cache_read_input_tokens);
    t.calls++;
    t.input += num(m.usage.input_tokens); t.cacheWrite += num(m.usage.cache_creation_input_tokens);
    t.cacheRead += num(m.usage.cache_read_input_tokens); t.output += num(m.usage.output_tokens);
    if (read > 0) t.last = read;
    const name = plain(m.model, 60);
    t.models[name] = (t.models[name] || 0) + 1;
  }
  return t;
}
const reread = t => (t.calls ? (t.cacheRead + t.cacheWrite + t.input) / t.calls : 0); // what one step read, on average
const topModel = t => (Object.entries(t.models).sort((a, b) => b[1] - a[1])[0] || ['?'])[0];

function hookChars(es) {
  let own = 0;
  for (const e of es) {
    const a = e.attachment;
    if (!a || a.type !== 'hook_additional_context') continue;
    const text = Array.isArray(a.content) ? a.content.join('\n') : String(a.content || '');
    if (/JSPARK Forge/.test(text.slice(0, 200))) own += text.length; // its texts all start with its name
  }
  return own;
}

// The size of one tool result as text: text blocks by length, an image as a fixed small amount (its base64 is not text).
function resultChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') n += b.text.length;
    else if (b.type === 'image') n += IMAGE_CHARS;
    else n += Math.min(JSON.stringify(b).length, IMAGE_CHARS);
  }
  return n;
}

function toolResults(es) {
  const names = new Map();
  for (const e of es) {
    const c = e.type === 'assistant' && e.message && e.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use' && b.id) names.set(b.id, plain(b.name, 60));
  }
  const tools = Object.create(null);
  for (const e of es) {
    const c = e.type === 'user' && e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== 'tool_result') continue;
      const len = resultChars(b.content);
      const n = names.get(b.tool_use_id) || '?';
      const t = tools[n] || (tools[n] = { n: 0, chars: 0, max: 0 });
      t.n++; t.chars += len; t.max = Math.max(t.max, len);
    }
  }
  return Object.entries(tools).sort((a, b) => b[1].chars - a[1].chars);
}

function helpersOf(real) {
  const dir = path.join(real.replace(/\.jsonl$/i, ''), 'subagents');
  const by = Object.create(null);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).slice(0, 500); } catch { return by; }
  for (const n of names) {
    const file = allowed(path.join(dir, n)); // a link out of the Claude home is not followed
    const es = file && entries(file);
    if (!Array.isArray(es)) continue;
    let type = 'helper';
    try {
      const meta = path.join(dir, n.replace(/\.jsonl$/, '.meta.json'));
      if (fs.statSync(meta).size <= META_MAX) type = String(JSON.parse(fs.readFileSync(meta, 'utf8')).agentType || 'helper');
    } catch { /* no meta */ }
    type = plain(type.replace(/^jspark-forge:/, ''), 40);
    const u = usageOf(es);
    const b = by[type] || (by[type] = { n: 0, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, models: Object.create(null) });
    b.n++;
    for (const x of ['calls', 'input', 'cacheWrite', 'cacheRead', 'output']) b[x] += u[x];
    for (const [m, c] of Object.entries(u.models)) b.models[m] = (b.models[m] || 0) + c;
  }
  return by;
}

// -> the report text. `file`: a transcript path (from a session file: checked before the disk is touched).
// opts.which: how to name the session ("this session" by default).
function report(file, opts = {}) {
  const which = opts.which || 'this session';
  const real = allowed(file);
  const es = real && entries(real);
  if (es === 'big') return `JSPARK Forge usage report: the record of ${which} is over ${Math.round(MAX_BYTES / 1048576)} MB, too large to read here. That size alone says the conversation is very long: a new session would save usage.\n`;
  if (!es) return `JSPARK Forge usage report: no transcript to read for ${which} (it is read only from inside the Claude home). Nothing to show.\n`;
  const main = usageOf(es);
  if (!main.calls) return `JSPARK Forge usage report: ${which} has no API calls recorded yet.\n`;
  const L = [`JSPARK Forge usage report (${which}; token counts are the API's own, sizes of text are estimates):`];
  const per = reread(main);
  const now = main.last || per;
  L.push(`- Main conversation: ${plural(main.calls, 'step')}; a step re-read about ${k(per)} tokens on average, and the conversation is about ${k(now)} tokens now (every step re-reads all of it). Each step wrote about ${k(main.output / main.calls)}. Model: ${topModel(main)}.`);
  const helpers = helpersOf(real);
  const kinds = Object.entries(helpers).sort((a, b) => (b[1].cacheRead + b[1].cacheWrite) - (a[1].cacheRead + a[1].cacheWrite));
  if (kinds.length) {
    L.push('- Helpers:');
    for (const [type, b] of kinds.slice(0, 8)) L.push(`  - ${type} x${b.n}: ${plural(b.calls, 'step')}, about ${k(reread(b))} tokens re-read per step (${topModel(b)})`);
  }
  const all = [main, ...kinds.map(x => x[1])];
  const sum = f => all.reduce((n, t) => n + t[f], 0);
  const readAll = sum('cacheRead') + sum('cacheWrite') + sum('input');
  L.push(`- In all: about ${k(readAll)} tokens read (${k(sum('cacheRead'))} of them re-read from cache, which costs about a tenth) and ${k(sum('output'))} written.`);
  const own = hookChars(es) / CHARS_PER_TOKEN;
  L.push(`- JSPARK Forge's own notes to Claude: about ${k(own)} tokens added in all (each is re-read on every later step).`);
  const tools = toolResults(es);
  if (tools.length) L.push(`- Biggest tool outputs: ${tools.slice(0, 3).map(([n, t]) => `${n} (${plural(t.n, 'result')}, about ${k(t.chars / CHARS_PER_TOKEN)} tokens)`).join(', ')}.`);

  const tips = [];
  if (now > LONG_CONTEXT) {
    tips.push(`Start a new session. Every step here now re-reads about ${k(now)} tokens; after "save", a new session and "resume", a step starts at about ${k(FRESH_START)} and grows again. Over the next 50 steps that is up to about ${k((now - FRESH_START) * 50)} re-read tokens fewer.`);
  }
  const bigTool = tools.map(([n, t]) => [n, t.max / CHARS_PER_TOKEN]).filter(x => x[1] > BIG_RESULT).sort((a, b) => b[1] - a[1])[0];
  if (bigTool) tips.push(`A single ${bigTool[0]} result was about ${k(bigTool[1])} tokens, and it is re-read on every later step. ${/^(Read|NotebookRead)$/.test(bigTool[0]) ? 'Read only the part that is needed (a line range), or search for the lines first.' : 'Ask for the totals or the failing lines only (for a test run: the summary lines), or have a helper run it and report.'}`);
  for (const [type, b] of kinds) {
    if (b.n && b.calls / b.n > MANY_STEPS) { tips.push(`${type} helpers ran ${Math.round(b.calls / b.n)} steps each on average. Smaller jobs per helper (one task, its own tests) keep each helper's conversation short.`); break; }
  }
  L.push('What would save most:');
  if (tips.length) for (const t of tips) L.push(`- ${t}`); else L.push('- Nothing stands out: the conversation is short now and no single output is large.');
  return `${L.join('\n')}\n`;
}

// A session whose hooks stored no usable transcript path: Claude Code keeps transcripts as
// <Claude home>/projects/<project>/<session id>.jsonl. -> a path or null.
function find(sid) {
  const id = String(sid || '').replace(/[^A-Za-z0-9-]/g, '');
  if (id.length < 8) return null;
  try {
    const root = path.join(require('./paths').claudeHome(), 'projects');
    for (const p of fs.readdirSync(root).slice(0, 2000)) {
      const f = path.join(root, p, `${id}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* no projects folder */ }
  return null;
}

module.exports = { report, find, usageOf, LONG_CONTEXT, MAX_BYTES };
