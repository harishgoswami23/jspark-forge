'use strict';
// Decision memory file (spec 5.3, design-v0.2 section 1.1-1.2): .jspark-forge/decisions.md, committed, hand-editable.
// parse() is lenient: a malformed entry is reported with its line number and skipped. The writers change only what
// they are asked to and keep every other byte (line endings included).
const WIN_OR_MAC = process.platform === 'win32' || process.platform === 'darwin';
const KINDS = new Set(['decision', 'rule', 'lesson', 'reference']);
const HEAD = /^##\s+(D-\d{3,})\s+(\S.*?)\s*$/;
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

function nextId(text) {
  let max = 0;
  for (const m of String(text || '').matchAll(/^##\s+D-(\d+)/gm)) max = Math.max(max, Number(m[1]));
  return `D-${String(max + 1).padStart(3, '0')}`;
}

const today = () => new Date().toISOString().slice(0, 10);

// -> { text, id }
function addEntry(text, { title, kind = 'decision', why = '', see = '', by = '', source = '', touches = [], date = today() }) {
  const eol = eolOf(text || '');
  const id = nextId(text);
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

// Sets one field of one entry; adds "- Key: value" after the entry's last field line when the field is missing.
function setField(text, id, key, value) {
  const eol = eolOf(text);
  const lines = String(text).split(/\r?\n/);
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
    return lines.join(eol);
  }
  lines.splice(lastField + 1, 0, `- ${key}: ${value}`);
  return lines.join(eol);
}

const words = e => `${e.title || ''} ${e.why || ''}`.split(/\s+/).filter(Boolean).length;

// ---------- Touches: matching (design 1.2) ----------
const normRel = p => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
function globRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, WIN_OR_MAC ? 'i' : '');
}
function matches(pattern, file) {
  const p = normRel(pattern).replace(/\/+$/, '');
  const f = normRel(file);
  if (!p || !f) return false;
  const same = (a, b) => (WIN_OR_MAC ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!/[*?]/.test(p)) return same(p, f) || same(f.slice(0, p.length + 1), `${p}/`); // a path or a whole folder
  if (p.endsWith('/**') && same(f, p.slice(0, -3))) return true; // "src/billing/**" covers the folder itself
  return globRe(p).test(f);
}

module.exports = { parse, nextId, addEntry, setField, matches, words, KINDS };
