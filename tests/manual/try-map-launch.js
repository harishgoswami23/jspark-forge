#!/usr/bin/env node
'use strict';
// First-user check for v0.3 (code map, database layout, launch list), about 5 minutes, in a plain terminal:
//   node "<repo>/tests/manual/try-map-launch.js"
// Opens Claude Code in a fresh test project with this checkout of JSPARK Forge, its status line, and the code map engine
// registered for this session only (--mcp-config), so ~/.claude/settings.json and your MCP setup are never changed.
// Needs the engine from the Windows trial (~/forge-try/engine-trial/bin) or JSPARK_FORGE_MAP_BIN.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const fwd = p => p.replace(/\\/g, '/');
const BIN = process.env.JSPARK_FORGE_MAP_BIN ||
  path.join(os.homedir(), 'forge-try', 'engine-trial', 'bin', process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp');
const dir = path.join(os.homedir(), 'forge-try', `map-launch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const files = {
  'README.md': '# Try the code map\n',
  'package.json': '{"name":"try-map","version":"1.0.0"}\n',
  'src/price.js': 'function cents (dollars) { return Math.round(dollars * 100) }\nmodule.exports = { cents }\n',
  'src/cart.js': "const { cents } = require('./price')\nfunction total (items) { return items.reduce((s, i) => s + cents(i), 0) }\nmodule.exports = { total }\n",
  'db/migrations/001_users.sql': 'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE\n);\n',
  'db/migrations/002_orders.sql': 'CREATE TABLE orders (\n  id SERIAL PRIMARY KEY,\n  user_id INT REFERENCES users(id),\n  total_cents INT NOT NULL\n);\n',
};
for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
g('init', '-q', '-b', 'main'); g('add', '-A');
g('-c', 'user.name=try', '-c', 'user.email=try@example.invalid', 'commit', '-qm', 'start');

const haveEngine = fs.existsSync(BIN);
const mcp = path.join(os.homedir(), 'forge-try', 'map-launch-mcp.json');
if (haveEngine) fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { 'codebase-memory': { command: fwd(BIN), args: [] } } }, null, 2));
const settings = path.join(os.homedir(), 'forge-try', 'map-launch-settings.json');
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command',
  command: `node "${fwd(path.join(PLUGIN, 'scripts', 'statusline', 'wrapper.js'))}"`, refreshInterval: 30 } }, null, 2));

console.log(`
JSPARK Forge v0.3 check   (test project: ${dir})
--------------------------------------------------------------------------------
${haveEngine ? '' : ' (The code map engine was not found, so step 1 is skipped: the map stays quiet without it.)\n'}\
 1. Code map. Paste:
      Index this repo with the codebase-memory index_repository tool, then tell me which function calls cents, and how fresh the map is.
    -> Claude names total in src/cart.js and says the map is current "as of <commit>".
 2. Database layout. Type:   /jspark-forge:schema
    -> users and orders, with columns, the foreign key orders.user_id -> users.id, and the file and line of each.
 3. Launch list. Type:   /jspark-forge:launch
    -> Claude helps you create .jspark-forge/launch.md (a date and 5 blank slots). Add two items when it asks.
 4. Scope nudge. Paste:   while we're at it, can we add dark mode?
    -> a one-line reminder to check the cost first; /jspark-forge:scope then shows the facts.
 5. Type /exit and tell Claude in the other window what you saw.
--------------------------------------------------------------------------------
`);
const args = ['--plugin-dir', PLUGIN, '--settings', settings].concat(haveEngine ? ['--mcp-config', mcp] : []);
const child = spawn('claude', args, { cwd: dir, stdio: 'inherit',
  env: Object.assign({}, process.env, { JSPARK_FORGE_AUTO_STATUSLINE: 'off' }, haveEngine ? { JSPARK_FORGE_MAP_CMD: JSON.stringify([BIN]) } : {}) });
child.on('exit', code => process.exit(code || 0));
