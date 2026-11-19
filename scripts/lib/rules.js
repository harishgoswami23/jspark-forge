'use strict';
// .jspark-forge/rules.md (design 9.3): "## Confirm" and "## Never" lines `- \`text\` : reason` (text matched as
// written, case-insensitive; "re:" for a regular expression), and "## Settings" (notes, statusline-segment, disable).
// Malformed lines are skipped and returned in errors[] with their line number (reported once at SessionStart).
const fs = require('fs');
const path = require('path');
const BUILTINS = require('../../rules/default-blocklist.json');

const SETTINGS = { notes: ['on', 'off'], 'statusline-segment': ['on', 'off'] };

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'rule';

function parseRules(text) {
  const out = { confirm: [], never: [], disabled: [], settings: { notes: 'on', 'statusline-segment': 'on' }, errors: [] };
  const ids = new Set(Object.keys(BUILTINS));
  let section = null;
  let reCount = 0;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const n = idx + 1;
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { const name = h[1].toLowerCase(); section = ['confirm', 'never', 'settings'].includes(name) ? name : null; return; }
    if (!section || !/^\s*[-*]\s+/.test(line)) return;
    if (section === 'settings') {
      const m = line.match(/^\s*[-*]\s+([a-z-]+)\s*:\s*(.+?)\s*$/i);
      const key = m && m[1].toLowerCase();
      if (m && key === 'disable') {
        for (const id of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
          if (BUILTINS[id]) out.disabled.push(id); else out.errors.push({ line: n, message: `unknown block "${id}"` });
        }
      } else if (m && SETTINGS[key] && SETTINGS[key].includes(m[2].toLowerCase())) {
        out.settings[key] = m[2].toLowerCase();
      } else {
        out.errors.push({ line: n, message: 'unknown setting' });
      }
      return;
    }
    const m = line.match(/^\s*[-*]\s+`([^`]+)`\s*(?::\s*(.*?))?\s*$/);
    if (!m) { out.errors.push({ line: n, message: 'expected - `text` : reason' }); return; }
    const source = m[1];
    const rule = { source, reason: m[2] || '', line: n };
    if (source.startsWith('re:')) {
      try { rule.re = new RegExp(source.slice(3), 'i'); } catch { out.errors.push({ line: n, message: 'bad regular expression' }); return; }
      rule.id = `re-${++reCount}`;
    } else {
      rule.text = source;
      let id = slug(source), k = 2;
      while (ids.has(id)) id = `${slug(source)}-${k++}`;
      rule.id = id;
    }
    ids.add(rule.id);
    out[section].push(rule);
  });
  return out;
}

function loadRules(projectDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(projectDir, '.jspark-forge', 'rules.md'), 'utf8'); } catch { /* defaults */ }
  return parseRules(text);
}

module.exports = { parseRules, loadRules };
