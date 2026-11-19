'use strict';
// .jspark-forge/rules.md (design 9.3): "## Confirm" and "## Never" lines `- \`text\` : reason` (text matched as
// written, case-insensitive; "re:" for a regular expression), and "## Settings" (notes, statusline-segment, disable).
// Malformed lines are skipped and returned in errors[] with their line number (reported once at SessionStart).
const fs = require('fs');
const path = require('path');
const BUILTINS = require('../../rules/default-blocklist.json');
const paths = require('./paths');


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

// Two files (v0.1.1 security fix, owner 2026-11-19):
// - the project's .jspark-forge/rules.md: committed, so it may come from a cloned repo. It may ADD Confirm / Never
//   rules and set preferences, but its "disable:" lines are ignored and reported: a repo cannot switch a block off.
// - the user's own <CLAUDE_CONFIG_DIR or ~/.claude>/jspark-forge/rules.md: same syntax, applies to every project,
//   and is the only place where "disable:" works.
const REPO_LABEL = '.jspark-forge/rules.md';
const USER_LABEL = '~/.claude/jspark-forge/rules.md';
const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

function loadRules(projectDir, { claudeHome } = {}) {
  const home = claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
  const user = parseRules(readText(path.join(home, 'jspark-forge', 'rules.md')));
  // In guest mode (someone else's repo) the repo's rules.md is the repo author's file: never read.
  const repoText = paths.isGuest(projectDir) ? '' : readText(path.join(paths.repoForgeDir(projectDir), 'rules.md'));
  const repo = parseRules(repoText);
  const repoDisable = repoText.split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 })).filter(x => /^\s*[-*]\s+disable\s*:/i.test(x.l));
  const ids = new Set(user.confirm.concat(user.never).map(r => r.id));
  const fresh = r => (ids.has(r.id) ? Object.assign({}, r, { id: `${r.id}-repo` }) : r);
  return {
    confirm: user.confirm.concat(repo.confirm.map(fresh)),
    never: user.never.concat(repo.never.map(fresh)),
    disabled: user.disabled,
    settings: Object.assign({}, user.settings, repo.settings),
    errors: user.errors.map(e => Object.assign({ file: USER_LABEL }, e))
      .concat(repo.errors.map(e => Object.assign({ file: REPO_LABEL }, e)))
      .concat(repoDisable.map(x => ({ file: REPO_LABEL, line: x.n,
        message: `a project's rules.md cannot switch off built-in blocks; put "disable:" in ${USER_LABEL}` }))),
  };
}

module.exports = { parseRules, loadRules };
