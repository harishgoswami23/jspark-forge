#!/usr/bin/env node
'use strict';
// v0.5 launcher for the bundled MCP servers. Claude Code starts `node run.js <name>` from the plugin's .mcp.json.
// - server mode (no extra args): run the pinned package with inherited stdio, record how it went; when the server is
//   switched off (or Playwright has no front end here) answer as an MCP server with no tools, so /mcp shows no error;
// - pass-through mode (extra args, the map refresh): run the engine with those arguments and exit with its code.
// The launcher's own spawn uses no shell (npm itself may still use cmd.exe on Windows), and runs the child in a neutral
// folder, not the project's. stdout carries MCP messages only; problems are one line on stderr and exit 1.
const { spawn } = require('child_process');
const path = require('path');
const bundled = require('../lib/bundled');

const fail = msg => { process.stderr.write(`jspark-forge: ${msg}\n`); process.exit(1); };

// Newline-delimited JSON-RPC 2.0 with no tools. Exits when stdin closes.
function serveEmpty(name) {
  let version = '0.0.0';
  try { version = require(path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json')).version; } catch { /* keep */ }
  const send = o => process.stdout.write(`${JSON.stringify(o)}\n`);
  const handle = line => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.method !== 'string' || m.id === undefined || m.id === null) return; // notification
    if (m.method === 'initialize') {
      const v = m.params && typeof m.params.protocolVersion === 'string' ? m.params.protocolVersion : '2025-03-26';
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: `jspark-forge-${name}`, version } } });
    } else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [] } });
    else if (m.method === 'ping') send({ jsonrpc: '2.0', id: m.id, result: {} });
    else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
  };
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) handle(l); }
  });
  process.stdin.on('end', () => { if (buf.trim()) handle(buf.trim()); }); // then the process ends by itself, output flushed
  process.stdin.resume();
}

function start(cmd, home) {
  return spawn(cmd[0], cmd.slice(1), Object.assign({ stdio: 'inherit', windowsHide: true, shell: false }, bundled.childOptions(home)));
}

function main() {
  const [name, ...extra] = process.argv.slice(2);
  const spec = bundled.SERVERS[name];
  if (!spec) return fail(`unknown server "${name || ''}"; use one of: ${Object.keys(bundled.SERVERS).join(', ')}`);
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const home = bundled.claudeHome();
  const mode = bundled.mode(name, project);

  if (extra.length) { // pass-through (map refresh)
    if (mode === 'off') return fail('switched off');
    const cmd = bundled.command(name, extra);
    if (!cmd) return fail(bundled.NO_NPX);
    const child = start(cmd, home);
    child.on('error', e => fail(e.message));
    child.on('exit', (code, sig) => process.exit(code === null ? (sig ? 1 : 0) : code));
    return undefined;
  }

  const rec = fields => bundled.record(home, name, fields, project);
  // pid and project say whose this record is; a normal end removes the pid (a killed launcher leaves it, and the doctor
  // sees that the process is gone).
  const base = { pin: spec.pin, mode, startedAt: Date.now(), exit: null, pid: process.pid };
  process.on('exit', () => rec({ pid: null }));
  if (mode !== 'run') { rec(base); serveEmpty(name); return undefined; }

  const cmd = bundled.command(name);
  if (!cmd) {
    rec(Object.assign(base, { exit: { code: 1, at: Date.now(), reason: bundled.NO_NPX } }));
    return fail(bundled.NO_NPX);
  }
  rec(base);
  let stopping = false;
  let done = false;
  const child = start(cmd, home);
  const finish = (code, reason) => {
    if (done) return;
    done = true;
    if (reason) rec({ exit: { code, at: Date.now(), reason } });
    if (reason && code !== 0 && /^exit code/.test(reason) === false) process.stderr.write(`jspark-forge: ${reason}\n`);
    process.exit(code);
  };
  child.on('error', e => finish(1, e.message));
  child.on('exit', (code, sig) => {
    if (code === 0) return finish(0);
    if (code === null) return stopping ? finish(0) : finish(1, `stopped by ${sig}`);
    return finish(code, `exit code ${code}`);
  });
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { stopping = true; try { child.kill(s); } catch { /* gone */ } });
  return undefined;
}

try { main(); } catch (e) { fail(e && e.message ? e.message : String(e)); }
