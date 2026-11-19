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
  'clickhouse', 'duckdb', 'cockroach', 'invoke-sqlcmd']);
const TEMPLATE_WORDS = new Set(['example', 'sample', 'template', 'dist']);
const WIN = process.platform === 'win32';

function reasonFor(id, plain, hard) {
  return hard
    ? `JSPARK Forge blocked: ${plain}. This is never allowed. ${STOP}`
    : `JSPARK Forge blocked: ${plain}. ${STOP} To allow ${require('./confirm').SESSION_LONG.has(id)
      ? 'these for the rest of this session' : 'it once'}, the user types: CONFIRM ${id}`;
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
  return classifyTargets(targets, cwd, ctx);
}

// Where a recursive delete points: 'hard' (home, root, a drive root), 'confirm' (outside the project, the project
// itself, its .git, or an unresolved variable), or null (inside the project). Bash and PowerShell spellings of home.
const HOME_VAR = /^(?:\$\{?HOME\}?|\$env:(?:USERPROFILE|HOME)|%USERPROFILE%)(?=[\\/]|$)/i;
const DRIVE_VAR = /^(?:\$env:SystemDrive|%SystemDrive%)(?=[\\/]|$)/i;
function classifyTargets(targets, cwd, ctx) {
  const home = norm(ctx.home), project = norm(ctx.projectDir);
  let level = null; // null | 'confirm' | 'hard'
  for (let t of targets) {
    if (t === '~' || /^~[\\/]/.test(t)) t = ctx.home + t.slice(1);
    else if (HOME_VAR.test(t)) t = ctx.home + t.replace(HOME_VAR, '');
    else if (DRIVE_VAR.test(t)) { if (t.replace(DRIVE_VAR, '').replace(/[\\/]/g, '') === '') return 'hard'; level = 'confirm'; continue; }
    else if (/[$`%]/.test(t)) { level = level || 'confirm'; continue; } // unresolved variable
    if (t === '*') t = '.';
    else if (/[\\/]\*$/.test(t)) t = t.slice(0, -2) || '/';
    else if (t.includes('*')) t = path.dirname(t);
    const r = norm(path.resolve(toFs(cwd), toFs(t)));
    if (r === home || isRoot(r)) return 'hard';
    if (r === project || r === `${project}/.git`) { level = 'confirm'; continue; }
    if (inside(r, project)) continue;
    level = 'confirm';
  }
  return level;
}

// ---------- PowerShell / cmd recursive delete (v0.1.1) ----------
// Remove-Item and its aliases (ri, rm, del, erase, rd, rmdir) with -Recurse (any unique prefix: -r, -rec, ...), and
// cmd's rd / rmdir / del / erase with /s. PowerShell does not prompt for a non-empty folder once -Recurse is given,
// so -Recurse alone counts (no -Force needed). Paths: -Path / -LiteralPath or positional; commas separate items.
const PS_REMOVE = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir']);
const PS_VALUE_PARAMS = /^-(include|exclude|filter|credential|stream)$/i;
function psRemoveCheck(args, cwd, ctx) {
  let recursive = false;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a) || /^-[a-z]*r[a-z]*f[a-z]*$/i.test(a) || /^\/s$/i.test(a)) { recursive = true; continue; }
    if (/^-(path|literalpath|lp|pspath)$/i.test(a)) { if (args[i + 1] !== undefined) targets.push(args[++i]); continue; }
    if (PS_VALUE_PARAMS.test(a)) { i++; continue; }
    if (/^-/.test(a) || /^\/[a-z]$/i.test(a)) continue; // other switches: -Force, -fo, -WhatIf, /q
    targets.push(a);
  }
  if (!recursive || !targets.length) return null;
  return classifyTargets(targets.map(psPath), cwd, ctx);
}

// PowerShell splits paths on a backslash on every system; Node on macOS/Linux does not, so normalise there.
function psPath(p) { return WIN ? p : String(p).split(String.fromCharCode(92)).join('/'); }

// ---------- files a command writes (secret-files; save trigger a) ----------
// Bash: redirects and tee. PowerShell: redirects, Set-Content / Add-Content / Out-File / Tee-Object / New-Item and
// their aliases (sc, ac, ni), by -Path / -FilePath / -LiteralPath / -Destination or the first positional argument.
const PS_WRITERS = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'tee', 'new-item', 'ni', 'copy-item', 'cp', 'copy', 'move-item', 'mv', 'move']);
const PS_PATH_PARAM = /^-(path|filepath|literalpath|lp|destination)$/i;
function stageWrites(stage, dialect) {
  const out = stage.redirects.filter(r => !/^\$null$/i.test(r)).map(r => (dialect === 'ps' ? psPath(r) : r));
  const c = shell.command(stage.words);
  if (!c) return out;
  if (c.cmd === 'tee' && dialect !== 'ps') { out.push(...c.args.filter(a => !a.startsWith('-'))); return out; }
  if (dialect === 'ps' && PS_WRITERS.has(c.cmd)) {
    const copyLike = /^(copy-item|cp|copy|move-item|mv|move)$/.test(c.cmd);
    let named = null;
    const positional = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (PS_PATH_PARAM.test(a)) { const v = c.args[++i]; if (!copyLike || /^-destination$/i.test(a)) named = v; continue; }
      if (/^-/.test(a)) { if (/^-(value|itemtype|type|encoding|inputobject)$/i.test(a)) i++; continue; }
      positional.push(a);
    }
    const target = named || (copyLike ? positional[1] : positional[0]);
    if (target) out.push(psPath(target));
  }
  return out;
}

// ---------- guest-quarantine (v0.1.1 guest mode G3; only after /jspark-forge:init --guest) ----------
// Common commands that run a reviewed repo's own code: installs (which run install scripts), builds, tests, task
// runners, containers, and the repo's own script files. Package managers are held for every subcommand except a short
// read-only list, so new subcommands are held by default. A script is held only when its file is inside the repo, so
// Claude's own scratch scripts elsewhere stay free. A seatbelt, not a sandbox: "common", never "all".
// Read-only subcommands, per tool (Fable code review M7): "check" is harmless for npm but runs build scripts for
// cargo; "list" is harmless for npm but evaluates the Gemfile for bundle. A tool not listed has none: every
// subcommand is held. Flags-only calls (--version, --help) are never held.
const PM_READ = 'info view show list ls why outdated help search config licenses whoami ping docs repo bugs version';
const READONLY_SUBS = {
  npm: `${PM_READ} audit`, pnpm: `${PM_READ} audit`, yarn: `${PM_READ} audit`, bun: PM_READ,
  pip: 'list show freeze help search check config index inspect', pip3: 'list show freeze help search check config index inspect',
  uv: 'help version tree', pipx: 'list help', poetry: 'show help about search check config env', pdm: 'list show help info config',
  conda: 'list info search help config env', mamba: 'list info search help config env', composer: 'show info help search licenses outdated why',
  gem: 'list info help search query environment specification', cargo: 'fmt tree metadata version help search pkgid locate-project',
  go: 'env fmt version doc help', dotnet: 'help --list-sdks --list-runtimes --info', deno: 'info help fmt lint doc',
  swift: 'help', mix: 'help', stack: 'help', cabal: 'help list info', mvn: '', gradle: '', ant: '', bundle: '', hatch: 'version help',
};
const PACKAGE_MANAGERS = new Set(Object.keys(READONLY_SUBS));
const PM_ALWAYS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'make', 'gmake', 'cmake', 'ninja', 'just', 'task', 'tox', 'nox', 'rake',
  'msbuild', 'pre-commit', 'pytest', 'py.test', 'jest', 'vitest', 'mocha', 'ava', 'tap', 'playwright', 'cypress',
  'eslint', 'vite', 'webpack', 'rollup', 'next', 'nuxt', 'turbo', 'nx', 'lerna', 'tsx', 'ts-node', 'gradlew', 'mvnw',
  'rspec', 'sbt', 'bazel', 'bazelisk', 'mill', 'lein', 'bats', 'phpunit', 'ctest', 'meson', 'scons']);
const DOCKER_READONLY = new Set(['ps', 'images', 'image', 'inspect', 'logs', 'version', 'info', 'stats', 'top', 'volume', 'network', 'search', 'login', 'logout', 'pull']);
const INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'nodejs', 'ruby', 'perl', 'php']);
const SCRIPT_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'source', '.']);
// Flags that take a value, so the next word is not the subcommand ("npm --loglevel info install").
const VALUE_FLAGS = /^(--loglevel|--prefix|-C|--cwd|--dir|--registry|--workspace|-w|--filter|-F|--manifest-path|--project|-p|--userconfig|--cache)$/;
const FLAGS_ONLY = /^(--version|-v|-V|--help|-h)$/;
const MAKE_DRY = /^(-n|--dry-run|--just-print|--recon|-q|--question)$/; // make only: runs nothing (pytest -q runs tests)
// python3.11 -> python, pip3.12 -> pip, node22 -> node.
const baseTool = cmd => cmd.replace(/^(python|pip|ruby|node|php|perl)\d+(\.\d+)*$/, '$1');

function insideRepo(p, cwd, ctx) {
  if (!p || /^-/.test(p)) return false;
  const r = norm(path.resolve(toFs(cwd), toFs(WIN ? p : String(p).split(String.fromCharCode(92)).join('/'))));
  const project = norm(ctx.projectDir);
  return r === project || inside(r, project);
}

function subcommandOf(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.test(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) return { sub: args[i].toLowerCase(), rest: args.slice(i + 1) };
  }
  return { sub: '', rest: [] };
}

// fromPipe: the stage reads another stage's output ("cat x.py | python").
function quarantined(cmdWord, cmd0, args, cwd, ctx, fromPipe = false) {
  const cmd = baseTool(cmd0);
  if (args.length && args.every(a => FLAGS_ONLY.test(a))) return false; // --version, --help
  if ((cmd === 'make' || cmd === 'gmake') && args.some(a => MAKE_DRY.test(a))) return false; // make -n prints, runs nothing
  const { sub, rest } = subcommandOf(args);
  if (PM_ALWAYS.has(cmd)) return true;
  if (cmd === 'docker' || cmd === 'podman' || cmd === 'docker-compose') return cmd === 'docker-compose' || (!!sub && !DOCKER_READONLY.has(sub));
  if (PACKAGE_MANAGERS.has(cmd)) {
    if (!sub) return cmd === 'yarn' || cmd === 'bundle' || cmd === 'gradle' || cmd === 'mvn'; // bare "yarn" installs
    if (sub === 'audit' && rest.includes('fix')) return true; // npm audit fix installs
    return !READONLY_SUBS[cmd].split(' ').includes(sub);
  }
  if (cmd === 'java' || cmd === 'kotlin') return args.includes('-jar') || args.some(a => /\.jar$/i.test(a) && insideRepo(a, cwd, ctx));
  if (INTERPRETERS.has(cmd)) {
    if (args.some(a => /^-(m|c|e|-eval|r|-require|-import)$/.test(a))) return true; // python -m/-c, node -e/-r
    const script = args.find(a => !a.startsWith('-'));
    if (!script) return fromPipe; // "cat x.py | python" runs whatever it is fed
    return insideRepo(script, cwd, ctx);
  }
  if (SCRIPT_SHELLS.has(cmd) && !args.includes('-c')) {
    const script = args.find(a => !a.startsWith('-'));
    return !!script && insideRepo(script, cwd, ctx);
  }
  if (PS_SHELLS.has(cmd)) {
    const i = args.findIndex(a => /^-(f|file)$/i.test(a));
    return i >= 0 && insideRepo(args[i + 1], cwd, ctx);
  }
  // The repo's own executable run by path: ./x, scripts/x.sh, .\build.ps1, gradlew.bat
  if (/[\\/]/.test(cmdWord) || /\.(sh|bash|ps1|bat|cmd|py|js|mjs|rb|pl)$/i.test(cmdWord)) return insideRepo(cmdWord, cwd, ctx);
  return false;
}

// ---------- read-only sources (v0.1.1, spec 5.2b) ----------
// rules.md "## Sources" "- readonly: <path> : <why>": an old system being migrated from. Any change is a hard deny
// (no CONFIRM); reading stays free. To allow edits, the user removes the line.
function readonlyRoots(ctx) {
  return ((ctx.rules && ctx.rules.readonly) || []).map(r => ({ r, abs: norm(path.resolve(toFs(ctx.projectDir), toFs(r.path))) }));
}
function underReadonly(p, cwd, roots) {
  if (!p || !roots.length) return null;
  const a = norm(path.resolve(toFs(cwd), toFs(p)));
  return roots.find(x => a === x.abs || inside(a, x.abs)) || null;
}
function readonlyHit(root, matched) {
  const plain = `this changes ${root.r.path}, which rules.md marks read-only${root.r.reason ? ` (${root.r.reason})` : ''}. ` +
    'There is no good reason to edit the source during a migration; to allow edits, remove its "readonly:" line from rules.md';
  return { id: 'readonly-source', hard: true, plain, reason: reasonFor('readonly-source', plain, true), matched };
}
// Every path a shell stage changes: writes (redirects, tee, PowerShell write cmdlets, copy/move destinations) plus
// deletes, moves (both ends), touch/mkdir, sed -i, and a git command that changes the work tree run with -C <path>.
const GIT_CHANGES = new Set(['commit', 'add', 'rm', 'mv', 'reset', 'checkout', 'restore', 'switch', 'clean', 'stash', 'merge',
  'rebase', 'pull', 'apply', 'am', 'cherry-pick', 'revert']);
function stageChanges(stage, dialect, cwd) {
  const out = stageWrites(stage, dialect);
  const c = shell.command(stage.words);
  if (!c) return out;
  const { cmd, args } = c;
  const plain = args.filter(a => !a.startsWith('-'));
  if (['rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'truncate', 'chmod', 'chown'].includes(cmd) && dialect !== 'ps') out.push(...plain);
  if ((cmd === 'mv' || cmd === 'move' || cmd === 'move-item') ) out.push(...plain.map(p => (dialect === 'ps' ? psPath(p) : p)));
  if ((cmd === 'cp' || cmd === 'ln') && dialect !== 'ps' && plain.length > 1) out.push(plain[plain.length - 1]);
  if (cmd === 'sed' && args.some(a => /^-i/.test(a) || a === '--in-place')) out.push(...plain.slice(1));
  if (dialect === 'ps' && (PS_REMOVE.has(cmd) || /^(rename-item|ren|rni|clear-content|clc)$/.test(cmd))) {
    for (let i = 0; i < args.length; i++) {
      if (/^-(path|literalpath|lp)$/i.test(args[i])) out.push(psPath(args[++i] || ''));
      else if (!args[i].startsWith('-') && !/^\/[a-z]$/i.test(args[i])) out.push(psPath(args[i]));
    }
  }
  if (cmd === 'git') {
    const { dir, sub } = parseGit(args, cwd);
    if (GIT_CHANGES.has(sub)) out.push(dir);
  }
  return out;
}

// ---------- icacls: the Windows form of chmod 777 (v0.1.1) ----------
const WIDE_PRINCIPALS = /^(everyone|\*s-1-1-0|users|builtin\\users|\*s-1-5-32-545|authenticated users|\*s-1-5-11)$/i;
function icaclsWide(args) {
  for (let i = 0; i < args.length; i++) {
    if (!/^\/grant(:r)?$/i.test(args[i])) continue;
    for (let j = i + 1; j < args.length && !/^\/[a-z]/i.test(args[j]); j++) {
      const k = args[j].lastIndexOf(':');
      if (k < 0) continue;
      const who = args[j].slice(0, k), rights = args[j].slice(k + 1);
      if (WIDE_PRINCIPALS.test(who) && /(^|[(,])(F|M)([),]|$)/i.test(rights.replace(/\((OI|CI|IO|NP|I)\)/gi, ''))) return true;
    }
  }
  return false;
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
// The command texts inside $( ... ) and `...` in one word ("$(npm install)" -> "npm install").
function substitutions(word) {
  const out = [];
  const s = String(word);
  for (let i = s.indexOf('$('); i >= 0; i = s.indexOf('$(', i + 2)) {
    let depth = 0, j = i + 1;
    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
    out.push(s.slice(i + 2, j));
  }
  for (const m of s.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  return out;
}

// dialect: 'bash' (Bash / Git Bash forms) or 'ps' (PowerShell and cmd forms, v0.1.1). A shell started inside a
// command (bash -c, powershell -Command, cmd /c) is checked in its own dialect.
const FETCH = new Set(['curl', 'wget']);
const PS_FETCH = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
const PS_EXEC = new Set(['iex', 'invoke-expression']);
const PS_SHELLS = new Set(['powershell', 'pwsh']);
const FETCH_TEXT = /(^|[\s(])(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b|downloadstring|downloadfile/i;

function innerScript(cmd, args) {
  if (SHELLS.has(cmd)) { const i = args.indexOf('-c'); return i >= 0 && args[i + 1] !== undefined ? { script: args[i + 1], dialect: 'bash' } : null; }
  if (PS_SHELLS.has(cmd)) {
    const i = args.findIndex(a => /^-(c|command|com|comm|comma|comman)$/i.test(a));
    return i >= 0 && i + 1 < args.length ? { script: args.slice(i + 1).join(' '), dialect: 'ps' } : null;
  }
  if (cmd === 'cmd') { const i = args.findIndex(a => /^\/[ck]$/i.test(a)); return i >= 0 && i + 1 < args.length ? { script: args.slice(i + 1).join(' '), dialect: 'ps' } : null; }
  return null;
}

function shellHits(raw, cwd, ctx, depth = 0, dialect = 'bash') {
  const hits = [];
  const ps = dialect === 'ps';
  const pipelines = shell.parse(raw, { dialect });
  let sqlClient = false;
  for (const pl of pipelines) {
    let fetchAt = -1;
    pl.forEach((stage, idx) => {
      for (const target of stageWrites(stage, dialect)) if (isSecretName(target)) hits.push(hit('secret-files', false, raw));
      if (ctx.roRoots && ctx.roRoots.length) {
        for (const p of stageChanges(stage, dialect, cwd)) { const root = underReadonly(p, cwd, ctx.roRoots); if (root) hits.push(readonlyHit(root, raw)); }
      }
      const c = shell.command(stage.words);
      if (!c) return;
      const { cmd, args } = c;
      if (SQL_CLIENTS.has(cmd)) sqlClient = true;
      if ((ps ? PS_FETCH : FETCH).has(cmd)) fetchAt = fetchAt < 0 ? idx : fetchAt;
      if (SHELLS.has(cmd) || (ps && PS_EXEC.has(cmd)) || PS_SHELLS.has(cmd)) {
        if (fetchAt >= 0 && idx > fetchAt) hits.push(hit('pipe-to-shell', false, raw));
      }
      if (SHELLS.has(cmd) && args.some(a => /^<\(\s*(curl|wget)\b/i.test(a))) hits.push(hit('pipe-to-shell', false, raw));
      if (ps && PS_EXEC.has(cmd) && args.some(a => FETCH_TEXT.test(a))) hits.push(hit('pipe-to-shell', false, raw));
      // Fable code review M7: what iex / Invoke-Expression runs is a command too ("iex 'npm ci'"); running a file's
      // contents ("iex (gc ./build.ps1 -Raw)") runs the repo's code.
      if (ps && PS_EXEC.has(cmd) && args.length && !args.some(a => FETCH_TEXT.test(a)) && depth < 3) {
        if (ctx.quarantine && args.some(a => /(^|[\s(])(gc|get-content|cat|type)\s/i.test(a))) hits.push(hit('guest-quarantine', false, raw));
        else hits.push(...shellHits(args.join(' '), cwd, ctx, depth + 1, 'ps'));
      }
      // Start-Process npm -ArgumentList install: judged as "npm install".
      if (ps && /^(start-process|saps|start)$/.test(cmd) && ctx.quarantine) {
        let exe = null; const argList = [];
        for (let i = 0; i < args.length; i++) {
          if (/^-(filepath|fi)$/i.test(args[i])) exe = args[++i];
          else if (/^-(argumentlist|args)$/i.test(args[i])) argList.push(...String(args[++i] || '').split(/[\s,]+/).filter(Boolean));
          else if (!args[i].startsWith('-')) { if (!exe) exe = args[i]; else argList.push(args[i]); }
        }
        if (exe && quarantined(exe, shell.baseName(exe), argList, cwd, ctx)) hits.push(hit('guest-quarantine', false, raw));
      }
      // Commands inside $( ... ) and backticks are commands too ("echo $(npm install)", "echo `rm -rf ~`").
      if (depth < 3) for (const w of stage.words) for (const inner of substitutions(w)) hits.push(...shellHits(inner, cwd, ctx, depth + 1, dialect));
      const inner = innerScript(cmd, args);
      if (inner) {
        if (/^\s*(\$\(|`)\s*(curl|wget)\b/i.test(inner.script)) hits.push(hit('pipe-to-shell', false, raw));
        else if (depth < 3) hits.push(...shellHits(inner.script, cwd, ctx, depth + 1, inner.dialect));
      }
      if (cmd === 'rm' && !ps) {
        const level = rmCheck(args, cwd, ctx);
        if (level) hits.push(hit('rm-rf-outside', level === 'hard', raw));
      }
      if (PS_REMOVE.has(cmd) && (ps || cmd !== 'rm')) {
        const level = psRemoveCheck(args, cwd, ctx);
        if (level) hits.push(hit('rm-rf-outside', level === 'hard', raw));
      }
      if (cmd === 'icacls' && icaclsWide(args)) hits.push(hit('chmod-wide', false, raw));
      if (ctx.quarantine && quarantined(c.word, cmd, args, cwd, ctx, idx > 0)) hits.push(hit('guest-quarantine', false, raw));
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

// Built-in hits are found first; when one exists, regular-expression rules are not run at all, so a slow pattern in a
// cloned repo's rules.md cannot time the hook out (a timed-out hook lets the command through). Plain-text rules are
// cheap and always checked, so a Never line can still harden a built-in Confirm.
// Order (Fable review H3, M4): the user's own rules (plain and regex) and the project's plain-text rules always run.
// The project's regular expressions (a cloned repo can ship a deliberately slow one) run last, only when nothing has
// matched at all, and on at most 2,000 characters: a slow pattern can then only delay a command nothing else blocks.
const REPO_REGEX_MAX = 2000;
function userHits(text, rules, { anyHit = false } = {}) {
  const hits = [];
  if (!rules) return hits;
  const lower = text.toLowerCase();
  const say = r => r.reason || `this matches your rule "${r.source}"`;
  const firstPass = r => (r.re ? !r.fromRepo && r.re.test(text) : lower.includes(r.text.toLowerCase()));
  for (const r of rules.never || []) if (firstPass(r)) hits.push(hit(r.id, true, text, say(r)));
  for (const r of rules.confirm || []) if (firstPass(r)) hits.push(hit(r.id, false, text, say(r)));
  if (anyHit || hits.length) return hits;
  const short = text.slice(0, REPO_REGEX_MAX);
  for (const r of rules.never || []) if (r.re && r.fromRepo && r.re.test(short)) hits.push(hit(r.id, true, text, say(r)));
  for (const r of rules.confirm || []) if (r.re && r.fromRepo && r.re.test(short)) hits.push(hit(r.id, false, text, say(r)));
  return hits;
}

// opts.all: return every hit (hard ones first) instead of the one to report.
function check(input, ctx, opts = {}) {
  try {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const cwd = input.cwd || ctx.projectDir;
    const disabled = new Set((ctx.rules && ctx.rules.disabled) || []);
    ctx = Object.assign({}, ctx, { roRoots: readonlyRoots(ctx) });
    let hits = [];
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
      const p = ti.file_path || ti.notebook_path || '';
      if (isSecretName(p)) hits.push(hit('secret-files', false, p));
      const root = underReadonly(p, cwd, ctx.roRoots);
      if (root) hits.push(readonlyHit(root, p));
    } else if (tool === 'Bash' || tool === 'PowerShell') {
      const raw = String(ti.command || '');
      hits = shellHits(raw, cwd, ctx, 0, tool === 'PowerShell' ? 'ps' : 'bash');
      hits = hits.concat(userHits(raw, ctx.rules, { anyHit: hits.length > 0 }));
    } else if (tool.startsWith('mcp__')) {
      const text = mcpText(ti);
      if (sqlDestructive(text)) hits.push(hit('sql-destroy', false, text));
      hits = hits.concat(userHits(text, ctx.rules, { anyHit: hits.length > 0 }));
    }
    // disable: turns a built-in off, but never its hard-deny part (home folder, whole disk, drive).
    hits = hits.filter(h => !disabled.has(h.id) || (h.hard && BUILTINS[h.id]));
    if (opts.all) return hits.filter(h => h.hard).concat(hits.filter(h => !h.hard));
    if (!hits.length) return null;
    return hits.find(h => h.hard) || hits[0];
  } catch {
    return null;
  }
}

// True when a shell command line runs `git commit` anywhere (any -C, env prefix or chained position).
function isGitCommit(raw, cwd, dialect = 'bash') {
  try {
    return shell.parse(raw, { dialect }).some(pl => pl.some(st => {
      const c = shell.command(st.words);
      return c && c.cmd === 'git' && parseGit(c.args, cwd || '.').sub === 'commit';
    }));
  } catch { return false; }
}

// Every file path a shell command line writes to (redirects, tee, PowerShell write cmdlets).
function writeTargets(raw, dialect = 'bash') {
  try { return shell.parse(raw, { dialect }).flatMap(pl => pl.flatMap(st => stageWrites(st, dialect))); } catch { return []; }
}

module.exports = { check, BUILTINS, STOP, isSecretName, isGitCommit, writeTargets, toFs };
