'use strict';
// v0.5: the two MCP servers that ship with the plugin (code map, Playwright). This module holds the pins, the off
// switches, where each pinned package is installed (once, by scripts/mcp/install.js, with npm and no shell), how
// to start it with Node, and the one record file the launcher writes and the doctor reads: <claude home>/jspark-forge/bundled.json. Nothing here reaches the network; the installer and
// the launcher (scripts/mcp/install.js, scripts/mcp/run.js) do the work.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const SERVERS = {
  'codebase-memory': { pkg: 'codebase-memory-mcp', safe: 'codebase-memory-mcp', pin: '0.12.1', env: 'JSPARK_FORGE_CODE_MAP', setting: 'code-map' },
  playwright: { pkg: '@playwright/mcp', safe: 'playwright-mcp', pin: '0.0.86', env: 'JSPARK_FORGE_PLAYWRIGHT', setting: 'playwright' },
};
const LAUNCHER = path.join(__dirname, '..', 'mcp', 'run.js');
const INSTALLER = path.join(__dirname, '..', 'mcp', 'install.js');

// 'off' (env var or merged rules setting), 'no-frontend' or 'node-too-old' (Playwright only; `nodeMajor` or
// JSPARK_FORGE_NODE_MAJOR lets tests inject the Node version), else 'run'. Never throws.
function mode(name, projectDir, nodeMajor) {
  const s = SERVERS[name];
  if (!s) return 'off';
  if (String(process.env[s.env] || '').trim().toLowerCase() === 'off') return 'off';
  try {
    if (require('./rules').loadRules(projectDir).settings[s.setting] === 'off') return 'off';
  } catch { /* unreadable rules: the default is on */ }
  if (name === 'playwright') {
    let front = false;
    try { front = require('./uitip').hasFrontEnd(projectDir); } catch { /* none */ }
    if (!front) return 'no-frontend';
    // @playwright/mcp declares engines node >= 20 (review S10); JSPARK Forge itself still supports 18.
    const major = Number(nodeMajor !== undefined ? nodeMajor : (process.env.JSPARK_FORGE_NODE_MAJOR || process.versions.node.split('.')[0]));
    if (major < 20) return 'node-too-old';
  }
  return 'run';
}

// Where every child of the launcher runs: <claude home>/jspark-forge, never the session's folder, so a folder's own
// .npmrc, node_modules or node.cmd cannot choose what code runs (review M2). The project reaches the child only through
// CLAUDE_PROJECT_DIR and the arguments the caller gives. NoDefaultCurrentDirectoryInExePath stops Windows (cmd.exe,
// which npm itself may use) from looking in the current folder first.
function neutralDir(home) {
  const d = path.join(home || paths.claudeHome(), 'jspark-forge');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* the spawn then reports it */ }
  return d;
}
function childOptions(home) {
  return { cwd: neutralDir(home), env: Object.assign({}, process.env, { NoDefaultCurrentDirectoryInExePath: '1' }) };
}

// Where an engine lives once installed: <claude home>/jspark-forge/engines/<safe-name>-<pin>/. The marker file
// installed.json is written by the installer only after npm succeeded; a folder without it is never used (a first
// start that was cut short leaves a half-written folder, and that must not poison later starts).
function engineDir(home, name) {
  const s = SERVERS[name];
  return path.join(home || paths.claudeHome(), 'jspark-forge', 'engines', `${s.safe}-${s.pin}`);
}
const lockFile = (home, name) => `${engineDir(home, name)}.lock`;
const markerFile = (home, name) => path.join(engineDir(home, name), 'installed.json');
function installed(home, name) {
  try { return !!JSON.parse(fs.readFileSync(markerFile(home, name), 'utf8')); } catch { return false; }
}
// The engine's program: the "bin" of the installed package.json, a string or an object. null when it cannot be found.
function binPath(home, name) {
  try {
    const s = SERVERS[name];
    const root = path.join(engineDir(home, name), 'node_modules', ...s.pkg.split('/'));
    const bin = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).bin;
    let rel = typeof bin === 'string' ? bin : null;
    if (bin && typeof bin === 'object') rel = bin[s.pkg] || bin[s.pkg.split('/').pop()] || Object.values(bin).find(v => typeof v === 'string') || null;
    const p = rel ? path.join(root, rel) : null;
    return p && fs.existsSync(p) ? p : null;
  } catch { return null; }
}

// npm's own script run by the running Node, with shell: false, so paths with spaces arrive unchanged (npm.cmd would
// need cmd.exe). Windows without it: null (the installer records why).
function npmCommand() {
  const dir = path.dirname(process.execPath);
  const cli = process.platform === 'win32'
    ? path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return [process.execPath, cli];
  return process.platform === 'win32' ? null : ['npm'];
}
function installOverride() {
  const raw = process.env.JSPARK_FORGE_BUNDLED_INSTALL_CMD;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return Array.isArray(c) && c.length && c.every(x => typeof x === 'string') ? c : null;
  } catch { return null; }
}
// What the installer runs: npm install into the engine folder (or the test replacement with the folder and
// <pkg>@<pin> appended). null when npm cannot be found.
function installCommand(home, name) {
  const s = SERVERS[name];
  const dir = engineDir(home, name);
  const spec = `${s.pkg}@${s.pin}`;
  const o = installOverride();
  if (o) return o.concat([dir, spec]);
  const npm = npmCommand();
  return npm ? [...npm, 'install', '--prefix', dir, '--no-audit', '--no-fund', '--no-save', spec] : null;
}
// The installer runs on its own (detached, no window, no output), so it outlives the launcher and the session that
// started it. It takes its own lock; a second one finds the first and ends.
function startInstaller(home, name, project) {
  try {
    // Started through a go-between that ends at once. On Windows a session end kills the launcher's whole process
    // tree, and "detached" alone does not take a child out of that tree: the installer died 26 s into a 333 MB
    // download (real run, 2026-11-20). A process whose parent has already ended is not part of the tree.
    const GO_BETWEEN = "require('child_process').spawn(process.execPath,[process.argv[1],process.argv[2]],{detached:true,stdio:'ignore',windowsHide:true}).unref()";
    const c = require('child_process').spawn(process.execPath, ['-e', GO_BETWEEN, INSTALLER, name], Object.assign({ detached: true, stdio: 'ignore', windowsHide: true, shell: false },
      { cwd: neutralDir(home), env: Object.assign({}, process.env, { NoDefaultCurrentDirectoryInExePath: '1', CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: project || '' }) }));
    c.on('error', () => { /* the launcher notices that no marker comes */ });
    c.unref();
    return c;
  } catch { return null; }
}

function override(name) {
  const raw = process.env.JSPARK_FORGE_BUNDLED_CMD;
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const c = o && o[name];
    return Array.isArray(c) && c.length && c.every(x => typeof x === 'string') ? c : null;
  } catch { return null; }
}

// The command that starts the engine: the test override, else Node on the installed bin; null while not installed.
function command(name, extraArgs = [], home) {
  const o = override(name);
  if (o) return o.concat(extraArgs);
  const h = home || paths.claudeHome();
  if (!SERVERS[name] || !installed(h, name)) return null;
  const bin = binPath(h, name);
  return bin ? [process.execPath, bin, ...extraArgs] : null;
}

const file = home => path.join(home, 'jspark-forge', 'bundled.json');
const DAY = 24 * 3600 * 1000;
const keyOf = project => (project ? paths.normPath(project) : '-');
// Is a process with this pid alive? EPERM means it exists but is not ours: alive.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}
// The file holds { "<server>": { "<normalised project>": { ...facts, project, pid } } }, so two projects never overwrite
// each other's facts. An entry of the old flat shape counts as nothing.
function readAll(home) {
  try {
    const o = JSON.parse(fs.readFileSync(file(home), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
const isMap = v => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => x && typeof x === 'object');
// The single reader: { "<server>": entry } for this project.
function read(home, project) {
  const k = keyOf(project);
  const out = {};
  for (const [name, byProject] of Object.entries(readAll(home))) if (isMap(byProject) && byProject[k]) out[name] = byProject[k];
  return out;
}
// Merges `fields` into this project's entry for `name`; read-modify-write under a lock (both servers start at the same
// moment). Entries whose process is gone and that are older than a day are dropped, which keeps the file small.
function record(home, name, fields, project) {
  try {
    const f = file(home);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    require('./memory').withLock(f, () => {
      const cur = readAll(home);
      const k = keyOf(project);
      for (const n of Object.keys(cur)) {
        if (!isMap(cur[n])) { delete cur[n]; continue; }
        for (const [key, e] of Object.entries(cur[n])) {
          if (!(n === name && key === k) && !pidAlive(e.pid) && !(Date.now() - (e.startedAt || 0) < DAY)) delete cur[n][key];
        }
      }
      const byProject = isMap(cur[name]) ? cur[name] : {};
      byProject[k] = Object.assign({}, byProject[k], fields, project ? { project: k } : {});
      cur[name] = byProject;
      require('./fsx').writeAtomic(f, `${JSON.stringify(cur, null, 2)}
`);
    });
  } catch { /* never throws */ }
}

module.exports = { SERVERS, LAUNCHER, INSTALLER, mode, engineDir, lockFile, installed, binPath, installCommand, startInstaller, neutralDir, childOptions, command, record, read, pidAlive, claudeHome: paths.claudeHome };
