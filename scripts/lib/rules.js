'use strict';
// .jspark-forge/rules.md (design 9.3): "## Confirm" and "## Never" lines `- \`text\` : reason` (text matched as
// written, case-insensitive; "re:" for a regular expression), and "## Settings" (notes, statusline-segment, disable).
// Malformed lines are skipped and returned in errors[] with their line number (reported once at SessionStart).
const fs = require('fs');
const path = require('path');
const BUILTINS = require('../../rules/default-blocklist.json');
const paths = require('./paths');


const SETTINGS = { notes: ['on', 'off'], 'statusline-segment': ['on', 'off'], 'code-map': ['on', 'off'], playwright: ['on', 'off'], 'ui-skills': ['on', 'off'], 'short-answers': ['on', 'off'], 'fresh-session': ['on', 'off'] };
// brand-skill (v0.5): a skill name, shown to Claude as text, so only a plain name is accepted.
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,79}$/;

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'rule';

function parseRules(text) {
  const out = { confirm: [], never: [], disabled: [], readonly: [], dbDev: [], settings: { notes: 'on', 'statusline-segment': 'on', 'code-map': 'on', playwright: 'on', 'ui-skills': 'on', 'short-answers': 'on' }, explicit: [], errors: [] };
  const ids = new Set(Object.keys(BUILTINS));
  let section = null;
  let reCount = 0;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const n = idx + 1;
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { const name = h[1].toLowerCase(); section = ['confirm', 'never', 'settings', 'sources'].includes(name) ? name : null; return; }
    if (!section || !/^\s*[-*]\s+/.test(line)) return;
    if (section === 'sources') { // v0.1.1 read-only sources: "- readonly: <path> : <why>" (" : " separates; a Windows path keeps its C:)
      const m = line.match(/^\s*[-*]\s+readonly\s*:\s*(.+?)\s*$/i);
      if (!m) { out.errors.push({ line: n, message: 'expected - readonly: <path> : <why>' }); return; }
      const [p, ...why] = m[1].split(' : ');
      out.readonly.push({ path: p.trim(), reason: why.join(' : ').trim(), line: n });
      return;
    }
    if (section === 'settings') {
      // v0.2.1 "- database dev: host:<glob> | mcp:<server or prefix*> | <exact host or server>" (code review M7: a
      // host pattern and an MCP server name are kept apart, and a bare name matches only exactly)
      const dev = line.match(/^\s*[-*]\s+database\s+dev\s*:\s*(.+?)\s*$/i);
      if (dev) {
        for (const x of dev[1].split(',').map(y => y.trim()).filter(Boolean)) {
          const kind = (x.match(/^(host|mcp)\s*:/i) || [])[1];
          const v = kind ? x.slice(x.indexOf(':') + 1).trim() : x;
          if (!v) out.errors.push({ line: n, message: `"${x}" names nothing` });
          else if (!kind && v.includes('*')) out.errors.push({ line: n, message: `"${x}": a pattern needs host:<pattern> (database hosts) or mcp:<prefix>* (MCP servers)` });
          else if (kind && kind.toLowerCase() === 'mcp' && v.slice(0, -1).includes('*')) out.errors.push({ line: n, message: `"${x}": mcp: takes an exact server name or a prefix ending in * (host: is for host patterns)` });
          else out.dbDev.push(kind ? `${kind.toLowerCase()}:${v}` : v);
        }
        return;
      }
      const m =line.match(/^\s*[-*]\s+([a-z-]+)\s*:\s*(.+?)\s*$/i);
      const key = m && m[1].toLowerCase();
      if (m && key === 'disable') {
        for (const id of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
          if (BUILTINS[id]) out.disabled.push(id); else out.errors.push({ line: n, message: `unknown block "${id}"` });
        }
      } else if (m && key === 'brand-skill') {
        if (SKILL_NAME.test(m[2])) { out.settings[key] = m[2]; out.explicit.push(key); }
        else out.errors.push({ line: n, message: 'brand-skill takes one skill name (letters, digits, - _ . :)' });
      } else if (m && SETTINGS[key] && SETTINGS[key].includes(m[2].toLowerCase())) {
        out.settings[key] = m[2].toLowerCase();
        out.explicit.push(key);
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
  const repoDbDev = repoText.split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 })).filter(x => /^\s*[-*]\s+database\s+dev\s*:/i.test(x.l));
  const ids = new Set(user.confirm.concat(user.never).map(r => r.id));
  // fromRepo: the project's rules.md may come from a clone; its regular expressions run last (blocklist userHits).
  const fresh = r => Object.assign({}, r, { fromRepo: true }, ids.has(r.id) ? { id: `${r.id}-repo` } : {});
  return {
    confirm: user.confirm.concat(repo.confirm.map(fresh)),
    never: user.never.concat(repo.never.map(fresh)),
    disabled: user.disabled,
    readonly: user.readonly.concat(repo.readonly), // adding a read-only source only restricts: a repo's own lines count
    dbDev: user.dbDev, // marking a database as dev relaxes the guard: only the user's own file counts (like disable:)
    settings: Object.assign({}, user.settings, Object.fromEntries(repo.explicit.map(k => [k, repo.settings[k]]))),
    errors: user.errors.map(e => Object.assign({ file: USER_LABEL }, e))
      .concat(repo.errors.map(e => Object.assign({ file: REPO_LABEL }, e)))
      .concat(repoDisable.map(x => ({ file: REPO_LABEL, line: x.n,
        message: `a project's rules.md cannot switch off built-in blocks; put "disable:" in ${USER_LABEL}` })))
      .concat(repoDbDev.map(x => ({ file: REPO_LABEL, line: x.n,
        message: `a project's rules.md cannot mark a database as dev; put "database dev:" in ${USER_LABEL}` }))),
  };
}

module.exports = { parseRules, loadRules };
