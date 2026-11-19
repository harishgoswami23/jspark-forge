'use strict';
// The database layout from migration files (design-v0.3 section 1.3). Reads source files only; never a live database.
// One migration root at a time (never merged); files in numeric-aware order; down migrations skipped; the SQL is split
// outside strings, comments and $$ bodies, then replayed. What it cannot read marks its table "uncertain" or is counted
// as "not understood"; nothing is guessed (principle 11: nothing here is stored, it is re-read from the files each time).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOTS = ['migrations', 'db/migrations', 'supabase/migrations', 'prisma/migrations'];
const OTHER_EXT = new Set(['.js', '.ts', '.py', '.mjs', '.cjs', '.mts', '.cts', '.rb', '.php', '.go']);
const MAX_FILES = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_UNKNOWN_SAMPLES = 5;

// ---- ordering ----

// Chunks of digits compare as numbers (without converting, so long timestamps stay exact), the rest as text.
function cmpNatural(a, b) {
  const pa = String(a).match(/\d+|\D+/g) || [];
  const pb = String(b).match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const dx = /^\d/.test(x);
    const dy = /^\d/.test(y);
    if (dx && dy) {
      const nx = x.replace(/^0+(?=\d)/, '');
      const ny = y.replace(/^0+(?=\d)/, '');
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else {
      const lx = x.toLowerCase();
      const ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
    }
  }
  return pa.length - pb.length || (a < b ? -1 : a > b ? 1 : 0);
}
const cmpPath = (a, b) => {
  const sa = a.split('/');
  const sb = b.split('/');
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const c = cmpNatural(sa[i], sb[i]);
    if (c) return c;
  }
  return sa.length - sb.length;
};

// ---- scanning: SQL text -> statements of tokens ----
// Token kinds: w word/number, q quoted identifier (v = unquoted), s string, b $$ body, p punctuation.

const isWordCh = c => /[A-Za-z0-9_]/.test(c) || c > '\u007f';
const TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const BRACKET = /\[([^\][\r\n;]+)\]/y;

function scan(text) {
  const out = [];
  let toks = [];
  let down = false;
  let line = 1;
  let i = 0;
  const n = text.length;
  const flush = () => { if (toks.length && !down) out.push({ tokens: toks, text, line: toks[0].line }); toks = []; };
  const push = (k, v, s, e, l) => toks.push({ k, v, s, e, line: l });
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '-' && text[i + 1] === '-') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      const body = text.slice(i + 2, e);
      if (/^\s*\+goose\s+down\b/i.test(body) || /^\s*migrate:down\b/i.test(body)) { flush(); down = true; }
      else if (/^\s*\+goose\s+up\b/i.test(body) || /^\s*migrate:up\b/i.test(body)) { flush(); down = false; }
      i = e;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      let e = text.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      for (let k = i; k < e; k++) if (text[k] === '\n') line++;
      i = e;
      continue;
    }
    if (c === "'") {
      const s = i;
      const startLine = line;
      const escapes = (text[i - 1] === 'E' || text[i - 1] === 'e') && !(i > 1 && isWordCh(text[i - 2]));
      i++;
      while (i < n) {
        if (text[i] === '\n') line++;
        if (escapes && text[i] === '\\') { i += 2; continue; }
        if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } break; }
        i++;
      }
      i = Math.min(i + 1, n);
      push('s', text.slice(s, i), s, i, startLine);
      continue;
    }
    if (c === '"' || c === '`') {
      const s = i;
      let v = '';
      i++;
      while (i < n) {
        if (text[i] === c) { if (text[i + 1] === c) { v += c; i += 2; continue; } break; }
        if (text[i] === '\n') line++;
        v += text[i];
        i++;
      }
      i = Math.min(i + 1, n);
      push('q', v, s, i, line);
      continue;
    }
    if (c === '[') {
      BRACKET.lastIndex = i;
      const m = BRACKET.exec(text);
      if (m && !/^\d+$/.test(m[1]) && !(i > 0 && (isWordCh(text[i - 1]) || text[i - 1] === ')'))) {
        push('q', m[1], i, i + m[0].length, line);
        i += m[0].length;
        continue;
      }
    }
    if (c === '$' && !(i > 0 && isWordCh(text[i - 1]))) {
      TAG.lastIndex = i;
      const m = TAG.exec(text);
      if (m) {
        const s = i;
        const startLine = line;
        let e = text.indexOf(m[0], i + m[0].length);
        e = e < 0 ? n : e + m[0].length;
        for (let k = i; k < e; k++) if (text[k] === '\n') line++;
        i = e;
        push('b', '$$', s, i, startLine);
        continue;
      }
    }
    if (c === ';') { flush(); i++; continue; }
    if (isWordCh(c)) {
      const s = i;
      while (i < n && isWordCh(text[i])) i++;
      push('w', text.slice(s, i), s, i, line);
      continue;
    }
    push('p', c, i, i + 1, line);
    i++;
  }
  flush();
  return out;
}

// ---- token helpers ----

const lw = t => (t && t.k === 'w' ? t.v.toLowerCase() : '');
const isId = t => !!t && (t.k === 'w' || t.k === 'q');
const isP = (t, ch) => !!t && t.k === 'p' && t.v === ch;
const keyOf = name => String(name).toLowerCase();
const same = (a, b) => keyOf(a) === keyOf(b);

function close(T, open) { // index of the ")" matching the "(" at open, or T.length
  let d = 0;
  for (let i = open; i < T.length; i++) {
    if (isP(T[i], '(')) d++;
    else if (isP(T[i], ')') && --d === 0) return i;
  }
  return T.length;
}
function splitTop(T) { // by commas outside parentheses
  const items = [];
  let cur = [];
  let d = 0;
  for (const t of T) {
    if (isP(t, '(')) d++;
    else if (isP(t, ')')) d--;
    if (d === 0 && isP(t, ',')) { items.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) items.push(cur);
  return items;
}
function readName(T, i) { // name or schema.name -> { name, next }; the schema is dropped
  if (!isId(T[i])) return null;
  let name = T[i].v;
  i++;
  while (isP(T[i], '.') && isId(T[i + 1])) { name = T[i + 1].v; i += 2; }
  return { name, next: i };
}
function identList(T, i) { // "(a, b)" at i -> { cols, next }
  if (!isP(T[i], '(')) return { cols: [], next: i };
  const end = close(T, i);
  const cols = T.slice(i + 1, end).filter(isId).map(t => t.v);
  return { cols, next: end + 1 };
}
const src = (st, a, b) => st.text.slice(a.s, b.e).replace(/\s+/g, ' ').trim();

// ---- replay ----

const COL_STOP = new Set(['not', 'null', 'default', 'primary', 'references', 'unique', 'check', 'constraint', 'generated', 'collate',
  'auto_increment', 'autoincrement', 'comment', 'on', 'identity', 'as']);
const DEFAULT_STOP = new Set(['not', 'null', 'primary', 'references', 'unique', 'check', 'constraint', 'collate', 'generated', 'comment', 'on',
  'auto_increment', 'autoincrement']);

function parseColumn(st, T) { // tokens of one column definition -> { col, fks }
  const nameTok = T[0];
  const col = { name: nameTok.v, type: '', notNull: false, default: null, pk: false, file: st.file, line: nameTok.line };
  const fks = [];
  let i = 1;
  const typeStart = i;
  while (i < T.length && !COL_STOP.has(lw(T[i]))) i = isP(T[i], '(') ? close(T, i) + 1 : i + 1;
  if (i > typeStart) col.type = src(st, T[typeStart], T[Math.min(i, T.length) - 1]);
  while (i < T.length) {
    const w = lw(T[i]);
    if (w === 'constraint') { i += 2; continue; }
    if (w === 'not' && lw(T[i + 1]) === 'null') { col.notNull = true; i += 2; continue; }
    if (w === 'primary' && lw(T[i + 1]) === 'key') { col.pk = true; col.notNull = true; i += 2; continue; }
    if (w === 'default') {
      const a = i + 1;
      let j = a;
      if (j < T.length) j = isP(T[j], '(') ? close(T, j) + 1 : j + 1;
      while (j < T.length && !DEFAULT_STOP.has(lw(T[j]))) j = isP(T[j], '(') ? close(T, j) + 1 : j + 1;
      if (j > a) col.default = src(st, T[a], T[Math.min(j, T.length) - 1]);
      i = j;
      continue;
    }
    if (w === 'references') {
      const nm = readName(T, i + 1);
      if (nm) {
        const l = identList(T, nm.next);
        fks.push({ name: null, columns: [col.name], refTable: nm.name, refColumns: l.cols, file: st.file, line: T[i].line });
        i = l.next;
        continue;
      }
    }
    i = isP(T[i], '(') ? close(T, i) + 1 : i + 1;
  }
  return { col, fks };
}

function indexish(item, at) { // MySQL "KEY idx (a, b)" / "INDEX idx (a)": not a column called key/index
  const open = at + 1;
  if (!isId(item[at]) || !isP(item[open], '(') && !(isId(item[open]) && isP(item[open + 1], '('))) return false;
  const p = isP(item[open], '(') ? open : open + 1;
  const end = close(item, p);
  if (end !== item.length - 1) return false;
  return item.slice(p + 1, end).every(t => isP(t, ',') || (isId(t) && !/^\d/.test(t.v)));
}

// A table-level constraint inside CREATE TABLE or after ALTER TABLE ADD. Returns false when it is not one.
function tableLevel(ctx, table, st, item) {
  let i = 0;
  let name = null;
  if (lw(item[0]) === 'constraint') { name = isId(item[1]) ? item[1].v : null; i = 2; }
  const w = lw(item[i]);
  const w2 = lw(item[i + 1]);
  if (w === 'primary' && w2 === 'key') {
    const l = identList(item, i + 2);
    for (const c of table.columns) if (l.cols.some(x => same(x, c.name))) { c.pk = true; c.notNull = true; }
    return true;
  }
  if (w === 'foreign' && w2 === 'key') {
    let j = i + 2;
    if (isId(item[j]) && !isP(item[j], '(') && isP(item[j + 1], '(')) j++; // MySQL: FOREIGN KEY name (cols)
    const l = identList(item, j);
    if (lw(item[l.next]) === 'references') {
      const nm = readName(item, l.next + 1);
      if (nm) {
        const r = identList(item, nm.next);
        table.fks.push({ name, columns: l.cols, refTable: nm.name, refColumns: r.cols, file: st.file, line: item[i].line });
        return true;
      }
    }
    ctx.uncertain(table, st);
    return true;
  }
  if (name) { // CONSTRAINT x UNIQUE / CHECK / EXCLUDE: nothing tracked
    return true;
  }
  if (w === 'unique' && (isP(item[i + 1], '(') || ['key', 'index'].includes(w2))) return true;
  if ((w === 'check' || w === 'exclude') && (isP(item[i + 1], '(') || lw(item[i + 1]) === 'using')) return true;
  if ((w === 'fulltext' || w === 'spatial') && ['key', 'index'].includes(w2)) return true;
  if ((w === 'key' || w === 'index') && indexish(item, 0)) return true;
  if (w === 'like') { ctx.uncertain(table, st); return true; }
  return false;
}

function newTable(ctx, st, name) {
  return { name, file: st.file, line: st.line, columns: [], fks: [], uncertain: false, uncertainAt: [], files: new Set([st.file]) };
}

function uncertain(table, st, line) {
  table.uncertain = true;
  if (table.uncertainAt.length < MAX_UNKNOWN_SAMPLES) table.uncertainAt.push({ file: st.file, line: line || st.line });
  table.files.add(st.file);
}

function createTable(ctx, st, T, i) {
  if (lw(T[i]) === 'if' && lw(T[i + 1]) === 'not' && lw(T[i + 2]) === 'exists') {
    i += 3;
    const nm = readName(T, i);
    if (nm && ctx.tables.has(keyOf(nm.name))) { ctx.tables.get(keyOf(nm.name)).files.add(st.file); return; }
  }
  const nm = readName(T, i);
  if (!nm) { ctx.unknownAt(st); return; }
  const table = newTable(ctx, st, nm.name);
  ctx.tables.set(keyOf(nm.name), table);
  if (!isP(T[nm.next], '(')) { uncertain(table, st); return; } // AS SELECT, USING fts5, PARTITION OF ...
  const end = close(T, nm.next);
  for (const item of splitTop(T.slice(nm.next + 1, end))) {
    if (!item.length) continue;
    if (tableLevel(ctx, table, st, item)) continue;
    if (!isId(item[0])) { uncertain(table, st, item[0].line); continue; }
    const { col, fks } = parseColumn(st, item);
    table.columns.push(col);
    table.fks.push(...fks);
  }
  if (T.slice(end + 1).some(t => lw(t) === 'inherits')) uncertain(table, st); // columns come from another table too
}

function dropFksOn(table, colName) {
  table.fks = table.fks.filter(f => !f.columns.some(c => same(c, colName)));
}

function renameTable(ctx, st, from, to) {
  const t = ctx.tables.get(keyOf(from));
  if (!t) { ctx.unknownAt(st); return; }
  ctx.tables.delete(keyOf(from));
  t.name = to;
  t.files.add(st.file);
  ctx.tables.set(keyOf(to), t);
  for (const o of ctx.tables.values()) for (const f of o.fks) if (same(f.refTable, from)) f.refTable = to;
}

function alterAction(ctx, table, st, act) {
  const w = lw(act[0]);
  const w1 = lw(act[1]);
  if (w === 'add') {
    let j = 1;
    if (isP(act[j], '(')) { uncertain(table, st); ctx.unknownAt(st); return; }
    if (w1 === 'column') j++;
    const rest = act.slice(j);
    if (w1 !== 'column' && tableLevel(ctx, table, st, rest)) return;
    let ine = false;
    if (lw(rest[0]) === 'if' && lw(rest[1]) === 'not' && lw(rest[2]) === 'exists') { ine = true; rest.splice(0, 3); }
    if (!isId(rest[0])) { uncertain(table, st, act[0].line); ctx.unknownAt(st); return; }
    const { col, fks } = parseColumn(st, rest);
    const at = table.columns.findIndex(c => same(c.name, col.name));
    if (at >= 0) { if (ine) return; table.columns[at] = col; dropFksOn(table, col.name); } else table.columns.push(col);
    table.fks.push(...fks);
    return;
  }
  if (w === 'drop') {
    let j = 1;
    if (w1 === 'constraint') {
      if (lw(act[2]) === 'if' && lw(act[3]) === 'exists') j = 4; else j = 2;
      if (act[j]) table.fks = table.fks.filter(f => !(f.name && same(f.name, act[j].v)));
      return;
    }
    if (w1 === 'foreign' && lw(act[2]) === 'key') { if (act[3]) table.fks = table.fks.filter(f => !(f.name && same(f.name, act[3].v))); return; }
    if (w1 === 'primary' && lw(act[2]) === 'key') { for (const c of table.columns) c.pk = false; return; }
    if (w1 === 'index' || w1 === 'key') return;
    if (w1 === 'column') j = 2;
    let ife = false;
    if (lw(act[j]) === 'if' && lw(act[j + 1]) === 'exists') { ife = true; j += 2; }
    if (!isId(act[j])) { uncertain(table, st); ctx.unknownAt(st); return; }
    const at = table.columns.findIndex(c => same(c.name, act[j].v));
    if (at < 0) { if (!ife) uncertain(table, st, act[0].line); return; }
    table.columns.splice(at, 1);
    dropFksOn(table, act[j].v);
    return;
  }
  if (w === 'rename') {
    if (w1 === 'to' || w1 === 'as') { const nm = readName(act, 2); if (nm) renameTable(ctx, st, table.name, nm.name); else { uncertain(table, st); ctx.unknownAt(st); } return; }
    if (['index', 'key', 'constraint'].includes(w1)) return;
    const j = w1 === 'column' ? 2 : 1;
    if (isId(act[j]) && lw(act[j + 1]) === 'to' && isId(act[j + 2])) {
      const c = table.columns.find(x => same(x.name, act[j].v));
      if (!c) { uncertain(table, st, act[0].line); return; }
      for (const f of table.fks) f.columns = f.columns.map(x => (same(x, c.name) ? act[j + 2].v : x));
      c.name = act[j + 2].v;
      return;
    }
    uncertain(table, st); ctx.unknownAt(st);
    return;
  }
  if (w === 'alter') {
    const j = w1 === 'column' ? 2 : 1;
    const c = isId(act[j]) ? table.columns.find(x => same(x.name, act[j].v)) : null;
    if (!c) { uncertain(table, st, act[0].line); return; }
    let k = j + 1;
    if (lw(act[k]) === 'set' && lw(act[k + 1]) === 'data') k++;
    const a = lw(act[k]);
    const b = lw(act[k + 1]);
    if (a === 'type' || (a === 'set' && b === 'data')) {
      let e = act.length;
      const u = act.findIndex((t, x) => x > k && lw(t) === 'using');
      if (u > 0) e = u;
      if (e > k + 1) c.type = src(st, act[k + 1], act[e - 1]);
    } else if (a === 'set' && b === 'not') c.notNull = true;
    else if (a === 'drop' && b === 'not') c.notNull = false;
    else if (a === 'set' && b === 'default' && act.length > k + 2) c.default = src(st, act[k + 2], act[act.length - 1]);
    else if (a === 'drop' && b === 'default') c.default = null;
    return;
  }
  if (w === 'modify' || w === 'change') {
    let j = w1 === 'column' ? 2 : 1;
    const old = act[j];
    if (!isId(old)) { uncertain(table, st); ctx.unknownAt(st); return; }
    let defAt = j + 1;
    if (w === 'change') { if (!isId(act[j + 1])) { uncertain(table, st); ctx.unknownAt(st); return; } defAt = j + 1; } else defAt = j;
    const { col, fks } = parseColumn(st, act.slice(defAt));
    const at = table.columns.findIndex(c => same(c.name, old.v));
    if (at < 0) { uncertain(table, st, act[0].line); return; }
    if (w === 'change') for (const f of table.fks) f.columns = f.columns.map(x => (same(x, old.v) ? col.name : x));
    col.line = table.columns[at].line; col.file = table.columns[at].file;
    table.columns[at] = col;
    table.fks.push(...fks);
    return;
  }
  const IGNORE = new Set(['enable', 'disable', 'force', 'no', 'owner', 'set', 'validate', 'attach', 'detach', 'cluster', 'replica', 'inherit',
    'engine', 'auto_increment', 'comment', 'convert', 'charset', 'character', 'default', 'algorithm', 'lock', 'row_format', 'reset', 'collate']);
  if (IGNORE.has(w)) return;
  uncertain(table, st, act[0] && act[0].line);
  ctx.unknownAt(st, act[0] && act[0].line);
}

function alterTable(ctx, st, T, i) {
  if (lw(T[i]) === 'if' && lw(T[i + 1]) === 'exists') i += 2;
  if (lw(T[i]) === 'only') i++;
  const nm = readName(T, i);
  if (!nm) { ctx.unknownAt(st); return; }
  let table = ctx.tables.get(keyOf(nm.name));
  if (!table) { table = newTable(ctx, st, nm.name); ctx.tables.set(keyOf(nm.name), table); uncertain(table, st); } // created outside these files
  table.files.add(st.file);
  for (const act of splitTop(T.slice(nm.next))) if (act.length) alterAction(ctx, table, st, act);
}

function dropTable(ctx, st, T, i) {
  if (lw(T[i]) === 'if' && lw(T[i + 1]) === 'exists') i += 2;
  for (const item of splitTop(T.slice(i))) {
    const nm = readName(item, 0);
    if (!nm) { ctx.unknownAt(st); continue; }
    ctx.tables.delete(keyOf(nm.name));
  }
}

const PLAIN = new Set(['insert', 'update', 'delete', 'select', 'grant', 'revoke', 'comment', 'set', 'begin', 'commit', 'rollback', 'start', 'end',
  'pragma', 'truncate', 'use', 'do', 'vacuum', 'analyze', 'lock', 'copy', 'with', 'explain', 'call', 'savepoint', 'release', 'reset', 'notify',
  'listen', 'refresh', 'reindex', 'cluster', 'checkpoint', 'discard', 'declare', 'fetch', 'values', 'show', 'merge', 'replace']);
const OBJECTS = new Set(['index', 'unique', 'view', 'materialized', 'function', 'procedure', 'trigger', 'extension', 'type', 'sequence', 'policy',
  'domain', 'role', 'user', 'schema', 'or', 'temp', 'temporary', 'rule', 'aggregate', 'operator', 'collation', 'tablespace', 'publication',
  'subscription', 'event', 'language', 'cast', 'server', 'foreign', 'text', 'owned', 'default', 'virtual', 'recursive', 'global', 'local', 'cluster']);

function apply(ctx, st) {
  const T = st.tokens;
  const w = lw(T[0]);
  if (PLAIN.has(w)) return;
  if (w === 'create') {
    let i = 1;
    let temp = false;
    while (['global', 'local', 'unlogged'].includes(lw(T[i])) || ['temp', 'temporary'].includes(lw(T[i]))) { if (['temp', 'temporary'].includes(lw(T[i]))) temp = true; i++; }
    if (lw(T[i]) === 'table') { if (!temp) createTable(ctx, st, T, i + 1); return; }
    if (lw(T[i]) === 'virtual' && lw(T[i + 1]) === 'table') { createTable(ctx, st, T, i + 2); return; }
    if (OBJECTS.has(lw(T[i]))) return;
    ctx.unknownAt(st);
    return;
  }
  if (w === 'alter') {
    if (lw(T[1]) === 'table') { alterTable(ctx, st, T, 2); return; }
    if (OBJECTS.has(lw(T[1]))) return;
    ctx.unknownAt(st);
    return;
  }
  if (w === 'drop') {
    if (lw(T[1]) === 'table') { dropTable(ctx, st, T, 2); return; }
    if (OBJECTS.has(lw(T[1])) && lw(T[1]) !== 'schema') return;
    ctx.unknownAt(st);
    return;
  }
  if (w === 'rename' && lw(T[1]) === 'table') {
    for (const item of splitTop(T.slice(2))) {
      const a = readName(item, 0);
      const b = a && lw(item[a.next]) === 'to' ? readName(item, a.next + 1) : null;
      if (a && b) renameTable(ctx, st, a.name, b.name); else ctx.unknownAt(st);
    }
    return;
  }
  ctx.unknownAt(st);
}

// ---- roots ----

function listFiles(abs) { // relative paths (forward slashes) of every file below abs, capped
  const out = [];
  const walk = (d, rel) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(path.join(d, e.name), r); } else if (e.isFile()) out.push(r);
    }
  };
  walk(abs, '');
  return out;
}
const isDown = rel => /\.down\.sql$/i.test(rel) || rel.split('/').slice(0, -1).some(s => s.toLowerCase() === 'down');

function readRoot(dir, rootRel) {
  const abs = path.join(dir, rootRel);
  const all = listFiles(abs);
  const sql = all.filter(f => /\.sql$/i.test(f) && !isDown(f)).sort(cmpPath);
  const downCount = all.filter(f => /\.sql$/i.test(f) && isDown(f)).length;
  if (!sql.length) {
    const other = all.filter(f => OTHER_EXT.has(path.extname(f).toLowerCase()));
    if (!other.length) return null;
    return { root: rootRel, sql: false, note: 'no SQL migrations here', files: [], otherFiles: other.length, tables: [], unknown: 0, unknownAt: [], skippedDown: 0 };
  }
  const tables = new Map();
  const res = { root: rootRel, sql: true, note: '', files: [], tables: [], unknown: 0, unknownAt: [], skippedDown: downCount };
  const ctx = {
    tables,
    uncertain,
    unknownAt(st, line) { res.unknown++; if (res.unknownAt.length < MAX_UNKNOWN_SAMPLES) res.unknownAt.push({ file: st.file, line: line || st.line }); },
  };
  for (const rel of sql) {
    const file = `${rootRel}/${rel}`;
    res.files.push(file);
    let text;
    try {
      text = fs.readFileSync(path.join(abs, rel), 'utf8');
      if (text.length > MAX_BYTES) throw new Error('too big');
    } catch { ctx.unknownAt({ file, line: 1 }); continue; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (const st of scan(text)) {
      st.file = file;
      try { apply(ctx, st); } catch { ctx.unknownAt(st); }
    }
  }
  res.tables = [...tables.values()];
  return res;
}

// -> { roots: [...] }: one entry per migration root that exists and has migration files; never merged.
function read(dir) {
  const roots = [];
  for (const r of ROOTS) {
    let isDir = false;
    try { isDir = fs.statSync(path.join(dir, r)).isDirectory(); } catch { /* none */ }
    if (!isDir) continue;
    const root = readRoot(dir, r);
    if (root) roots.push(root);
  }
  return { roots };
}

// ---- the command ----

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

function shortHead(dir) {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const s = r.status === 0 ? String(r.stdout).trim() : '';
    return /^[0-9a-f]{4,40}$/.test(s) ? s : '';
  } catch { return ''; }
}

function tableLines(t) {
  const L = [`  ${t.name}  (${t.file}:${t.line})${t.uncertain ? '  UNCERTAIN: some statements about this table could not be read, so the columns may be out of date' : ''}`];
  for (const u of t.uncertainAt) L.push(`      could not read: ${u.file}:${u.line}`);
  for (const c of t.columns) {
    const bits = [c.name, c.type || '(no type)'];
    if (c.pk) bits.push('PRIMARY KEY');
    if (c.notNull && !c.pk) bits.push('NOT NULL');
    if (c.default !== null) bits.push(`DEFAULT ${c.default}`);
    L.push(`    ${bits.join('  ')}  (${c.file}:${c.line})`);
  }
  const pk = t.columns.filter(c => c.pk).map(c => c.name);
  if (pk.length > 1) L.push(`    primary key (${pk.join(', ')})`);
  for (const f of t.fks) L.push(`    foreign key (${f.columns.join(', ')}) -> ${f.refTable}${f.refColumns.length ? `(${f.refColumns.join(', ')})` : ''}${f.name ? `  [${f.name}]` : ''}  (${f.file}:${f.line})`);
  return L;
}

function run(dir, args) {
  const { clean } = require('./memory');
  const { matches } = require('./decisions');
  const want = (args || []).filter(a => !String(a).startsWith('--'))[0];
  const { roots } = read(dir);
  if (!roots.length) return `No migration folder found (looked for ${ROOTS.join(', ')} at the project top). JSPARK Forge reads migration files only, never a database.\n`;
  const sha = shortHead(dir);
  const wantKey = want ? keyOf(String(want).replace(/^.*\./, '').replace(/^["`[]|["`\]]$/g, '')) : '';
  const L = [`Database layout from the migration files${sha ? `, as of ${sha}` : ''} (JSPARK Forge never reads a live database):`];
  if (want) {
    const all = roots.flatMap(r => r.tables.map(t => t.name));
    if (!roots.some(r => r.tables.some(t => keyOf(t.name) === wantKey))) {
      const list = [...new Set(all)].sort();
      return `${L[0]}\nNo table named "${clean(want, 60)}" in the migration files.${list.length ? ` Tables: ${list.slice(0, 40).join(', ')}${list.length > 40 ? ', ...' : ''}.` : ''}\n`;
    }
  }
  const entries = require('./memory').load(dir);
  const decisionLines = [];
  for (const r of roots) {
    L.push('');
    if (!r.sql) { L.push(`${r.root}: ${r.note} (${plural(r.otherFiles, 'script file')}; JSPARK Forge reads .sql files only)`); continue; }
    const shown = (want ? r.tables.filter(t => keyOf(t.name) === wantKey) : r.tables).slice().sort((a, b) => cmpNatural(a.name, b.name));
    const unc = r.tables.filter(t => t.uncertain).length;
    L.push(`${r.root}: ${plural(r.files.length, 'migration file')}, ${plural(r.tables.length, 'table')}${unc ? `, ${unc} uncertain` : ''}${r.unknown ? `, ${plural(r.unknown, 'statement')} not understood (${r.unknownAt.map(u => `${u.file}:${u.line}`).join(', ')}${r.unknown > r.unknownAt.length ? ', ...' : ''})` : ''}`);
    if (!shown.length) L.push('  (no table in this folder matches)');
    for (const t of shown) L.push(...tableLines(t));
    const files = want ? new Set(shown.flatMap(t => [...t.files])) : new Set(r.files);
    for (const f of r.files.filter(x => files.has(x))) {
      const hit = entries.filter(e => e.touches.some(p => matches(p, f)));
      if (hit.length) decisionLines.push(`  ${f}: ${hit.map(e => `${e.id} ${clean(e.title, 100)}`).join('; ')}`);
    }
  }
  if (decisionLines.length) L.push('', 'Decisions that touch these migration files:', ...decisionLines);
  return `${L.join('\n')}\n`;
}

module.exports = { read, run, scan, cmpNatural, ROOTS };
