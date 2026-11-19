'use strict';
// The published block list (design 9.1) plus the user's rules.md lines (design 9.3).
// check(input, ctx) -> null | { id, hard, reason, plain, matched }
// ctx: { projectDir, home, rules: parsed rules.md | null, branchOf(dir) -> current git branch }
// Any internal error fails open (returns null): a broken matcher must never stop work.
const path = require('path');
const shell = require('./shell');
const BUILTINS = require('../../rules/default-blocklist.json');

const STOP = 'Do not try an equivalent command; tell the user and stop.';
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'mysqlsh', 'sqlite3', 'sqlite', 'sqlcmd', 'clickhouse-client',
  'clickhouse', 'duckdb', 'cockroach']);
const TEMPLATE_WORDS = new Set(['example', 'sample', 'template', 'dist']);
const WIN = process.platform === 'win32';

function reasonFor(id, plain, hard) {
  return hard
    ? `JSPARK Forge blocked: ${plain}. This is never allowed. ${STOP}`
    : `JSPARK Forge blocked: ${plain}. ${STOP} To allow it once, the user types: CONFIRM ${id}`;
}
function hit(id, hard, matched, plain) {
  const p = plain || (hard && BUILTINS[id] && BUILTINS[id].hardPlain) || (BUILTINS[id] && BUILTINS[id].plain) || id;
  return { id, hard: !!hard, plain: p, reason: reasonFor(id, p, hard), matched };
}

// ---------- paths ----------
function toFs(p) {
  let s = String(p);
  if (WIN) s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, (m, d) => `${d}:`); // Git Bash /c/... -> C:/...
  return s;
}
function norm(p) {
  let s = path.resolve(toFs(p)).replace(/\\/g, '/');
  if (s.length > 1 && !/^[a-zA-Z]:\/$/.test(s)) s = s.replace(/\/+$/, '');
  return WIN ? s.toLowerCase() : s;
}
const isRoot = r => r === '/' || /^[a-z]:\/?$/i.test(r);
const inside = (r, dir) => r.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

// ---------- rm -rf ----------
function rmCheck(args, cwd, ctx) {
  let recursive = false, force = false, endOpts = false;
  const targets = [];
  for (const a of args) {
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && a.startsWith('--')) {
      if (a === '--recursive') recursive = true;
      if (a === '--force') force = true;
      continue;
    }
    if (!endOpts && /^-[a-zA-Z]+$/.test(a)) {
      if (/[rR]/.test(a)) recursive = true;
      if (/f/.test(a)) force = true;
      continue;
    }
    targets.push(a);
  }
  if (!recursive || !force || !targets.length) return null;
  const home = norm(ctx.home), project = norm(ctx.projectDir);
  let level = null; // null | 'confirm' | 'hard'
  for (let t of targets) {
    if (t === '~' || t.startsWith('~/')) t = ctx.home + t.slice(1);
    else if (/^\$\{?HOME\}?(\/|$)/.test(t)) t = ctx.home + t.replace(/^\$\{?HOME\}?/, '');
    else if (/[$`]/.test(t)) { level = level || 'confirm'; continue; } // unresolved variable
    if (t === '*') t = '.';
    else if (/\/\*$/.test(t)) t = t.slice(0, -2) || '/';
    else if (t.includes('*')) t = path.dirname(t);
    const r = norm(path.resolve(toFs(cwd), toFs(t)));
    if (r === home || isRoot(r)) return 'hard';
    if (r === project || r === `${project}/.git`) { level = 'confirm'; continue; }
    if (inside(r, project)) continue;
    level = 'confirm';
  }
  return level;
}

// ---------- git ----------
function parseGit(args, cwd) {
  let dir = cwd, i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-C') { dir = path.resolve(toFs(dir), toFs(args[i + 1] || '.')); i += 2; continue; }
    if (a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') { i += 2; continue; }
    i++;
  }
  return { dir, sub: (args[i] || '').toLowerCase(), rest: args.slice(i + 1) };
}

const MAIN = new Set(['main', 'master']);
function pushForceMain(rest, dir, ctx) {
  const VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
  let force = false, all = false;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (VALUE_OPTS.has(a)) { i++; continue; }
    if (a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) { force = true; continue; }
    if (a === '--all' || a === '--mirror' || a === '--branches') { all = true; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const refspecs = positional.slice(1);
  const plus = refspecs.filter(r => r.startsWith('+'));
  if (!force && !plus.length) return false;
  if (all) return true;
  const considered = force ? refspecs : plus;
  const dsts = considered.length ? considered.map(r => r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '')) : ['HEAD'];
  return dsts.some(d => MAIN.has((d === 'HEAD' || d === '' ? ctx.branchOf(dir) : d).toLowerCase()));
}

function wholeTree(rest, dir, ctx) {
  const atRoot = norm(dir) === norm(ctx.projectDir);
  return rest.some(a => a === ':/' || a === ':/.' || ((a === '.' || a === './') && atRoot));
}

function gitCheck(args, cwd, ctx) {
  const { dir, sub, rest } = parseGit(args, cwd);
  if (sub === 'push' && pushForceMain(rest, dir, ctx)) return 'git-force-push-main';
  if (sub === 'reset' && rest.includes('--hard')) return 'git-reset-hard';
  if ((sub === 'checkout' || sub === 'restore') && wholeTree(rest, dir, ctx)) return 'git-reset-hard';
  if (sub === 'clean') {
    if (rest.includes('-n') || rest.includes('--dry-run')) return null;
    let flags = '';
    for (const a of rest) { if (a === '--force') flags += 'f'; else if (/^-[a-zA-Z]+$/.test(a)) flags += a.slice(1); }
    if (flags.includes('f') && flags.includes('d') && flags.includes('x')) return 'git-clean-fdx';
  }
  if (sub === 'stash' && (rest[0] === 'drop' || rest[0] === 'clear')) return 'git-stash-drop';
  return null;
}

// ---------- SQL ----------
function sqlDestructive(text) {
  for (const stmt of String(text).split(';')) {
    if (/\bdrop\s+(table|database|schema)\b/i.test(stmt)) return true;
    if (/\btruncate\s+(table\s+)?["'`\w]/i.test(stmt)) return true;
    if (/\bdelete\s+from\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)) return true;
  }
  return false;
}

// ---------- secret files ----------
function isSecretName(p) {
  const b = String(p).split(/[\\/]/).pop().toLowerCase();
  if (!b) return false;
  if (b.split('.').some(part => TEMPLATE_WORDS.has(part))) return false;
  return b.startsWith('.env') || b.endsWith('.pem') || b.endsWith('.key') || b.startsWith('id_rsa') ||
    b.includes('credentials') || b.includes('secret');
}

// ---------- shell commands ----------
function shellHits(raw, cwd, ctx, depth = 0) {
  const hits = [];
  const pipelines = shell.parse(raw);
  let sqlClient = false;
  for (const pl of pipelines) {
    let fetchAt = -1;
    pl.forEach((stage, idx) => {
      for (const target of stage.redirects) if (isSecretName(target)) hits.push(hit('secret-files', false, raw));
      const c = shell.command(stage.words);
      if (!c) return;
      const { cmd, args } = c;
      if (SQL_CLIENTS.has(cmd)) sqlClient = true;
      if (cmd === 'curl' || cmd === 'wget') fetchAt = fetchAt < 0 ? idx : fetchAt;
      if (SHELLS.has(cmd)) {
        if (fetchAt >= 0 && idx > fetchAt) hits.push(hit('pipe-to-shell', false, raw));
        if (args.some(a => /^<\(\s*(curl|wget)\b/i.test(a))) hits.push(hit('pipe-to-shell', false, raw));
        const ci = args.indexOf('-c');
        if (ci >= 0 && args[ci + 1] !== undefined) {
          const script = args[ci + 1];
          if (/^\s*(\$\(|`)\s*(curl|wget)\b/i.test(script)) hits.push(hit('pipe-to-shell', false, raw));
          else if (depth < 3) hits.push(...shellHits(script, cwd, ctx, depth + 1));
        }
      }
      if (cmd === 'tee') for (const a of args) if (!a.startsWith('-') && isSecretName(a)) hits.push(hit('secret-files', false, raw));
      if (cmd === 'rm') {
        const level = rmCheck(args, cwd, ctx);
        if (level) hits.push(hit('rm-rf-outside', level === 'hard', raw));
      }
      if (cmd === 'git') { const id = gitCheck(args, cwd, ctx); if (id) hits.push(hit(id, false, raw)); }
      if (cmd === 'chmod' && args.some(a => /^0?777$/.test(a) || a === '--recursive' || /^-[a-zA-Z]*R[a-zA-Z]*$/.test(a))) {
        hits.push(hit('chmod-wide', false, raw));
      }
    });
  }
  if (sqlClient && sqlDestructive(raw)) hits.push(hit('sql-destroy', false, raw));
  return hits;
}

function mcpText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return Object.values(v).map(mcpText).join('\n');
  return String(v);
}

function userHits(text, rules) {
  const hits = [];
  if (!rules) return hits;
  const lower = text.toLowerCase();
  const matches = r => (r.re ? r.re.test(text) : lower.includes(r.text.toLowerCase()));
  for (const r of rules.never || []) if (matches(r)) hits.push(hit(r.id, true, text, r.reason || `this matches your rule "${r.source}"`));
  for (const r of rules.confirm || []) if (matches(r)) hits.push(hit(r.id, false, text, r.reason || `this matches your rule "${r.source}"`));
  return hits;
}

function check(input, ctx) {
  try {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const cwd = input.cwd || ctx.projectDir;
    const disabled = new Set((ctx.rules && ctx.rules.disabled) || []);
    let hits = [];
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
      const p = ti.file_path || ti.notebook_path || '';
      if (isSecretName(p)) hits.push(hit('secret-files', false, p));
    } else if (tool === 'Bash' || tool === 'PowerShell') {
      const raw = String(ti.command || '');
      hits = shellHits(raw, cwd, ctx).concat(userHits(raw, ctx.rules));
    } else if (tool.startsWith('mcp__')) {
      const text = mcpText(ti);
      if (sqlDestructive(text)) hits.push(hit('sql-destroy', false, text));
      hits = hits.concat(userHits(text, ctx.rules));
    }
    // disable: turns a built-in off, but never its hard-deny part (home folder, whole disk, drive).
    hits = hits.filter(h => !disabled.has(h.id) || (h.hard && BUILTINS[h.id]));
    if (!hits.length) return null;
    return hits.find(h => h.hard) || hits[0];
  } catch {
    return null;
  }
}

// True when a shell command line runs `git commit` anywhere (any -C, env prefix or chained position).
function isGitCommit(raw, cwd) {
  try {
    return shell.parse(raw).some(pl => pl.some(st => {
      const c = shell.command(st.words);
      return c && c.cmd === 'git' && parseGit(c.args, cwd || '.').sub === 'commit';
    }));
  } catch { return false; }
}

module.exports = { check, BUILTINS, STOP, isSecretName, isGitCommit, toFs };
