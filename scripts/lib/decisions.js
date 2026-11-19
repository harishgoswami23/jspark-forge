'use strict';
// Decision memory file (spec 5.3, design-v0.2 section 1.1-1.2): .jspark-forge/decisions.md, committed, hand-editable.
// parse() is lenient: a malformed entry is reported with its line number and skipped. The writers change only what
// they are asked to and keep every other byte (line endings included).
const WIN_OR_MAC = process.platform === 'win32' || process.platform === 'darwin';
const KINDS = new Set(['decision', 'rule', 'lesson', 'reference']);
const HEAD = /^##\s+(D-\d{3,9})\s+(\S.*?)\s*$/; // more than 9 digits: not an id (review M5)
const ANY_HEAD = /^##\s/;
const FIELD = /^-\s+([A-Za-z][A-Za-z ]{0,30}?):\s*(.*)$/;
const SUBFIELD = /^([A-Za-z][A-Za-z ]{0,30}?):\s+(.*)$/;
const SEP = /\s[·|]\s/; // "Date: … · Last verified: …" (spec form) or with "|"

const BOM = new RegExp('^' + String.fromCharCode(0xfeff)); // a byte-order mark (by code: see tests/load.test.js)
const eolOf = text => (/\r\n/.test(text) ? '\r\n' : '\n');

// "- Date: 2026-11-02 · Last verified: 2026-11-02" -> [['date', '2026-11-02'], ['last verified', '2026-11-02']]
// "- Source: commit 3f2e1d0 · plan docs/plans/x.md" -> one field (the second part has no "key:").
function fieldsOfLine(line) {
  const m = line.match(FIELD);
  if (!m) return null;
  const out = [[m[1].toLowerCase(), m[2]]];
  const parts = m[2].split(SEP);
  if (parts.length > 1) {
    out[0][1] = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const s = parts[i].match(SUBFIELD);
      if (s) out.push([s[1].toLowerCase(), s[2]]);
      else out[out.length - 1][1] += ` · ${parts[i]}`;
    }
  }
  return out;
}

function parse(text) {
  const lines = String(text || '').replace(BOM, '').split(/\r?\n/);
  const entries = [];
  const errors = [];
  let cur = null;
  let bad = false;
  const finish = () => {
    if (cur && !bad) {
      const f = cur.fields;
      const kind = (f.kind || 'decision').toLowerCase();
      if (!KINDS.has(kind)) errors.push({ line: cur.kindLine, message: `unknown kind "${f.kind}" (decision, rule, lesson or reference)` });
      else {
        const status = f.status || 'active';
        entries.push({ id: cur.id, title: cur.title, kind, why: f.why || '', see: f.see || '', by: f['decided by'] || '',
          date: f.date || '', lastVerified: f['last verified'] || f.date || '', source: f.source || '',
          touches: (f.touches || '').split(',').map(s => s.trim()).filter(Boolean), status, active: /^active$/i.test(status),
          line: cur.line, fields: f });
      }
    }
    cur = null; bad = false;
  };
  lines.forEach((line, i) => {
    if (ANY_HEAD.test(line)) {
      finish();
      const m = line.match(HEAD);
      if (m) cur = { id: m[1], title: m[2], line: i + 1, fields: {}, kindLine: i + 1 };
      else if (/^##\s+D-/.test(line)) { errors.push({ line: i + 1, message: 'a heading must look like "## D-012 One-line title"' }); cur = { fields: {} }; bad = true; }
      return;
    }
    if (!cur || bad) return;
    const fs = fieldsOfLine(line);
    if (!fs) return;
    for (const [k, v] of fs) { cur.fields[k] = v.trim(); if (k === 'kind') cur.kindLine = i + 1; }
  });
  finish();
  return { entries, errors };
}

// Ids of more than 9 digits are ignored, so one absurd heading cannot push the next id to "D-1e+23" (review M5).
function nextId(text) {
  let max = 0;
  for (const m of String(text || '').replace(BOM, '').matchAll(/^##\s+D-(\d{1,9})(?!\d)/gm)) max = Math.max(max, Number(m[1]));
  return `D-${String(max + 1).padStart(3, '0')}`;
}

// The local calendar date (review, low: a decision made on the 20th must not say the 19th).
const pad2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// -> { text, id }
function addEntry(text, { id: wantId, title, kind = 'decision', why = '', see = '', by = '', source = '', touches = [], date = today() }) {
  const eol = eolOf(text || '');
  const id = wantId || nextId(text);
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const L = [`## ${id} ${clean(title)}`, `- Kind: ${kind}`];
  if (clean(why)) L.push(`- Why: ${clean(why)}`);
  if (clean(see)) L.push(`- See: ${clean(see)}`);
  if (clean(by)) L.push(`- Decided by: ${clean(by)}`);
  L.push(`- Date: ${date}`, `- Last verified: ${date}`); // own line: a verification never conflicts with the Date line
  if (touches.length) L.push(`- Touches: ${touches.map(clean).join(', ')}`);
  if (clean(source)) L.push(`- Source: ${clean(source)}`);
  L.push('- Status: active');
  const head = String(text || '').trimEnd() ||
    '# Decisions\n\nOne line each: the "why" JSPARK Forge shows Claude just before it edits the files an entry touches.'.replace(/\n/g, eol);
  return { text: `${head}${eol}${eol}${L.join(eol)}${eol}`, id };
}

// The lines of a text with each one's own ending, so a rewrite keeps mixed endings as they were (review M6).
function linesOf(text) {
  const parts = String(text).split(/(\r?\n)/);
  return { lines: parts.filter((_, i) => i % 2 === 0), eols: parts.filter((_, i) => i % 2 === 1) };
}
function joinLines({ lines, eols }) { return lines.map((l, i) => l + (eols[i] || '')).join(''); }
// Inserts a line after line k, with the ending that line k has (or the file's, after a last line without one).
function insertAfter(t, k, line, fallbackEol) {
  if (t.eols[k] === undefined) { t.eols[k] = fallbackEol; t.lines.splice(k + 1, 0, line); return; }
  t.lines.splice(k + 1, 0, line);
  t.eols.splice(k + 1, 0, t.eols[k]);
}

// Sets one field of one entry; adds "- Key: value" after the entry's last field line when the field is missing.
function setField(text, id, key, value) {
  const eol = eolOf(text);
  const t = linesOf(text);
  const lines = t.lines;
  const start = lines.findIndex(l => { const m = l.replace(BOM, '').match(HEAD); return m && m[1] === id; });
  if (start < 0) throw new Error(`no entry ${id} in decisions.md`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (ANY_HEAD.test(lines[i])) { end = i; break; }
  const want = key.toLowerCase();
  let lastField = start;
  for (let i = start + 1; i < end; i++) {
    if (!FIELD.test(lines[i])) continue;
    lastField = i;
    const fs = fieldsOfLine(lines[i]);
    if (!fs.some(([k]) => k === want)) continue;
    // Rewrite only the value of this key inside the line, keeping the other parts as they are.
    const keyRe = new RegExp(`((?:^-\\s+|\\s[·|]\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)(.*?)(?=\\s[·|]\\s[A-Za-z][A-Za-z ]{0,30}?:\\s|$)`, 'i');
    lines[i] = lines[i].replace(keyRe, (all, pre) => `${pre}${value}`);
    return joinLines(t);
  }
  insertAfter(t, lastField, `- ${key}: ${value}`, eol);
  return joinLines(t);
}

// Replaces the title on an entry's heading line; nothing else changes.
function setTitle(text, id, title) {
  const t = linesOf(text);
  const lines = t.lines;
  const i = lines.findIndex(l => { const m = l.replace(BOM, '').match(HEAD); return m && m[1] === id; });
  if (i < 0) throw new Error(`no entry ${id} in decisions.md`);
  const bom = lines[i].startsWith(String.fromCharCode(0xfeff)) ? String.fromCharCode(0xfeff) : '';
  lines[i] = `${bom}## ${id} ${String(title).replace(/\s+/g, ' ').trim()}`;
  return joinLines(t);
}

// How many times each id appears (two branches merged can both add D-007). A byte-order mark is not a heading's
// problem (review M4).
function idCounts(text) {
  const n = {};
  for (const m of String(text || '').replace(BOM, '').matchAll(/^##\s+(D-\d{1,9})\s/gm)) n[m[1]] = (n[m[1]] || 0) + 1;
  return n;
}

const words = e =>`${e.title || ''} ${e.why || ''}`.split(/\s+/).filter(Boolean).length;

// ---------- Touches: matching (design 1.2) ----------
// A linear-time matcher (Fable code review H4: a regex built from "**/**/…" or "*a*a*…" backtracked for 20+ s, and this
// runs in PreToolUse with a 3 s limit). Folder by folder: "**" spans any number of folders; "*" and "?" stay inside one
// name. Each step is a table over the remaining input, so the cost is at most pattern size x path size. Patterns over
// 300 characters or with more than 30 wildcards match nothing.
const MAX_PATTERN = 300;
const MAX_WILD = 30;
const normRel = p => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
function nameMatch(p, s) {
  let prev = new Uint8Array(s.length + 1);
  prev[0] = 1;
  for (let i = 0; i < p.length; i++) {
    const cur = new Uint8Array(s.length + 1);
    const c = p[i];
    if (c === '*') { let any = 0; for (let j = 0; j <= s.length; j++) { any = any || prev[j]; cur[j] = any; } }
    else for (let j = 1; j <= s.length; j++) cur[j] = prev[j - 1] && (c === '?' || c === s[j - 1]) ? 1 : 0;
    prev = cur;
  }
  return prev[s.length] === 1;
}
function pathMatch(ps, fsegs) {
  let prev = new Uint8Array(fsegs.length + 1);
  prev[0] = 1;
  for (const seg of ps) {
    const cur = new Uint8Array(fsegs.length + 1);
    if (seg === '**') { let any = 0; for (let j = 0; j <= fsegs.length; j++) { any = any || prev[j]; cur[j] = any; } }
    else for (let j = 1; j <= fsegs.length; j++) cur[j] = prev[j - 1] && nameMatch(seg, fsegs[j - 1]) ? 1 : 0;
    prev = cur;
  }
  return prev[fsegs.length] === 1;
}
function matches(pattern, file) {
  let p = normRel(pattern).replace(/\/+$/, '');
  let f = normRel(file);
  if (!p || !f || p.length > MAX_PATTERN || (p.match(/[*?]/g) || []).length > MAX_WILD) return false;
  if (WIN_OR_MAC) { p = p.toLowerCase(); f = f.toLowerCase(); }
  if (!/[*?]/.test(p)) return p === f || f.startsWith(`${p}/`); // a path or a whole folder
  // "a/**/**/b" is "a/**/b"; "***" inside a name is "*".
  const ps = p.split('/').map(s => (s === '**' ? s : s.replace(/\*+/g, '*'))).filter((s, i, a) => !(s === '**' && a[i - 1] === '**'));
  return pathMatch(ps, f.split('/'));
}

module.exports = { parse, nextId, addEntry, setField, setTitle, idCounts, matches, words, today, KINDS };
