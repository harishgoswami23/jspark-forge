'use strict';
// v0.5: the two MCP servers that ship with the plugin (code map, Playwright). This module holds the pins, the off
// switches, how to start the pinned npm package without a shell, and the one record file the launcher writes and the
// doctor reads: <claude home>/jspark-forge/bundled.json. Nothing here reaches the network; the launcher
// (scripts/mcp/run.js) does the starting.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const SERVERS = {
  'codebase-memory': { pkg: 'codebase-memory-mcp', pin: '0.12.1', env: 'JSPARK_FORGE_CODE_MAP', setting: 'code-map' },
  playwright: { pkg: '@playwright/mcp', pin: '0.0.86', env: 'JSPARK_FORGE_PLAYWRIGHT', setting: 'playwright' },
};
const LAUNCHER = path.join(__dirname, '..', 'mcp', 'run.js');
const NO_NPX = 'npx was not found next to Node.js';

// 'off' (env var or merged rules setting), 'no-frontend' (Playwright only), else 'run'. Never throws.
function mode(name, projectDir) {
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

// npm's own npx script run by the running Node: this module starts it with shell: false, so JSON arguments and paths with spaces arrive unchanged
// (npx.cmd would need cmd.exe, which re-parses its arguments). Windows without it: null (the caller records why).
function npxCommand() {
  const dir = path.dirname(process.execPath);
  const cli = process.platform === 'win32'
    ? path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
    : path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (fs.existsSync(cli)) return [process.execPath, cli];
  return process.platform === 'win32' ? null : ['npx'];
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

function command(name, extraArgs = []) {
  const o = override(name);
  if (o) return o.concat(extraArgs);
  const s = SERVERS[name];
  const npx = s && npxCommand();
  return npx ? [...npx, '-y', `${s.pkg}@${s.pin}`, ...extraArgs] : null;
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

module.exports = { SERVERS, LAUNCHER, NO_NPX, mode, npxCommand, neutralDir, childOptions, command, record, read, pidAlive, claudeHome: paths.claudeHome };
