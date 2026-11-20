#!/usr/bin/env node
'use strict';
// v0.5 launcher for the bundled MCP servers. Claude Code starts `node run.js <name>` from the plugin's .mcp.json.
// The engines are installed once, by scripts/mcp/install.js (detached, so it survives the session), into
// <claude home>/jspark-forge/engines/; the launcher starts the installed program with Node, never through npx.
// - server mode (no extra args): run the engine with inherited stdio and record how it went. Not installed yet: start
//   the installer, record mode "installing", wait for it (nothing on stdout meanwhile), then start the engine. When the
//   server is switched off (or Playwright has no front end here) answer as an MCP server with no tools, so /mcp shows
//   no error;
// - pass-through mode (extra args, the map refresh): run the engine with those arguments and exit with its code; not
//   installed yet: start the installer and say so.
// The launcher's own spawn uses no shell, and runs the child in a neutral folder, not the project's. stdout carries MCP
// messages only; problems are one line on stderr and exit 1.
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

const WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 500;

function main() {
  const [name, ...extra] = process.argv.slice(2);
  const spec = bundled.SERVERS[name];
  if (!spec) return fail(`unknown server "${name || ''}"; use one of: ${Object.keys(bundled.SERVERS).join(', ')}`);
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const home = bundled.claudeHome();
  const mode = bundled.mode(name, project);

  if (extra.length) { // pass-through (map refresh)
    if (mode === 'off') return fail('switched off');
    const cmd = bundled.command(name, extra, home);
    if (!cmd) { // not installed (yet): make sure an installer runs, and say so
      bundled.startInstaller(home, name, project);
      return fail('the engine is still being installed');
    }
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

  let stopping = false;
  let done = false;
  let child = null;
  let timer = null;
  const finish = (code, reason) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    if (reason) rec({ exit: { code, at: Date.now(), reason } });
    if (reason && code !== 0 && /^exit code/.test(reason) === false) process.stderr.write(`jspark-forge: ${reason}\n`);
    process.exit(code);
  };
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => {
    stopping = true;
    if (child) { try { child.kill(s); } catch { /* gone */ } } else finish(0); // still waiting for the install: nothing to pass on
  });

  const run = cmd => {
    rec(Object.assign({}, base, { mode: 'run', exit: null }));
    child = start(cmd, home);
    child.on('error', e => finish(1, e.message));
    child.on('exit', (code, sig) => {
      if (code === 0) return finish(0);
      if (code === null) return stopping ? finish(0) : finish(1, `stopped by ${sig}`);
      return finish(code, `exit code ${code}`);
    });
  };

  const cmd = bundled.command(name, [], home);
  if (cmd) { rec(base); run(cmd); return undefined; }

  // Not installed: the installer runs on its own (detached); wait here, writing nothing to stdout. If Claude Code
  // ends this launcher meanwhile, the installer still finishes and the next start finds the engine.
  rec(Object.assign({}, base, { mode: 'installing' }));
  bundled.startInstaller(home, name, project);
  const until = Date.now() + WAIT_MS;
  const poll = () => {
    if (done) return;
    const c = bundled.command(name, [], home);
    if (c) return run(c);
    const r = bundled.read(home, project)[name];
    if (r && r.exit) return finish(r.exit.code || 1, r.exit.reason || 'the install failed');
    if (Date.now() > until) return finish(1, 'the install took longer than 10 minutes');
    timer = setTimeout(poll, POLL_MS);
    return undefined;
  };
  timer = setTimeout(poll, POLL_MS);
  return undefined;
}

try { main(); } catch (e) { fail(e && e.message ? e.message : String(e)); }
