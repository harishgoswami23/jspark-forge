'use strict';
// Licence check for external code (spec 5.2b, v0.2): the licence of a guest repo and of each read-only source is read
// once and said in one plain line at SessionStart. One small file read per folder; local only; a hint, never legal
// advice. Reads only: nothing is written in the repo or the source (the "already told" memory is a state file under
// paths.forgeDir). Every failure is silent (fail open).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const FILE_RE = /^(licen[cs]e|copying)([-_. ].*)?$/i;
const MAX_READ = 64 * 1024;

const P = name => ({ kind: 'permissive', name });
const C = name => ({ kind: 'copyleft', name });
const N = name => ({ kind: 'noncommercial', name });
const NONE = { kind: 'none' };
const UNKNOWN = { kind: 'unknown' };

// Licence texts: the first matching rule wins, so the specific (LGPL, AGPL, non-commercial) come before the general.
const gnuVersion = (text, re) => { const m = text.match(re); return m ? m[1] : ''; };
const TEXT_RULES = [
  [/polyform\s+noncommercial/i, () => N('PolyForm-Noncommercial')],
  [/business\s+source\s+license/i, () => N('BSL-1.1')],
  [/attribution-noncommercial|cc\s*by-nc/i, t => N(/sharealike/i.test(t) ? 'CC-BY-NC-SA-4.0' : 'CC-BY-NC-4.0')],
  [/gnu\s+affero\s+general\s+public\s+license/i, t => C(`AGPL-${gnuVersion(t, /version\s+(\d)/i) || '3'}.0`)],
  [/gnu\s+lesser\s+general\s+public\s+license|gnu\s+library\s+general\s+public\s+license/i, t => C(`LGPL-${gnuVersion(t, /version\s+(\d(?:\.\d)?)/i) || '3.0'}`)],
  [/gnu\s+general\s+public\s+license/i, t => C(`GPL-${gnuVersion(t, /version\s+(\d)/i) || '3'}.0`)],
  [/mozilla\s+public\s+license/i, () => C('MPL-2.0')],
  [/eclipse\s+public\s+license/i, t => C(/version\s+2\.0/i.test(t) ? 'EPL-2.0' : 'EPL-1.0')],
  [/apache\s+license/i, () => P('Apache-2.0')],
  [/permission\s+is\s+hereby\s+granted,?\s+free\s+of\s+charge/i, () => P('MIT')],
  [/permission\s+to\s+use,\s+copy,\s+modify,?\s+(and\/or\s+)?distribute\s+this\s+software\s+for\s+any\s+purpose\s+with\s+or\s+without\s+fee/i, () => P('ISC')],
  [/redistribution\s+and\s+use\s+in\s+source\s+and\s+binary\s+forms/i, t => P(/neither\s+the\s+name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause')],
  [/free\s+and\s+unencumbered\s+software\s+released\s+into\s+the\s+public\s+domain/i, () => P('Unlicense')],
  [/altered\s+source\s+versions\s+must\s+be\s+plainly\s+marked/i, () => P('zlib')],
];
function classifyText(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  for (const [re, make] of TEXT_RULES) if (re.test(t)) return make(t);
  return UNKNOWN;
}

// package.json "license" (an SPDX id or expression). OR: you may pick, so the most permissive part counts;
// AND: all apply, so the most restrictive counts.
const RANK = { permissive: 0, none: 1, unknown: 2, copyleft: 3, noncommercial: 4 };
const SPDX = [
  [/^(MIT|MIT-0|ISC|Unlicense|0BSD|Zlib|BSD-[\w-]+|Apache-[\d.]+|CC0-1\.0|WTFPL|BlueOak-[\d.]+|Python-2\.0)$/i, id => P(id)],
  [/^(A?GPL|LGPL)-/i, id => C(id.replace(/-(only|or-later)$/i, '').replace(/\+$/, ''))],
  [/^(MPL|EPL|CDDL|EUPL|OSL)-/i, id => C(id)],
  [/^(BUSL-|PolyForm-Noncommercial|CC-BY-NC)/i, id => N(/^BUSL/i.test(id) ? 'BSL-1.1' : id)],
  [/^UNLICENSED$/i, () => NONE],
];
function classifyId(id) {
  const x = id.trim().replace(/^\(|\)$/g, '').trim().replace(/\+$/, '');
  for (const [re, make] of SPDX) if (re.test(x)) return make(x);
  return UNKNOWN;
}
function classifySpdx(expr) {
  const s = String(expr || '').trim();
  if (!s) return NONE;
  if (/^SEE LICENSE IN/i.test(s)) return UNKNOWN;
  const ors = s.replace(/[()]/g, ' ').split(/\s+OR\s+/i).map(part => {
    const ands = part.split(/\s+AND\s+/i).map(classifyId);
    return ands.reduce((a, b) => (RANK[b.kind] > RANK[a.kind] ? b : a));
  });
  const best = ors.reduce((a, b) => (RANK[b.kind] < RANK[a.kind] ? b : a));
  return best.kind === 'permissive' || best.kind === 'copyleft' ? Object.assign({}, best, { name: /\s(OR|AND)\s/i.test(s) ? s.replace(/[()]/g, '').trim() : best.name }) : best;
}

const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const readHead = f => { const fd = fs.openSync(f, 'r'); try { const b = Buffer.alloc(MAX_READ); return b.toString('utf8', 0, fs.readSync(fd, b, 0, MAX_READ, 0)); } finally { fs.closeSync(fd); } };

// -> { kind: permissive|copyleft|noncommercial|none|unknown, name?, file?, hash }. Never throws.
function readLicence(folder) {
  let file = null, fileHash = '', result = null;
  try {
    const names = fs.readdirSync(folder).filter(n => FILE_RE.test(n)).sort();
    for (const n of names) {
      let text;
      try { if (!fs.statSync(path.join(folder, n)).isFile()) continue; text = readHead(path.join(folder, n)); } catch { continue; }
      const c = classifyText(text);
      file = file || n; fileHash = fileHash || sha(text);
      if (c.kind !== 'unknown') { return Object.assign({}, c, { file: n, hash: sha(text) }); }
    }
  } catch { /* no such folder or unreadable */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
    let raw = pkg.license;
    if (raw && typeof raw === 'object') raw = raw.type;
    if (!raw && Array.isArray(pkg.licenses)) raw = pkg.licenses.map(l => (l && l.type) || l).join(' OR ');
    if (raw) {
      const c = classifySpdx(raw);
      if (c.kind !== 'unknown' || !file) result = Object.assign({}, c, { file: c.kind === 'unknown' ? 'package.json' : undefined, hash: sha(`pkg:${raw}`) });
    }
  } catch { /* none */ }
  if (result) return result;
  if (file) return { kind: 'unknown', file, hash: fileHash };
  return { kind: 'none', hash: 'none' };
}

const FAMILY = n => String(n).replace(/-.*$/, '');
function describe(label, c) {
  const tail = ' A hint, not legal advice.';
  switch (c.kind) {
    case 'permissive': return `JSPARK Forge: ${label} is under ${c.name} (permissive: reuse is fine if you keep its copyright notice).${tail}`;
    case 'copyleft': return `JSPARK Forge: ${label} is under ${c.name} (copyleft: code you copy must stay under the ${FAMILY(c.name)}).${tail}`;
    case 'noncommercial': return `JSPARK Forge: ${label} is under ${c.name} (non-commercial: not free to use in a commercial product).${tail}`;
    case 'unknown': return `JSPARK Forge: ${label} has an unrecognised licence; read ${c.file || 'its licence file'} before reusing code.${tail}`;
    default: return `JSPARK Forge: ${label}: no licence found: all rights reserved by default.${tail}`;
  }
}

// ---- once per repo or source: remembered in <forgeDir>/state/licences.json as { <normalised path>: <hash> } ----
const stateFile = dir => path.join(paths.forgeDir(dir), 'state', 'licences.json');
function readState(dir) { try { const s = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; } }
function writeState(dir, s) {
  try { const f = stateFile(dir); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(s, null, 1)}\n`); } catch { /* fail open */ }
}

// items: [{ label, folder }] -> the lines not yet shown for this licence. Marks them shown.
function notices(dir, items) {
  const out = [];
  try {
    const seen = readState(dir);
    let changed = false;
    for (const it of items) {
      try {
        const key = paths.normPath(it.folder);
        const c = readLicence(it.folder);
        if (seen[key] === c.hash) continue;
        seen[key] = c.hash; changed = true;
        out.push(describe(it.label, c));
      } catch { /* silent */ }
    }
    if (changed) writeState(dir, seen);
  } catch { /* silent */ }
  return out;
}

module.exports = { classifyText, classifySpdx, readLicence, describe, notices };
