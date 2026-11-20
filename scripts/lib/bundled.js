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

// npm's own npx script run by the running Node: no shell, so JSON arguments and paths with spaces arrive unchanged
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
function read(home) {
  try {
    const o = JSON.parse(fs.readFileSync(file(home), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
// Merges `fields` into the entry for `name`; read-modify-write under a lock (both servers start at the same moment).
function record(home, name, fields) {
  try {
    const f = file(home);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    require('./memory').withLock(f, () => {
      const cur = read(home);
      cur[name] = Object.assign({}, cur[name], fields);
      require('./fsx').writeAtomic(f, `${JSON.stringify(cur, null, 2)}\n`);
    });
  } catch { /* never throws */ }
}

module.exports = { SERVERS, LAUNCHER, NO_NPX, mode, npxCommand, command, record, read, claudeHome: paths.claudeHome };
