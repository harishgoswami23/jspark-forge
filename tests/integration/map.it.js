'use strict';
// design-v0.3 section 4, integration: real Claude Code with the real codebase-memory-mcp engine (registered for this
// run only, through --mcp-config): a "who calls X" answer arrives with JSPARK Forge's freshness line, and Claude says
// "as of <commit>". Skipped when the engine is not installed (JSPARK_FORGE_MAP_BIN or ~/forge-try/engine-trial/bin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { project, claude } = require('./lib');

const BIN = process.env.JSPARK_FORGE_MAP_BIN ||
  path.join(os.homedir(), 'forge-try', 'engine-trial', 'bin', process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp');

test('a map answer comes with "as of <commit>"', { timeout: 600000, skip: !fs.existsSync(BIN) && 'codebase-memory-mcp not installed' }, () => {
  const dir = project('map', { files: {
    'src/price.js': 'function cents (d) { return Math.round(d * 100) }\nmodule.exports = { cents }\n',
    'src/cart.js': "const { cents } = require('./price')\nfunction total (items) { return items.reduce((s, i) => s + cents(i), 0) }\nmodule.exports = { total }\n",
  } });
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-it-mapcfg-')), 'mcp.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { 'codebase-memory': { command: BIN.replace(/\\/g, '/'), args: [] } } }));
  const repo = dir.replace(/\\/g, '/');
  const prev = process.env.JSPARK_FORGE_MAP_CMD;
  process.env.JSPARK_FORGE_MAP_CMD = JSON.stringify([BIN]);
  try {
    const r = claude(dir, `Call the codebase-memory index_repository tool with repo_path "${repo}". Then call its trace_path tool with ` +
      'function_name "cents" and direction "inbound", and tell me in one sentence which function calls cents, including how fresh the map is.',
      ['--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__codebase-memory__index_repository,mcp__codebase-memory__trace_path']);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /total/, `caller not named:\n${r.out}`);
    const st = JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'map.json'), 'utf8'));
    assert.equal(st.prefix, 'mcp__codebase-memory__', 'switched on by use');
    const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    // The commit itself must be named: "as of ab7ddbc", "as of commit ab7ddbc", or JSPARK Forge's "current (as of ab7ddbc)".
    assert.ok(new RegExp(`as of (commit )?\`?${head}`, 'i').test(r.out), `no freshness in the answer:\n${r.out}`);
  } finally {
    if (prev === undefined) delete process.env.JSPARK_FORGE_MAP_CMD; else process.env.JSPARK_FORGE_MAP_CMD = prev;
  }
});
