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

// A refused build-graph line is most often a step report written through the shell: name the route that is allowed,
// or Claude stops the build (integration 2026-11-20).
const FORGE_ROUTE = 'Do not try an equivalent command. If you were reporting a build-graph step: write its report file ' +
  'with the Write tool, then run the graph done command that graph next printed, as a command of its own. Otherwise ' +
  'tell the user and stop.';
function reasonFor(id, plain, hard) {
  if (id === 'forge-state') return `JSPARK Forge blocked: ${plain}. This is never allowed. ${FORGE_ROUTE}`;
  return hard
    ? `JSPARK Forge blocked: ${plain}. This is never allowed. ${STOP}`
    : `JSPARK Forge blocked: ${plain}. ${STOP} To allow ${require('./confirm').SESSION_LONG.has(id)
      ? 'these for the rest of this session' : 'it once'}, the user types: CONFIRM ${id}`;
}
// ask: Claude Code's own permission prompt, with no CONFIRM (forge-state's text matches; owner's rule 2026-11-20).
function hit(id, hard, matched, plain, ask = false) {
  const p = plain || (hard && BUILTINS[id] && BUILTINS[id].hardPlain) || (BUILTINS[id] && BUILTINS[id].plain) || id;
  if (ask && !hard) return { id, hard: false, ask: true, plain: p, reason: `JSPARK Forge: ${p}. ${FORGE_ROUTE}`, matched };
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
  const project = norm(ctx.repoRoot || ctx.projectDir); // the whole repo, also from a subfolder session
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
  if (cmd === 'docker' || cmd === 'podman' || cmd === 'docker-compose') {
    if (cmd === 'docker-compose') return true;
    if (sub === 'image') return /^(build|load|import)$/i.test(rest[0] || ''); // "docker image build ."
    return !!sub && !DOCKER_READONLY.has(sub);
  }
  if (PACKAGE_MANAGERS.has(cmd)) {
    if (!sub) return cmd === 'yarn' || cmd === 'bundle' || cmd === 'gradle' || cmd === 'mvn'; // bare "yarn" installs
    if ((cmd === 'conda' || cmd === 'mamba') && sub === 'env') return !/^(list|export|config)$/i.test(rest[0] || ''); // "env create" installs
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
    return script ? insideRepo(script, cwd, ctx) : fromPipe; // "cat build.sh | bash" runs what it is fed
  }
  if (PS_SHELLS.has(cmd)) {
    if (args.some(a => /^-(c|command|com|comm|comma|comman|encodedcommand|e|ec)$/i.test(a))) return false; // checked as a script
    const i = args.findIndex(a => /^-(f|file)$/i.test(a));
    const script = i >= 0 ? args[i + 1] : args.find(a => !a.startsWith('-')); // "pwsh build.ps1": -File is the default
    return script ? insideRepo(script, cwd, ctx) : fromPipe;
  }
  if (PS_EXEC.has(cmd) && !args.length) return fromPipe; // "gc build.ps1 | iex"
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

// ---------- database guard (v0.2.1, spec 5.2c; Fable code review H1, M7) ----------
// A write to a production database needs CONFIRM db-write. A write is every statement that is not a read: the guard
// lists the reads (SELECT, WITH ... SELECT, EXPLAIN, SHOW, DESCRIBE, ...) and holds everything else, so a write
// nobody listed is held, not passed. String literals and comments are removed first and only the SQL that goes to
// the client (its -c / -e / -Query ... argument) is read, so text elsewhere in the line never decides. A script file,
// a stdin redirect or a pipe into a remote client is unknown content: held. Production = every database MCP server
// and every client connection to a host that is not local (an unresolved variable, a service name or a login path is
// not local), unless the USER's rules.md names every host or the server as dev ("- database dev: host:<glob> |
// mcp:<server or prefix*> | <exact host or server>", rules.dbDev; a project's own line is ignored). A seatbelt: SQL
// inside a stored procedure is not seen.

// SQL with string literals, quoted identifiers and comments blanked out. MySQL runs /*! ... */, so its text is kept.
// One pass, every character read once (patterns run on every command; no backtracking on the input).
function sqlStrip(text) {
  const s = String(text);
  let out = '';
  const dollar = /\$([A-Za-z_]\w{0,62})?\$/y;
  for (let i = 0; i < s.length;) {
    const c = s[i], n = s[i + 1];
    if (c === '-' && n === '-') { const k = s.indexOf('\n', i); i = k < 0 ? s.length : k; continue; }
    if (c === '/' && n === '*') {
      if (s[i + 2] === '!') { out += ' '; i += 3; while (i < s.length && /\d/.test(s[i])) i++; continue; }
      const k = s.indexOf('*/', i + 2); out += ' '; i = k < 0 ? s.length : k + 2; continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; }
      out += " '' "; i = j + 1; continue;
    }
    if (c === '"' || c === '`') { const k = s.indexOf(c, i + 1); out += ' q '; i = k < 0 ? s.length : k + 1; continue; }
    if (c === '$') {
      dollar.lastIndex = i;
      const m = dollar.exec(s);
      if (m) { const k = s.indexOf(m[0], i + m[0].length); out += " '' "; i = k < 0 ? s.length : k + m[0].length; continue; }
    }
    out += c; i++;
  }
  return out;
}

// Words that make a read statement (SELECT, WITH, VALUES, EXPLAIN ANALYZE) change data: SELECT ... INTO, a
// data-modifying CTE, a second statement without a semicolon (T-SQL), and functions with side effects.
const SQL_WRITE_WORD = /\b(insert|update|delete|merge|upsert|into|create|alter|drop|truncate|grant|revoke|exec|execute|call)\b/i;
const SQL_SIDE_EFFECT = /\b(setval|nextval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_drop_replication_slot|pg_create_\w+|pg_file_\w+|lo_unlink|lo_import|lo_export|lo_create|dblink\w*|cron\.\w+)\s*\(/i;
const SQL_READ_FIRST = new Set(['show', 'describe', 'desc', 'help', 'use', 'begin', 'commit', 'rollback', 'end', 'savepoint',
  'release', 'abort', 'listen', 'unlisten', 'fetch', 'close', 'discard']);
const READ_PRAGMA = /^pragma\s+(\w+\.)?(table_info|table_xinfo|table_list|index_list|index_info|index_xinfo|foreign_key_list|foreign_key_check|database_list|compile_options|collation_list|function_list|module_list|pragma_list|integrity_check|quick_check|user_version|schema_version|application_id|page_count|page_size|freelist_count|data_version|journal_mode|encoding|foreign_keys)\b[^=]*$/i;
// psql / mysql meta-commands that run a file, a shell or generated SQL.
const META_WRITE = /\\(gexec|ir?|include(_relative)?|!|\.|lo_import|lo_unlink)(?![a-z_])/i;

function stmtWrites(stmt) {
  const t = stmt.replace(/^[\s(]+/, '');
  if (!t) return false;
  if (META_WRITE.test(t)) return true;
  if (t[0] === '\\') return /^\\copy\b/i.test(t) && (!/\bto\b/i.test(t) || /\bfrom\s+(stdin|pstdin|'')/i.test(t));
  if (t[0] === '.') return /^\.(read|import|restore|load|shell|system|clone)\b/i.test(t); // sqlite / duckdb dot-commands
  const m = t.match(/^[a-z_]+/i);
  if (!m) return true; // not a statement we can read ("$SQL"): unknown, so held
  const k = m[0].toLowerCase();
  const body = t.replace(/\bfor\s+(no\s+key\s+)?(update|share)\b/gi, ' ');
  if (k === 'select' || k === 'with' || k === 'values' || k === 'table') return SQL_WRITE_WORD.test(body) || SQL_SIDE_EFFECT.test(body);
  if (k === 'explain') return /\banaly[sz]e\b/i.test(t) && (SQL_WRITE_WORD.test(body) || SQL_SIDE_EFFECT.test(body)); // plain EXPLAIN runs nothing
  if (SQL_READ_FIRST.has(k)) return false;
  if (k === 'start') return !/^start\s+transaction\b/i.test(t);
  if (k === 'set') return /^set\s+(global|persist|persist_only|password|@@global|@@persist)\b/i.test(t);
  if (k === 'pragma') return !READ_PRAGMA.test(t);
  if (k === 'copy') return !/\bto\s+stdout\b/i.test(t) || /\bfrom\s+(stdin|program)\b/i.test(t);
  return true;
}
const sqlWrites = text => sqlStrip(text).split(';').some(stmtWrites);

const MONGO_WRITE = /\.\s*(insert\w*|update\w*|delete\w*|drop\w*|remove\w*|replaceOne|bulkWrite|save|create\w*|rename\w*|findOneAnd\w+|findAndModify|runCommand|adminCommand|grant\w*|revoke\w*|shardCollection|compact|initialize\w*BulkOp)\s*\(|\$(out|merge)\b|\bload\s*\(/;
const REDIS_READ = new Set(('get mget hget hgetall hmget hkeys hvals hlen hexists hstrlen hscan keys scan sscan zscan exists ttl pttl ' +
  'type info ping dbsize lrange llen lindex smembers sismember smismember scard srandmember zrange zrangebyscore zrevrange ' +
  'zrevrangebyscore zrangebylex zcard zscore zmscore zrank zrevrank zcount zlexcount strlen getrange getbit bitcount bitpos ' +
  'xrange xrevrange xlen xinfo time echo lastsave role randomkey pfcount geopos geodist geohash geosearch json.get json.type ' +
  'json.mget ft.search ft.info memory').split(' '));
const REDIS_READ_SUB = /^(config|slowlog|client|cluster|object|command|acl|latency|pubsub)\s+(get|list|info|nodes|slots|shards|myid|encoding|freq|idletime|refcount|count|docs|whoami|getuser|users|cat|latest|history|len|channels|numsub|numpat|getname|id)\b/i;
function redisWrites(words) {
  const w = words.map(x => String(x).trim()).filter(Boolean);
  if (!w.length) return false;
  return !REDIS_READ.has(w[0].toLowerCase()) && !REDIS_READ_SUB.test(w.slice(0, 2).join(' '));
}

// A host name as written ('tcp:db,1433', '[::1]:5432', '(localdb)\x') reduced to the name.
function hostName(h) {
  let s = String(h).trim().replace(/^['"]|['"]$/g, '').toLowerCase().replace(/^tcp:/, '');
  s = s.split('\\')[0];
  const v6 = s.match(/^\[(.+)\](:\d+)?$/);
  if (v6) return v6[1];
  if ((s.match(/:/g) || []).length === 1) s = s.split(':')[0];
  return s;
}
const isVar = s => /[$%`]/.test(String(s)); // $VAR, ${VAR}, $env:VAR, %VAR%: unknown, so production
function hostLocal(h) {
  const raw = String(h).trim().replace(/^['"]|['"]$/g, '');
  if (isVar(raw)) return false;
  if (raw.startsWith('/')) return !/\/cloudsql\//i.test(raw); // a Unix socket directory; a Cloud SQL socket is remote
  const s = hostName(raw);
  return s === '' || s === '.' || s === 'localhost' || s === '(local)' || s === '(localdb)' || s === '::1' ||
    s === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s) || /\.localhost$/.test(s);
}
function urlHost(u) {
  const m = String(u).match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?]*@)?(\[[^\]]+\]|[^/?]*)/i);
  if (!m) return null;
  // postgres://a,b:5433/db lists hosts; keep the commas, drop the ports (an IPv6 [..] stays whole)
  return m[1].startsWith('[') ? m[1] : m[1].split(',').map(x => x.replace(/:\d*$/, '')).join(',');
}

// How each client takes its SQL (sql), a script file (file), its server (host), a connection string or URL (conn),
// options with a value (value), and options that name a connection we cannot see (unknown: --login-path).
const PG_CLIENT = { sql: ['-c', '--command'], file: ['-f', '--file'], host: ['-h', '--host'], conn: ['-d', '--dbname'],
  value: ['-p', '--port', '-U', '--username', '-v', '--set', '--variable', '-o', '--output', '-L', '--log-file', '-P', '--pset',
    '-F', '--field-separator', '-R', '--record-separator', '-T', '--table-attr'], uriPositional: true };
const MY_CLIENT = { sql: ['-e', '--execute'], file: [], host: ['-h', '--host'], conn: [], unknown: ['--login-path'],
  value: ['-u', '--user', '-P', '--port', '-D', '--database', '-S', '--socket', '--defaults-file', '--defaults-extra-file', '--protocol'] };
const CH_CLIENT = { sql: ['-q', '--query'], file: ['--queries-file'], host: ['-h', '--host'], conn: [],
  value: ['--port', '-u', '--user', '--password', '-d', '--database'] };
const MONGO_CLIENT = { sql: ['--eval'], file: ['-f', '--file'], host: ['--host'], conn: [], mongo: true, uriPositional: true,
  value: ['--port', '-u', '--username', '-p', '--password', '--authenticationDatabase', '--tlsCAFile', '--tlsCertificateKeyFile', '--apiVersion'] };
const REDIS_CLIENT = { sql: [], file: [], host: ['-h'], conn: ['-u'], redis: true, value: ['-p', '-a', '-n', '--user', '--pass', '-s', '-r', '-i', '-d'] };
const LITE_CLIENT = { sql: ['-cmd'], file: ['-init'], host: [], conn: [], positionalSql: true,
  value: ['-separator', '-newline', '-nullvalue', '-vfs', '-maxsize', '-mmap', '-lookaside', '-pagecache'] };
const DB_CLIENT_SPECS = {
  psql: PG_CLIENT, pgcli: PG_CLIENT, usql: PG_CLIENT,
  pg_restore: { sql: [], file: [], host: ['-h', '--host'], conn: ['-d', '--dbname'], restore: true,
    value: ['-p', '--port', '-U', '--username', '-f', '--file', '-j', '--jobs', '-n', '--schema', '-t', '--table', '-I', '--index',
      '-P', '--function', '-T', '--trigger', '-L', '--use-list', '-S', '--superuser', '--role', '-F', '--format'] },
  mysql: MY_CLIENT, mariadb: MY_CLIENT, mycli: Object.assign({}, MY_CLIENT, { uriPositional: true }),
  mysqlsh: Object.assign({}, MY_CLIENT, { file: ['-f', '--file'], uriPositional: true, atHost: true }),
  'clickhouse-client': CH_CLIENT, clickhouse: CH_CLIENT,
  cockroach: { sql: ['-e', '--execute'], file: ['-f', '--file'], host: ['--host'], conn: ['--url'],
    value: ['--port', '-p', '--user', '-u', '--database', '-d', '--certs-dir'] },
  sqlcmd: { sql: ['-Q', '-q'], file: ['-i'], host: ['-S'], conn: [], value: ['-U', '-P', '-d', '-o', '-s', '-w', '-h', '-t', '-l', '-v', '-f'] },
  'invoke-sqlcmd': { ci: true, sql: ['-query'], file: ['-inputfile'], host: ['-serverinstance'], conn: ['-connectionstring'], positionalSql: true,
    value: ['-database', '-username', '-password', '-credential', '-hostname', '-querytimeout', '-connectiontimeout', '-variable',
      '-encrypt', '-accesstoken', '-applicationname', '-maxcharlength', '-maxbinarylength', '-outputas'] },
  sqlite3: LITE_CLIENT, sqlite: LITE_CLIENT,
  duckdb: Object.assign({}, LITE_CLIENT, { sql: ['-c', '-cmd'], file: ['-init', '-f'] }),
  mongosh: MONGO_CLIENT, mongo: MONGO_CLIENT,
  'redis-cli': REDIS_CLIENT, 'valkey-cli': REDIS_CLIENT,
};
const GENERIC_CONN = ['--url', '--uri', '--db-url', '--connection-string', '-connectionstring'];

function clientArgs(spec, args) {
  const r = { sql: [], file: false, hosts: [], conn: [], positional: [], other: [], unknown: false };
  const has = (list, o) => (list || []).includes(o);
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const long = a.match(/^(--[\w-]+)=([\s\S]*)$/);
    const opt = long ? long[1] : (spec.ci ? a.toLowerCase() : a);
    const optValue = () => (long ? long[2] : args[++i]); // SQL may start with "-" ("-- a comment")
    const plainValue = () => { // "-p" without a value must not swallow the next option
      if (long) return long[2];
      const nx = args[i + 1];
      if (nx === undefined || (String(nx).startsWith('-') && String(nx).length > 1)) return undefined;
      return args[++i];
    };
    if (has(spec.sql, opt)) { const v = optValue(); if (v !== undefined) r.sql.push(String(v)); continue; }
    if (has(spec.file, opt)) { optValue(); r.file = true; continue; }
    if (has(spec.host, opt)) { const v = plainValue(); if (v !== undefined) r.hosts.push(String(v)); continue; }
    if (has(spec.conn, opt) || has(GENERIC_CONN, opt.toLowerCase())) { const v = plainValue(); if (v !== undefined) r.conn.push(String(v)); continue; }
    if (has(spec.unknown, opt)) { r.unknown = true; plainValue(); continue; }
    if (has(spec.value, opt)) { plainValue(); continue; }
    if (!spec.ci && /^-[a-zA-Z]./.test(a) && !a.startsWith('--')) { // attached short forms: -e"..." -hprod
      const o = a.slice(0, 2);
      if (has(spec.sql, o)) { r.sql.push(a.slice(2)); continue; }
      if (has(spec.host, o)) { r.hosts.push(a.slice(2)); continue; }
    }
    if (a.startsWith('-') && a.length > 1) { r.other.push(a); continue; }
    r.positional.push(a);
  }
  return r;
}

const DB_ENV = /^(PGHOST|PGHOSTADDR|PGSERVICE|MYSQL_HOST|DATABASE_URL|MONGODB_URI|POSTGRES_URL)$/i;
function addHosts(t, v) {
  if (isVar(v)) { t.unknown = true; t.hosts.push(String(v)); return; }
  for (const part of String(v).split(',')) if (!/^\s*\d+\s*$/.test(part)) t.hosts.push(part); // "host,1433": a port
}
// A connection string, URL or conninfo ("host=db dbname=x", "Server=db;...", "service=prod"), or a database name.
function connInfo(t, v, spec, asUri) {
  const s = String(v);
  if (/^(md|motherduck):/i.test(s)) { t.hosts.push('motherduck.com'); return; }
  const u = urlHost(s);
  if (u !== null) { addHosts(t, u); return; }
  let found = false;
  if (/(^|[\s;])service\s*=/i.test(s)) { t.unknown = true; found = true; }
  const re = /(?:^|[\s;])(?:host|hostaddr|server|data source|address|addr)\s*=\s*([^\s;'"]+)/gi;
  let m;
  while ((m = re.exec(s))) { addHosts(t, m[1]); found = true; }
  if (found || !asUri) return;
  if (isVar(s)) { t.unknown = true; return; }
  if (spec.mongo && (m = s.match(/^([^\s/:@]+)(?::\d+)?\//) || s.match(/^([^\s/:@]+):\d+$/))) addHosts(t, m[1]);
  else if (spec.atHost && (m = s.match(/@([^\s/:@]+)/))) addHosts(t, m[1]);
}
// Every host a client command connects to: { hosts, unknown }. env: the stage's own prefix and earlier exports.
function clientTarget(spec, p, words, ctx) {
  const t = { hosts: [], unknown: p.unknown };
  const env = Object.assign({}, ctx.dbEnv || {});
  for (const w of words) { const m = String(w).match(/^([A-Za-z_]\w*)=([\s\S]*)$/); if (m && DB_ENV.test(m[1])) env[m[1].toUpperCase()] = m[2]; }
  for (const [k, v] of Object.entries(env)) {
    if (k === 'PGSERVICE') { t.unknown = true; continue; }
    if (k === 'PGHOST' || k === 'PGHOSTADDR' || k === 'MYSQL_HOST') { addHosts(t, v); continue; }
    if (isVar(v)) { t.unknown = true; continue; }
    const u = urlHost(v);
    if (u !== null) addHosts(t, u);
  }
  for (const h of p.hosts) addHosts(t, h);
  for (const c of p.conn) connInfo(t, c, spec, true);
  const candidates = spec.redis ? [] : spec.positionalSql ? (spec.ci ? [] : p.positional.slice(0, 1)) : p.positional;
  for (const c of candidates) connInfo(t, c, spec, !!spec.uriPositional);
  return t;
}

// Shell assignments that later commands in the same line inherit: "export PGHOST=x", "PGHOST=x" alone, cmd's
// "set PGHOST=x", PowerShell's "$env:PGHOST = 'x'". A prefix ("PGHOST=x psql") is read from the stage itself.
function noteDbEnv(stage, ctx) {
  const w = stage.words;
  if (!w.length) return;
  let list = [];
  const ps = String(w[0]).match(/^\$env:(\w+)(?:=([\s\S]*))?$/i);
  if (ps) list = [[ps[1], ps[2] !== undefined ? ps[2] : (w[1] === '=' ? w[2] : undefined)]];
  else {
    const assigns = /^(export|set|declare|typeset|local|readonly)$/i.test(w[0]) ? w.slice(1) : w.every(x => /^[A-Za-z_]\w*=/.test(x)) ? w : [];
    list = assigns.map(x => String(x).match(/^([A-Za-z_]\w*)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], m[2]]);
  }
  for (const [k, v] of list) if (DB_ENV.test(k) && v !== undefined) (ctx.dbEnv || (ctx.dbEnv = {}))[k.toUpperCase()] = v;
}

// The SQL a stage pipes into the next one when it is plain text we can read: echo / printf / Write-Output, or a
// PowerShell string on its own ("'SELECT 1;' | psql"). null: unknown content (a file, a command's output).
function literalFeed(st, dialect) {
  if (!st || st.input || (st.subs && st.subs.length)) return null;
  if (dialect === 'ps' && st.words.length === 1 && /\s/.test(st.words[0])) return st.words[0];
  const c = shell.command(st.words);
  if (!c || !/^(echo|printf|write-output)$/.test(c.cmd)) return null;
  return c.args.filter(a => !/^-[neE]+$/.test(a)).join(' ');
}

const devPatterns = ctx => ((ctx.rules && ctx.rules.dbDev) || []).map(p => String(p).trim()).filter(Boolean);
const globRe = p => new RegExp(`^${p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
// A host is dev when a "host:<glob>" pattern or a bare exact name matches its host name.
function devHost(ctx, h) {
  const name = hostName(h);
  if (!name || isVar(h)) return false;
  return devPatterns(ctx).some(p => {
    if (/^host:/i.test(p)) return globRe(p.slice(5).trim().toLowerCase()).test(name);
    if (/^mcp:/i.test(p)) return false;
    return p.toLowerCase() === name;
  });
}
// An MCP server is dev when "mcp:<name>" or a bare pattern names it exactly, or "mcp:<prefix>*" starts it.
function devServer(ctx, server) {
  const s = String(server).toLowerCase();
  return devPatterns(ctx).some(p => {
    if (/^host:/i.test(p)) return false;
    const v = (/^mcp:/i.test(p) ? p.slice(4) : p).trim().toLowerCase();
    if (/^mcp:/i.test(p) && v.endsWith('*')) return s.startsWith(v.slice(0, -1));
    return v === s;
  });
}

// Is this pipeline stage a write to a production database? A stage after a pipe reads the stage before it.
function dbStageWrite(stage, pl, idx, dialect, ctx) {
  const c = shell.command(stage.words);
  const spec = c && DB_CLIENT_SPECS[c.cmd];
  if (!spec) return false;
  const p = clientArgs(spec, c.args);
  const t = clientTarget(spec, p, stage.words, ctx);
  const remote = t.hosts.filter(h => !hostLocal(h));
  if (!t.unknown && !remote.length) return false; // local
  if (!t.unknown && remote.every(h => devHost(ctx, h))) return false; // every host is a dev host
  if (spec.restore) return p.conn.length > 0; // pg_restore -d writes; without -d it prints a script
  if (p.file) return true; // a script file: unknown content
  if (spec.mongo && p.positional.some(a => /\.js$/i.test(a))) return true;
  const texts = p.sql.slice();
  if (spec.positionalSql) texts.push(...p.positional.slice(spec.ci ? 0 : 1));
  let stdin = !!stage.input || idx > 0;
  if (idx > 0 && !stage.input) { const lit = literalFeed(pl[idx - 1], dialect); if (lit !== null) { texts.push(lit); stdin = false; } }
  if (spec.redis) {
    return stdin || p.other.some(o => o === '-x' || o === '--pipe') || redisWrites(p.positional) ||
      texts.some(x => x.split(/\r?\n/).some(line => redisWrites(line.split(/\s+/))));
  }
  if (stdin && !p.sql.length) return true; // a redirect, heredoc or pipe: unknown content (-c / -e ignore stdin)
  if (spec.mongo) return texts.some(x => MONGO_WRITE.test(x));
  return texts.some(sqlWrites);
}

// supabase / prisma, also run through npx, pnpm dlx, bunx ...
const DB_WRAPPERS = new Set(['npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'npm', 'bun', 'dlx', 'exec']);
function dbCliWrite(cmd0, args0) {
  let cmd = cmd0, args = args0;
  if (DB_WRAPPERS.has(cmd)) {
    const i = args.findIndex(a => /^(prisma|supabase)$/.test(shell.baseName(a)));
    if (i < 0) return null;
    cmd = shell.baseName(args[i]); args = args.slice(i + 1);
  }
  if (cmd !== 'prisma' && cmd !== 'supabase') return null;
  const pos = args.filter(a => !a.startsWith('-'));
  const sub = `${pos[0] || ''} ${pos[1] || ''}`;
  // prisma reads its database from the schema or .env: never known to be dev. "migrate dev" uses a dev database.
  if (cmd === 'prisma') return /^(db push|db execute|migrate deploy|migrate resolve|migrate reset)$/.test(sub) ? { tool: 'prisma', host: null } : null;
  let dbUrl = null;
  args.forEach((a, i) => { if (a === '--db-url') dbUrl = args[i + 1]; else if (a.startsWith('--db-url=')) dbUrl = a.slice(9); });
  const urlH = dbUrl === null ? null : (urlHost(dbUrl) ?? dbUrl);
  const remoteUrl = dbUrl !== null && !hostLocal(urlH);
  const localOnly = args.includes('--local') || (dbUrl !== null && !remoteUrl);
  const toRemote = args.includes('--linked') || remoteUrl;
  const held = { tool: 'supabase', host: remoteUrl && !args.includes('--linked') ? urlH : null };
  if (sub === 'db push' || sub === 'migration repair') return localOnly ? null : held; // remote unless told otherwise
  if (sub === 'db reset' || sub === 'migration up') return toRemote ? held : null; // local unless told otherwise
  return null;
}

// Database MCP tools. A tool is a write when its name says so (insert, update, delete, put, set, drop, write, merge,
// reset, restore, apply ... and the Redis / DynamoDB / MongoDB write verbs), when it creates a database object, when
// a pipeline writes ($out, $merge), or when it runs a statement (execute, query, sql, command ...) that is not a read.
const DB_SERVER = /supabase|postgres|pgsql|mysql|maria|sqlite|mongo|database|neon|planetscale|turso|cockroach|clickhouse|duckdb|snowflake|bigquery|dynamo|redis|valkey|firebase|firestore|prisma|cassandra|oracle|mssql|sqlserver|libsql|upstash|xata|convex|(^|[^a-z])(db|sql|pg)([^a-z]|$)/i;
const TOOL_WRITE = new Set(('insert update delete del drop put set write remove upsert truncate rename replace bulk flush flushall ' +
  'flushdb incr incrby incrbyfloat decr decrby expire expireat pexpire persist lpush rpush lpushx rpushx lpop rpop lset ltrim lrem ' +
  'linsert sadd srem spop smove zadd zrem zincrby zpopmin zpopmax hset hsetnx hmset hdel hincrby mset msetnx setex setnx psetex ' +
  'append getdel getset xadd xdel xtrim unlink restore reset rebase merge migrate apply modify import load alter grant revoke ' +
  'push pop save patch add').split(' '));
const DB_OBJECTS = new Set('table tables collection collections index indexes database schema view user role function procedure trigger type extension sequence policy keyspace'.split(' '));
const RUN_WORDS = new Set('sql query execute exec run command statement eval script raw cypher'.split(' '));
const STRONG_RUN = new Set('sql execute exec run command statement eval script raw'.split(' '));
const SQL_FIELD = /^(sql|query|queries|statement|statements|command|commands|script|q|eval|code|cypher)$/i;
const toolWords = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
function fieldTexts(v, out = [], depth = 0) {
  if (!v || typeof v !== 'object' || depth > 6) return out;
  for (const [k, x] of Object.entries(v)) {
    if (SQL_FIELD.test(k) && typeof x === 'string') out.push(x);
    else if (SQL_FIELD.test(k) && Array.isArray(x)) out.push(...x.filter(y => typeof y === 'string'));
    else if (x && typeof x === 'object') fieldTexts(x, out, depth + 1);
  }
  return out;
}
function mcpDbWrite(tool, ti, ctx) {
  const m = tool.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return false;
  const server = m[1], words = toolWords(m[2]);
  const isDb = DB_SERVER.test(server);
  if (!isDb && m[2].toLowerCase().replace(/-/g, '_') !== 'apply_migration') return false;
  if (devServer(ctx, server)) return false;
  if (words.some(w => TOOL_WRITE.has(w))) return true;
  if (words.includes('create') && words.some(w => DB_OBJECTS.has(w))) return true;
  let json = '';
  try { json = JSON.stringify(ti) || ''; } catch { /* not JSON: no pipeline */ }
  if (/"\$(out|merge)"\s*:/.test(json)) return true;
  if (!words.some(w => RUN_WORDS.has(w))) return false;
  const texts = fieldTexts(ti);
  if (!texts.length) return words.some(w => STRONG_RUN.has(w)); // it runs something we cannot see: held
  if (/redis|valkey|upstash/i.test(server)) return texts.some(x => redisWrites(x.split(/\s+/)));
  if (/mongo/i.test(server)) return texts.some(x => MONGO_WRITE.test(x)) || /"(insert|update|delete|drop\w*|findAndModify|create\w*|renameCollection)"\s*:/.test(json);
  return texts.some(sqlWrites);
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
// Commands nested deeper than this (shells in shells, $( ) in $( ), script blocks), or more than MAX_CALLS command
// texts in one line, are not followed: the line is denied as too complex to check (Fable verification N2; a check
// that runs past the hook's 3 s limit would let the command through).
const MAX_DEPTH = 8;
const MAX_CALLS = 400;
const tooComplex = raw => hit('too-complex', true, raw,
  'this command is nested too deeply to check; split it into simpler commands');

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
  const budget = ctx.budget || (ctx.budget = { calls: 0 });
  if (++budget.calls > MAX_CALLS || depth > MAX_DEPTH) return [tooComplex(raw)];
  const pipelines = shell.parse(raw, { dialect });
  if (pipelines.overflow) hits.push(tooComplex(raw));
  let sqlClient = false;
  for (const pl of pipelines) {
    let fetchAt = -1;
    pl.forEach((stage, idx) => {
      noteDbEnv(stage, ctx);
      for (const target of stageWrites(stage, dialect)) if (isSecretName(target)) hits.push(hit('secret-files', false, raw));
      if (ctx.roRoots && ctx.roRoots.length) {
        for (const p of stageChanges(stage, dialect, cwd)) { const root = underReadonly(p, cwd, ctx.roRoots); if (root) hits.push(readonlyHit(root, raw)); }
      }
      // Commands inside $( ), backticks, <( ) and script blocks are commands too ("echo $(npm install)",
      // "X=$(rm -rf ~)"); the parser leaves out text that is only data (single quotes, quoted heredoc bodies).
      for (const inner of stage.subs || []) hits.push(...shellHits(inner, cwd, ctx, depth + 1, dialect));
      const c = shell.command(stage.words);
      if (!c) return;
      const { cmd, args } = c;
      if (SQL_CLIENTS.has(cmd)) sqlClient = true;
      if (dbStageWrite(stage, pl, idx, dialect, ctx)) hits.push(hit('db-write', false, raw));
      const dbCli = dbCliWrite(cmd, args);
      if (dbCli && !(dbCli.host && devHost(ctx, dbCli.host))) hits.push(hit('db-write', false, raw));
      if ((ps ? PS_FETCH : FETCH).has(cmd)) fetchAt = fetchAt < 0 ? idx : fetchAt;
      if (SHELLS.has(cmd) || (ps && PS_EXEC.has(cmd)) || PS_SHELLS.has(cmd)) {
        if (fetchAt >= 0 && idx > fetchAt) hits.push(hit('pipe-to-shell', false, raw));
      }
      if (SHELLS.has(cmd) && args.some(a => /^<\(\s*(curl|wget)\b/i.test(a))) hits.push(hit('pipe-to-shell', false, raw));
      if (ps && PS_EXEC.has(cmd) && args.some(a => FETCH_TEXT.test(a))) hits.push(hit('pipe-to-shell', false, raw));
      // Fable code review M7: what iex / Invoke-Expression runs is a command too ("iex 'npm ci'"); running a file's
      // contents ("iex (gc ./build.ps1 -Raw)") runs the repo's code.
      if (ps && PS_EXEC.has(cmd) && args.length && !args.some(a => FETCH_TEXT.test(a))) {
        if (ctx.quarantine && args.some(a => /(^|[\s(])(gc|get-content|cat|type)\s/i.test(a))) hits.push(hit('guest-quarantine', false, raw));
        else hits.push(...shellHits(args.join(' '), cwd, ctx, depth + 1, 'ps'));
      }
      // Start-Process npm -ArgumentList install: judged as "npm install"; a shell it starts runs its script
      // ("Start-Process cmd -ArgumentList '/c npm install'", Fable verification N7).
      if (ps && /^(start-process|saps|start)$/.test(cmd)) {
        let exe = null; const argList = [];
        for (let i = 0; i < args.length; i++) {
          if (/^-(filepath|fi)$/i.test(args[i])) exe = args[++i];
          else if (/^-(argumentlist|args)$/i.test(args[i])) argList.push(...String(args[++i] || '').split(/[\s,]+/).filter(Boolean));
          else if (!args[i].startsWith('-')) { if (!exe) exe = args[i]; else argList.push(args[i]); }
        }
        const started = exe && innerScript(shell.baseName(exe), argList);
        if (started) hits.push(...shellHits(started.script, cwd, ctx, depth + 1, started.dialect));
        else if (exe && ctx.quarantine && quarantined(exe, shell.baseName(exe), argList, cwd, ctx)) hits.push(hit('guest-quarantine', false, raw));
      }
      // eval runs its words as a command line; find -exec / -execdir / -ok runs a command per file (N7).
      if (!ps && cmd === 'eval' && args.length) hits.push(...shellHits(args.join(' '), cwd, ctx, depth + 1, 'bash'));
      if (!ps && cmd === 'find') {
        for (let i = 0; i < args.length; i++) {
          if (!/^-(exec|execdir|ok|okdir)$/.test(args[i])) continue;
          let j = i + 1; const part = [];
          for (; j < args.length && args[j] !== ';' && args[j] !== '+'; j++) part.push(args[j]);
          if (part.length) hits.push(...shellHits(part.map(w => (/[\s'"]/.test(w) ? `'${w.replace(/'/g, "'\\''")}'` : w)).join(' '), cwd, ctx, depth + 1, 'bash'));
          i = j;
        }
      }
      const inner = innerScript(cmd, args);
      if (inner) {
        if (/^\s*(\$\(|`)\s*(curl|wget)\b/i.test(inner.script)) hits.push(hit('pipe-to-shell', false, raw));
        else hits.push(...shellHits(inner.script, cwd, ctx, depth + 1, inner.dialect));
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

// Every rule always runs, on the whole command (Fable review H3, M4; verification N4). The user's own rules and all
// plain-text rules run directly. The project's regular expressions (a repo's rules.md is committed, and a pattern can
// backtrack for minutes) run in a sandbox with a shared time limit: a pattern that is still running when the limit is
// reached counts as a match to confirm, never as a pass, so the hook always answers inside its 3 s.
const REPO_REGEX_MS = 250;
function slowSafeTest(re, text, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return 'timeout';
  try {
    return require('vm').runInNewContext('re.test(text)', { re, text }, { timeout: Math.max(10, left) }) ? 'match' : 'no';
  } catch { return 'timeout'; }
}
function userHits(text, rules) {
  const hits = [];
  if (!rules) return hits;
  const lower = text.toLowerCase();
  const say = r => r.reason || `this matches your rule "${r.source}"`;
  const deadline = Date.now() + REPO_REGEX_MS;
  const judge = (r, hard) => {
    if (!r.re) { if (lower.includes(r.text.toLowerCase())) hits.push(hit(r.id, hard, text, say(r))); return; }
    if (!r.fromRepo) { if (r.re.test(text)) hits.push(hit(r.id, hard, text, say(r))); return; }
    const v = slowSafeTest(r.re, text, deadline);
    if (v === 'match') hits.push(hit(r.id, hard, text, say(r)));
    else if (v === 'timeout') hits.push(hit(r.id, false, text, `your rule "${r.source}" took too long to check, so it is held`));
  };
  for (const r of rules.never || []) judge(r, true);
  for (const r of rules.confirm || []) judge(r, false);
  return hits;
}

// ---------- forge-state (design-v0.4 1; v0.4 code review H1, H3; security re-review 2026-11-20) ----------
// JSPARK Forge's own build-graph record (state and trust) is written only by JSPARK Forge. Owner's rule: a false
// "never allowed" blocks real work and is worse than an extra prompt, so there are two levels.
// Hard deny, from parsed stages: a change target that resolves (against the command's folder, following cd within the
// line, and through junctions and links where the folder exists) to this project's own record: its .jspark-forge
// folder moved or deleted, the state folder, or a graph-* file in it; and running JSPARK Forge's hook events by hand
// (a forge script run with a hook event, a variable, "--" or xargs as its first argument).
// Ask (Claude Code's own permission prompt, no CONFIRM), for what only the text shows: when the line or its folder
// names .jspark-forge, an interpreter or .NET call that writes, a change target in a variable, {} or xargs, a link to
// the record, or an unknown command naming the state folder; in any line, loading JSPARK Forge's graph or confirm code
// or giving a script a hook event. Reads, git, commit messages and the plugin's own CLI commands never ask.
// Resolution shares a 500 ms budget and never touches a network path, so no path can hold up the other rules
// (re-review H1); past the budget, targets are judged by their text.
const fsMod = require('fs');
const FORGE_NAME = /\.jspark-forge/i;
const FORGE_MS = 500;
const NET_PATH = /^[\\/]{2}/; // \\server\share, //server/share, \\?\..., \\.\...: never resolved (a lookup can take a minute)
const READERS = new Set(['cat', 'type', 'get-content', 'gc', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg',
  'select-string', 'sls', 'ls', 'dir', 'get-childitem', 'gci', 'jq', 'wc', 'stat', 'file', 'test-path', 'echo', 'printf',
  'write-output', 'write-host', 'diff', 'cmp', 'test', '[', '[[', 'sort', 'uniq', 'sha1sum', 'sha256sum', 'sha512sum',
  'md5sum', 'cksum', 'convertfrom-json', 'convertto-json', 'select-object', 'select', 'measure-object', 'measure',
  'out-host', 'out-string', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'git', 'gh', 'glab', 'pwd',
  'basename', 'dirname', 'realpath', 'readlink', 'tree', 'du', 'cut', 'tr', 'nl', 'od', 'xxd', 'true', 'false', 'for',
  'done', 'fi', 'esac', 'case', 'resolve-path', 'split-path', 'join-path', 'get-item', 'gi', 'get-date']);
// Commands whose change targets are read from their arguments (resolved, so their text never asks).
const KNOWN_CHANGERS = new Set(['rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'md', 'truncate', 'chmod', 'chown', 'chgrp', 'mv',
  'move', 'cp', 'copy', 'cpi', 'ln', 'install', 'rsync', 'scp', 'dd', 'curl', 'wget', 'patch', 'sed', 'tee', 'ed', 'ex', 'vi',
  'vim', 'nano', 'xcopy', 'rename-item', 'ren', 'rni', 'clear-content', 'clc', ...PS_WRITERS, ...PS_REMOVE]);
const SAFE_ON_FOLDER = /^(mkdir|md|chmod|chown|chgrp|touch|new-item|ni|icacls|attrib)$/; // never move or delete a folder
const RUNS_CODE = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'py', 'pypy', 'perl', 'ruby', 'php', 'pwsh', 'powershell']);
const JS_RUNNERS = new Set(['node', 'nodejs', 'bun', 'deno']);
const NODE_VALUE_FLAGS = /^(-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--title|--env-file|--inspect-port|--input-type|--stack-size)$/;
const FORGE_SCRIPT = /(^|[\\/])forge(\.[cm]?js)?$/i;
// The plugin's own CLI commands (forge.js CLI table): `node .../forge.js graph done ...` is how Claude reports a step.
const FORGE_CLI = new Set(['graph', 'save', 'show', 'where', 'waiting', 'doctor', 'status', 'decide', 'decisions', 'check', 'map',
  'launch', 'schema', 'lint']);
const DOTNET_IO = /\[(system\.)?io\.(file|directory|fileinfo|directoryinfo)\]::/i;
// Writing words in code. A string's .replace( and a plain open( read; open(..., 'w' / 'a' / 'x' / '+') writes.
const WRITES_TEXT = /write|append|copy|rename|move|unlink|remove|\brm|symlink|truncate|chmod|mkdir|\bos\.replace\b|open\s{0,5}\([^)]{0,300}?['"](?=[rbt]{0,3}[wax+])[rwaxbt+]{1,4}['"]|out-file|set-content|add-content/i;
const HOOK_EVENTS = 'SessionStart|UserPromptSubmit|PreToolUse|PostToolUseFailure|PostToolUse|Stop|PreCompact|SessionEnd|SubagentStart|SubagentStop';
const HOOK_SET = new Set(HOOK_EVENTS.toLowerCase().split('|'));
const HOOK_BY_NAME = new RegExp(`forge(\\.js)?["'\\s,\\[\\]]{1,12}(${HOOK_EVENTS})\\b`);
const HOOK_BY_VAR = new RegExp(`\\bnode(js)?(\\.exe)?\\b[^\\n|;&]{0,200}?\\$\\{?[\\w:]{1,60}\\}?["']?\\s{1,20}["']?(${HOOK_EVENTS})\\b`);
const LOADS_JS = /\b(node|nodejs|deno|bun)(\.exe)?\b/i;
const LOADER = /require\s{0,5}\(|import\s{0,5}\(|\bimport\b[^;\n]{0,200}?\bfrom\b|(^|\s)-{1,2}(e|p|r|eval|print|require|import)(\s|=|["']|$)/;
const FORGE_CODE = /lib[\\/]{1,4}(graph-run|confirm)\b|\bforge\.js\b|[\\/'"]forge['"]|CLAUDE_PLUGIN_ROOT/i;
const HOOK_RUN_PLAIN = "this runs JSPARK Forge's own hooks or graph code by hand, which only Claude Code does: report a step with " +
  'forge.js graph done; the user trusts a graph or completes a human step by typing TRUST GRAPH <name> or DONE <step>';
const HOOK_ASK_PLAIN = "this may run JSPARK Forge's own hooks or graph code by hand, which only Claude Code does (a step is " +
  'reported with forge.js graph done; the user trusts a graph or completes a human step by typing TRUST GRAPH <name> or ' +
  'DONE <step>); allow it only if you expect it';
const hookText = t => HOOK_BY_NAME.test(t) || HOOK_BY_VAR.test(t) || (LOADS_JS.test(t) && LOADER.test(t) && FORGE_CODE.test(t));

// A path as compared: resolved, forward slashes, lower case on Windows, where trailing dots and spaces and a
// ":stream" suffix (name::$DATA) also go, as Windows drops them.
function recKey(p) {
  const s = norm(p);
  if (!WIN) return s;
  const tail = s.slice(2);
  if (!tail.includes(':') && !/[. ](\/|$)/.test(tail)) return s; // nothing to drop (the common case, kept fast)
  return s.split('/').map((x, i) => (i === 0 || !x ? x : (x.replace(/:.*$/, '').replace(/[. ]+$/, '') || x))).join('/');
}
// Per check() call: this project's record folders (as written and as resolved), the resolve budget and the caches.
function forgeInfo(ctx) {
  if (ctx.forgeInfo) return ctx.forgeInfo;
  const abs = require('./paths').repoForgeDir(ctx.projectDir);
  const f = { abs, deadline: Date.now() + FORGE_MS, dirs: new Map(), links: new Map(), cands: null, roots: [] };
  ctx.forgeInfo = f;
  const keys = [...new Set([recKey(abs), recKey(realOf(abs, f))])];
  f.roots = keys.map(k => ({ F: k, S: `${k}/state` }));
  return f;
}
// 'folder' (the .jspark-forge or state folder itself), 'file' (a graph-* file in state) or null.
function recordLevel(k, f) {
  for (const { F, S } of f.roots) {
    if (k === F || k === S) return 'folder';
    if (k.startsWith(`${S}/`)) return /^graph-/i.test(k.slice(S.length + 1)) ? 'file' : null;
  }
  return null;
}
// A folder with every existing part resolved through junctions and links; cached per folder for one check() call
// (re-review M9: thousands of targets in one folder cost one lookup).
function realDir(dir, f) {
  const known = f.dirs.get(dir);
  if (known !== undefined) return known;
  const heads = [];
  let head = dir, r = null;
  for (let i = 0; i < 128 && r === null; i++) {
    const c = f.dirs.get(head);
    if (c !== undefined) { r = c; break; }
    if (Date.now() > f.deadline) { r = head; break; } // out of budget: the rest by its text
    try { r = fsMod.realpathSync.native(head); f.dirs.set(head, r); break; } catch { /* not there yet: one folder up */ }
    const up = path.dirname(head);
    if (up === head) { r = head; break; }
    heads.push(head); head = up;
  }
  if (r === null) r = head;
  for (let j = heads.length - 1; j >= 0; j--) { r = path.join(r, path.basename(heads[j])); f.dirs.set(heads[j], r); }
  f.dirs.set(dir, r);
  return r;
}
// The names in a folder that are links or junctions (one listing per folder per check() call).
function linkNames(dir, f) {
  let s = f.links.get(dir);
  if (s) return s;
  s = new Set();
  if (Date.now() <= f.deadline) {
    try { for (const d of fsMod.readdirSync(dir, { withFileTypes: true })) if (d.isSymbolicLink()) s.add(WIN ? d.name.toLowerCase() : d.name); } catch { /* not there */ }
  }
  f.links.set(dir, s);
  return s;
}
// The path with its folder resolved through links, and the last part too when it is a link. A network path is
// never looked up (re-review H1); past the budget the path is returned as written.
// On Windows a path on another drive than the project is not looked up either: a mapped network drive looks local,
// and one slow lookup cannot be interrupted; the record lives on the project's drive.
const driveOf = p => (WIN && /^[a-zA-Z]:/.test(String(p)) ? String(p)[0].toLowerCase() : '');
function realOf(abs, f) {
  if (NET_PATH.test(abs) || Date.now() > f.deadline) return abs;
  if (driveOf(abs) && driveOf(f.abs) && driveOf(abs) !== driveOf(f.abs)) return abs;
  const dir = path.dirname(abs);
  if (dir === abs || NET_PATH.test(dir)) return abs;
  const base = path.basename(abs);
  const rd = realDir(dir, f);
  if (linkNames(dir, f).has(WIN ? base.toLowerCase() : base)) { try { return fsMod.realpathSync.native(abs); } catch { /* broken link */ } }
  return path.join(rd, base);
}
const GLOB = /[*?[]/;
// The paths that a glob could name: the two folders, the fixed record files and the graph-* files that exist.
function forgeCandidates(f) {
  if (f.cands) return f.cands;
  const state = path.join(f.abs, 'state');
  let names = ['graph-trust.json', 'graph-active.json', 'graph-x.json'];
  if (Date.now() <= f.deadline) { try { names = names.concat(fsMod.readdirSync(state).filter(n => /^graph-/i.test(n))); } catch { /* none */ } }
  f.cands = [[recKey(f.abs), 'folder'], [recKey(state), 'folder']].concat(names.map(n => [recKey(path.join(state, n)), 'file']));
  return f.cands;
}
function forgeGlob(t, abs, f) {
  if (t.length > 400 || (t.match(/\*/g) || []).length > 20) return FORGE_NAME.test(t) ? 'unknown' : null; // too wild to match
  // Matched segment by segment with a wildcard loop, not a regular expression: "*?*?…" against a long name made a
  // backtracking regex run past the hook's 3 s, and then nothing was blocked (third review H1).
  const pat = recKey(abs).replace(/\[[^\]]{0,50}\]/g, '?').replace(/\*{2,}/g, '*').toLowerCase().split('/');
  let level = null;
  for (const [c, kind] of forgeCandidates(f)) {
    const parts = c.toLowerCase().split('/');
    if (parts.length === pat.length && parts.every((s, i) => segMatch(pat[i], s))) { if (kind === 'file') return 'file'; level = 'folder'; }
  }
  return level;
}
// One path segment against a pattern of literals, "*" and "?": the classic two-pointer match with one fallback point,
// at most length x length steps. A wildcard at the start does not match a leading dot ("rm -rf *" leaves .jspark-forge).
function segMatch(p, s) {
  if ((p[0] === '*' || p[0] === '?') && s[0] === '.') return false;
  let i = 0, j = 0, star = -1, mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i++; j++; }
    else if (i < p.length && p[i] === '*') { star = i++; mark = j; }
    else if (star >= 0) { i = star + 1; j = ++mark; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i++;
  return i === p.length;
}
// $PWD, ~+ and the project folder variable are known; any other variable is not.
function expandKnown(t, cwd, ctx) {
  let s = t.replace(/\$\{?(?:env:)?CLAUDE_PROJECT_DIR\}?(?!\w)/gi, () => ctx.projectDir);
  if (cwd !== null) s = s.replace(/\$\{?PWD\}?(?!\w)/gi, () => cwd).replace(/^~\+(?=[\\/]|$)/, () => cwd);
  return s;
}
// What a change target is: 'file' / 'folder' (this project's record, see recordLevel), 'unknown' (a variable, {} or a
// folder we cannot know) or null. literal: a tool's file path, where $ and % are just characters.
function forgeTarget(p, cwd, ctx, literal = false) {
  let t = String(p || '').trim();
  if (!literal) t = t.replace(/^["']|["']$/g, '');
  if (!t) return null;
  if (!literal) {
    t = expandKnown(t, cwd, ctx);
    if (/[$`%]|\{[^{}]{0,200}\}/.test(t)) return 'unknown'; // a variable, find's {} or a {a,b} brace expansion
  }
  if (cwd === null && !path.isAbsolute(toFs(t))) return 'unknown';
  const f = forgeInfo(ctx);
  const abs = path.resolve(toFs(cwd === null ? ctx.projectDir : cwd), toFs(t));
  const k = recordLevel(recKey(abs), f);
  if (k) return k;
  if (!literal && GLOB.test(t)) return forgeGlob(t, abs, f);
  const real = realOf(abs, f);
  return real === abs ? null : recordLevel(recKey(real), f);
}
const inForgeDir = (cwd, ctx) => {
  if (!cwd) return false;
  const k = recKey(cwd);
  return forgeInfo(ctx).roots.some(({ F }) => k === F || k.startsWith(`${F}/`));
};
// A copy's destination and sources: bash cp / install / ln / scp (with -t DIR), PowerShell Copy-Item and cmd copy.
function copyArgs(args, ps) {
  let dest = null;
  const srcs = [], pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (ps) {
      if (/^-(path|literalpath|lp)$/i.test(a)) { srcs.push(...String(args[++i] || '').split(',')); continue; }
      if (/^-destination$/i.test(a)) { dest = args[++i]; continue; }
      if (/^-(filter|include|exclude|credential)$/i.test(a)) { i++; continue; }
      if (/^-/.test(a) || /^\/[a-z]$/i.test(a)) continue;
    } else {
      if (a === '-t' || a === '--target-directory') { dest = args[++i]; continue; }
      if (a.startsWith('--target-directory=')) { dest = a.slice(19); continue; }
      if (/^(-S|--suffix|-m|--mode|-o|--owner|-g|--group)$/.test(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
    }
    pos.push(a);
  }
  if (dest === null) {
    if (ps && pos.length + srcs.length === 1) dest = '.'; // Copy-Item x: into the current folder
    else if (pos.length < (ps && srcs.length ? 1 : 2)) return null;
    else dest = pos.pop();
  }
  srcs.push(...pos);
  if (dest === undefined || dest === null) return null;
  return ps ? { dest: psPath(dest), srcs: srcs.filter(Boolean).map(psPath) } : { dest, srcs };
}
const redirectsOf = (stage, dialect) => stage.redirects.filter(r => !/^\$null$/i.test(r)).map(r => (dialect === 'ps' ? psPath(r) : r));
// Every path a stage changes, for the forge-state check: { paths, copies }. paths: writes, deletes, moves (both ends),
// dd of=, rsync / xcopy destinations, curl -o / wget -O, sed -i, perl -i, patch, git mv / checkout / restore / rm (not
// --cached). copies: { dest, srcs }, where a destination folder means the source names inside it.
function forgeStageTargets(stage, dialect, cwd) {
  const c = shell.command(stage.words);
  const ps = dialect === 'ps';
  if (c && ((!ps && ['cp', 'install', 'ln', 'scp'].includes(c.cmd)) || (ps && ['copy-item', 'cp', 'copy', 'cpi'].includes(c.cmd)))) {
    const cp = copyArgs(c.args, ps);
    return { paths: redirectsOf(stage, dialect), copies: cp ? [cp] : [] };
  }
  const out = c && c.cmd === 'git' ? stageWrites(stage, dialect) : stageChanges(stage, dialect, cwd);
  if (!c) return { paths: out, copies: [] };
  const { cmd, args } = c;
  const plain = args.filter(a => !a.startsWith('-') && !/^\/[a-z]{1,4}$/i.test(a));
  if (['rsync', 'xcopy'].includes(cmd) && plain.length) out.push(ps ? psPath(plain[plain.length - 1]) : plain[plain.length - 1]);
  if (cmd === 'dd') out.push(...args.filter(a => /^of=/.test(a)).map(a => a.slice(3)));
  if (cmd === 'curl' || cmd === 'wget') args.forEach((a, i) => { if (/^(-o|--output|-O|--output-document)$/.test(a) && args[i + 1]) out.push(args[i + 1]); else if (/^--output(-document)?=/.test(a)) out.push(a.replace(/^[^=]*=/, '')); });
  if (cmd === 'perl' || cmd === 'patch' || cmd === 'ed' || cmd === 'ex' || cmd === 'vi' || cmd === 'vim') out.push(...plain);
  if (cmd === 'git') {
    const g = parseGit(args, cwd);
    if (['mv', 'checkout', 'restore', 'rm'].includes(g.sub) && !(g.sub === 'rm' && g.rest.includes('--cached'))) {
      out.push(...g.rest.filter(a => !a.startsWith('-')).map(a => (/[$`%]/.test(a) ? a : path.resolve(toFs(g.dir), toFs(a)))));
    }
  }
  return { paths: out, copies: [] };
}
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
// A stage that only reads (or only carries text, as git and gh messages do): its words never ask. A PowerShell
// expression or value ("(Get-Content x).steps", "'{}'") is checked through its inner commands.
function forgeReader(c) {
  const { cmd, args } = c;
  if (cmd === 'sed') return args.some(a => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a) || a === '--quiet' || a === '--silent') && !args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'));
  if (/^[gmn]?awk$/.test(cmd)) return !args.some(a => a === '-i' || /inplace|system\s{0,5}\(|[>|]/.test(a));
  if (cmd === 'find') return !args.some(a => /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/.test(a));
  if (baseTool(cmd) === 'python' || cmd === 'py') return args[0] === '-m' && args[1] === 'json.tool';
  if (/^(format-[a-z]+|ft|fl|fw)$/.test(cmd)) return true;
  if (/[\s(){}'"]|^\$/.test(c.word)) return true;
  return READERS.has(cmd);
}
// A node / bun / deno stage on a forge script: 'cli' (the plugin's own command), 'hard' (a hook event by hand) or
// 'ask' (another script given a hook event), else null (re-review H3, H4).
function forgeRun(stage, c, dialect) {
  if (!c) return null;
  let cmd = baseTool(c.cmd), args = c.args;
  if (dialect === 'ps' && /^(start-process|saps|start)$/.test(c.cmd)) {
    let exe = null; const list = [];
    for (let i = 0; i < args.length; i++) {
      if (/^-(filepath|fi)$/i.test(args[i])) exe = args[++i];
      else if (/^-(argumentlist|args)$/i.test(args[i])) list.push(...String(args[++i] || '').split(/[\s,]+/).filter(Boolean));
      else if (!args[i].startsWith('-')) { if (!exe) exe = args[i]; else list.push(args[i]); }
    }
    if (!exe) return null;
    cmd = baseTool(shell.baseName(exe)); args = list;
  }
  if (!JS_RUNNERS.has(cmd)) return null;
  const viaXargs = stage.words.slice(0, Math.max(0, stage.words.indexOf(c.word))).some(w => shell.baseName(w) === 'xargs');
  let i = (cmd === 'bun' || cmd === 'deno') && args[0] === 'run' ? 1 : 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { i++; break; }
    if (/^-(e|p|pe|-eval|-print)$/.test(a) || a === '-') return null; // code on the line or on stdin: the text decides
    if (NODE_VALUE_FLAGS.test(a)) { i++; continue; }
    if (!a.startsWith('-')) break;
  }
  const script = args[i];
  if (script === undefined) return null;
  const first = args[i + 1];
  const event = first !== undefined && HOOK_SET.has(String(first).trim().toLowerCase());
  const unknown = first !== undefined && /[$`%]/.test(first);
  if (FORGE_SCRIPT.test(String(script).trim())) {
    if (first !== undefined && FORGE_CLI.has(first)) return 'cli';
    return event || first === '--' || unknown || viaXargs ? 'hard' : 'quiet'; // "node forge.js build" runs no hook
  }
  if (event) return /[$`%]/.test(script) ? 'hard' : 'ask';
  return null;
}
// One pass over a command line (and the commands inside it). acc.hard: the hit to deny with; the other acc fields
// are text signals that make an ask when the line names .jspark-forge (forgeHits).
function forgeScan(raw, cwd, ctx, depth, dialect, acc) {
  const budget = ctx.budget || (ctx.budget = { calls: 0 });
  if (++budget.calls > MAX_CALLS || depth > MAX_DEPTH) { acc.hard = tooComplex(raw); return; }
  const ps = dialect === 'ps';
  let here = cwd; // null: a folder we cannot know (cd to a variable)
  const written = []; // [path, folder]: compared only when an interpreter runs a script file
  const key = (p, dir) => (dir === null && !path.isAbsolute(toFs(p)) ? null : recKey(path.resolve(toFs(dir === null ? ctx.projectDir : dir), toFs(p))));
  const wrote = p => { const k = key(p, here); return !!k && written.some(([w, d]) => key(w, d) === k); };
  for (const pl of shell.parse(raw, { dialect })) {
    for (let idx = 0; idx < pl.length; idx++) {
      let stage = pl[idx];
      // PowerShell "$x = <command>": the command after the =
      if (ps && stage.words.length > 2 && /^\$/.test(stage.words[0]) && stage.words[1] === '=') stage = Object.assign({}, stage, { words: stage.words.slice(2) });
      const c = shell.command(stage.words);
      if (c && CD.has(c.cmd)) {
        const to = c.args.filter(a => !a.startsWith('-'))[0];
        if (to === undefined) { here = ctx.home; continue; }
        let t = expandKnown(ps ? psPath(to) : to, here, ctx).replace(/^~(?=[\\/]|$)/, () => ctx.home);
        if (t === '-' || /[$`%]/.test(t) || (here === null && !path.isAbsolute(toFs(t)))) here = null;
        else here = path.resolve(toFs(here === null ? ctx.projectDir : here), toFs(t));
        continue;
      }
      // Change targets, resolved: the record itself is a hard deny.
      const safeFolder = !!c && SAFE_ON_FOLDER.test(c.cmd);
      const judge = k => {
        if (k === 'file' || (k === 'folder' && !safeFolder)) acc.hard = acc.hard || hit('forge-state', true, raw);
        else if (k === 'unknown') acc.unknownTarget = true;
      };
      const T = forgeStageTargets(stage, dialect, here === null ? ctx.projectDir : here);
      for (const p of T.paths) judge(forgeTarget(p, here, ctx));
      if (written.length < 50) for (const r of redirectsOf(stage, dialect)) written.push([String(r), here]);
      for (const cp of T.copies) {
        const k = forgeTarget(cp.dest, here, ctx);
        if (k !== 'folder') { judge(k); continue; }
        for (const s of cp.srcs) judge(/[$`%]|\{\}/.test(s) ? 'unknown' : forgeTarget(path.join(String(cp.dest), path.basename(toFs(s))), here, ctx));
      }
      if (acc.hard) return;
      const run = forgeRun(stage, c, dialect);
      if (run === 'hard') { acc.hard = hit('forge-state', true, raw, HOOK_RUN_PLAIN); return; }
      if (run === 'ask') acc.hookAsk = true;
      // The commands inside: $( ), script blocks, bash -c / pwsh -c / cmd /c, eval, iex, find -exec.
      for (const inner of stage.subs || []) { forgeScan(inner, here, ctx, depth + 1, dialect, acc); if (acc.hard) return; }
      if (!c) continue;
      const inner = innerScript(c.cmd, c.args)
        || (!ps && c.cmd === 'eval' && c.args.length ? { script: c.args.join(' '), dialect: 'bash' } : null)
        || (ps && PS_EXEC.has(c.cmd) && c.args.length ? { script: c.args.join(' '), dialect: 'ps' } : null);
      if (inner) { forgeScan(inner.script, here, ctx, depth + 1, inner.dialect, acc); if (acc.hard) return; }
      if (!ps && c.cmd === 'find') {
        for (let i = 0; i < c.args.length; i++) {
          if (!/^-(exec|execdir|ok|okdir)$/.test(c.args[i])) continue;
          let j = i + 1; const part = [];
          for (; j < c.args.length && c.args[j] !== ';' && c.args[j] !== '+'; j++) part.push(c.args[j]);
          if (part.length) { forgeScan(part.map(w => (/[\s'"]/.test(w) ? `'${w.replace(/'/g, "'\\''")}'` : w)).join(' '), here, ctx, depth + 1, 'bash', acc); if (acc.hard) return; }
          i = j;
        }
      }
      // Text signals.
      if (run === 'cli') continue;
      const viaXargs = stage.words.slice(0, Math.max(0, stage.words.indexOf(c.word))).some(w => shell.baseName(w) === 'xargs');
      const reader = forgeReader(c);
      if (viaXargs && !reader) acc.unknownTarget = true; // "... | xargs sed -i": the files come from the input
      if (reader) continue;
      const text = stage.words.concat(stage.redirects).join(' ');
      if (RUNS_CODE.has(baseTool(c.cmd))) {
        let code = text;
        const script = c.args.find(a => !a.startsWith('-'));
        const fed = stage.input || (idx > 0 && script === undefined) || (script !== undefined && wrote(script));
        if (fed) code += `\n${raw}`; // a heredoc, a pipe or a script this line wrote: the line is the code
        if (WRITES_TEXT.test(code)) acc.codeWrites = true;
        // a forge script run without a hook event: its own name is not JSPARK Forge's code loaded by hand
        if (hookText(run === 'quiet' ? code.split(/\s+/).filter(w => !FORGE_SCRIPT.test(w)).join(' ') : code)) acc.hookAsk = true;
        continue;
      }
      if (hookText(text)) acc.hookAsk = true;
      if ((/^(ln|mklink)$/.test(c.cmd) || (/^(new-item|ni)$/.test(c.cmd) && c.args.some(a => /^(symboliclink|junction|hardlink)$/i.test(a))))
        && FORGE_NAME.test(text)) acc.unknownTarget = true; // a link to the record: what is written through it later is not seen
      if (KNOWN_CHANGERS.has(c.cmd)) continue;
      if (FORGE_NAME.test(text) && (c.cmd === 'find' || /\bstate\b|graph-/i.test(text))) acc.unknownCmd = true;
    }
  }
}
// The forge-state hit for a shell command line: [hard], [ask] or [].
function forgeHits(raw, cwd, ctx, dialect) {
  const acc = { hard: null };
  forgeScan(raw, cwd, ctx, 0, dialect, acc);
  if (acc.hard) return [acc.hard];
  if (acc.hookAsk) return [hit('forge-state', false, raw, HOOK_ASK_PLAIN, true)];
  if (DOTNET_IO.test(raw) && WRITES_TEXT.test(raw)) acc.codeWrites = true;
  const named = FORGE_NAME.test(raw) || inForgeDir(cwd, ctx);
  if (named && (acc.unknownTarget || acc.codeWrites || acc.unknownCmd)) return [hit('forge-state', false, raw, null, true)];
  return [];
}

// opts.all: return every hit (hard ones first) instead of the one to report.
function check(input, ctx, opts = {}) {
  try {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const cwd = input.cwd || ctx.projectDir;
    const disabled = new Set((ctx.rules && ctx.rules.disabled) || []);
    ctx = Object.assign({}, ctx, { roRoots: readonlyRoots(ctx), budget: { calls: 0 }, dbEnv: {}, forgeInfo: null });
    let hits = [];
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
      const p = ti.file_path || ti.notebook_path || '';
      if (isSecretName(p)) hits.push(hit('secret-files', false, p));
      const root = underReadonly(p, cwd, ctx.roRoots);
      if (root) hits.push(readonlyHit(root, p));
      const k = forgeTarget(p, cwd, ctx, true);
      if (k === 'file' || k === 'folder') hits.push(hit('forge-state', true, p));
    } else if (tool === 'Bash' || tool === 'PowerShell') {
      const raw = String(ti.command || '');
      const dialect = tool === 'PowerShell' ? 'ps' : 'bash';
      hits = forgeHits(raw, cwd, ctx, dialect);
      ctx.budget = { calls: 0 };
      hits = hits.concat(shellHits(raw, cwd, ctx, 0, dialect));
      hits = hits.concat(userHits(raw, ctx.rules));
    } else if (tool.startsWith('mcp__')) {
      const text = mcpText(ti);
      if (sqlDestructive(text)) hits.push(hit('sql-destroy', false, text));
      if (mcpDbWrite(tool, ti, ctx)) hits.push(hit('db-write', false, text));
      hits = hits.concat(userHits(text, ctx.rules));
    }
    // disable: turns a built-in off, but never its hard-deny part (home folder, whole disk, drive).
    hits = hits.filter(h => !disabled.has(h.id) || (h.hard && BUILTINS[h.id]));
    // sql-destroy (DROP / TRUNCATE / DELETE without WHERE) already holds the statement: one CONFIRM, not two.
    if (hits.some(h => h.id === 'sql-destroy')) hits = hits.filter(h => h.id !== 'db-write');
    // Order: hard denies, then typed confirms, then asks.
    if (opts.all) return hits.filter(h => h.hard).concat(hits.filter(h => !h.hard && !h.ask), hits.filter(h => h.ask));
    if (!hits.length) return null;
    return hits.find(h => h.hard) || hits.find(h => !h.ask) || hits[0];
  } catch {
    return opts.all ? [] : null; // fail open, in the shape the caller expects (Fable verification N8)
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

// Every file path a shell command line changes (writes, sed -i, mv, cp, rm, touch, PowerShell writers): decision memory
// uses it to know which files a command is about to touch. A git command's work-tree folder is left out.
function changeTargets(raw, dialect = 'bash', cwd = '.') {
  try {
    return shell.parse(raw, { dialect }).flatMap(pl => pl.flatMap(st => {
      const c = shell.command(st.words);
      return c && c.cmd === 'git' ? stageWrites(st, dialect) : stageChanges(st, dialect, cwd);
    }));
  } catch { return []; }
}

module.exports = { check, BUILTINS, STOP, isSecretName, isGitCommit, writeTargets, changeTargets, toFs };
