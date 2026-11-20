'use strict';
// v0.5 ship gate (design-v0.5 section 6): what real Claude Code says it loaded from this plugin. Runs first in CI, so
// when hooks do not fire there, the job shows why (plugins, plugin_errors, the servers) instead of twelve missing lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PLUGIN, project, loadReport, kinds, logText } = require('./lib');

test('Claude Code loads the plugin with no errors, connects its two servers, and its hooks fire', { timeout: 600000 }, () => {
  const dir = project('load');
  const r = loadReport(dir);
  const show = `exit ${r.status}\n--- stderr ---\n${r.err.slice(-2000)}\n--- init ---\n${JSON.stringify(r.init, null, 1)}\n--- log ---\n${logText(dir)}`;
  process.stdout.write(`# load report: plugins ${JSON.stringify(r.init && r.init.plugins)} · plugin_errors ${JSON.stringify(r.init && r.init.plugin_errors)} · mcp_servers ${JSON.stringify(r.init && r.init.mcp_servers)}\n`);
  assert.ok(r.init, `no system/init message\n${show}`);
  const same = p => path.resolve(String(p || '')).toLowerCase() === PLUGIN.toLowerCase();
  assert.ok((r.init.plugins || []).some(p => p.name === 'jspark-forge' && same(p.path)), `jspark-forge is not in plugins\n${show}`);
  assert.deepEqual(r.init.plugin_errors || [], [], show); // the key is left out when there are no errors
  const servers = (r.init.mcp_servers || []).filter(s => /jspark-forge/.test(s.name));
  for (const name of ['codebase-memory', 'playwright']) {
    const s = servers.find(x => x.name.endsWith(name));
    assert.ok(s, `server ${name} is not listed\n${show}`);
    assert.notEqual(s.status, 'failed', `server ${name} failed\n${show}`);
  }
  assert.equal(r.status, 0, show);
  const k = kinds(dir);
  for (const kind of ['GROUNDING', 'USER', 'STOP']) assert.ok(k.has(kind), `hook line ${kind} is missing\n${show}`);
});
