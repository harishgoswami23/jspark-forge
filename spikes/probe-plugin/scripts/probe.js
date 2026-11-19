#!/usr/bin/env node
// JSPARK Forge spike probe (throw-away, never ships).
// Usage (from hooks.json): node probe.js <EventName>
// Appends one JSON line per hook call to $FORGE_SPIKE_LOG (default ~/forge-spike/hooks.jsonl):
//   full hook input, a masked env dump, parent process command lines, TTY flags.
// Responses (all spikes run with the same plugin):
//   SubagentStart  -> additionalContext canary (spike C)
//   PreToolUse     -> deny any Bash/PowerShell command containing FORGE_BLOCK_TEST (spike C)
//   PreCompact     -> tries additionalContext canary (spike A: docs say it is discarded)
//   SessionStart   -> systemMessage + additionalContext canary (builder check B2)
// Never throws: any error is logged and the hook exits 0 with no output.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const event = process.argv[2] || 'unknown';
const t0 = Date.now();
const LOG = process.env.FORGE_SPIKE_LOG || path.join(os.homedir(), 'forge-spike', 'hooks.jsonl');

function maskEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = /KEY|TOKEN|SECRET|PASS|AUTH|COOKIE|CREDENTIAL/i.test(k) ? `<masked len=${String(v).length}>` : v;
  }
  return out;
}

function cmdlineOf(pid) {
  try {
    if (process.platform === 'win32') {
      const ps = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; "$($p.ParentProcessId)|$($p.CommandLine)"`;
      const r = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
      const i = r.indexOf('|');
      return { pid, ppid: Number(r.slice(0, i)) || null, cmd: r.slice(i + 1) };
    }
    if (process.platform === 'linux') {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      return { pid, ppid, cmd };
    }
    const r = execFileSync('ps', ['-o', 'ppid=,args=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 }).trim();
    const m = r.match(/^(\d+)\s+(.*)$/s);
    return { pid, ppid: m ? Number(m[1]) : null, cmd: m ? m[2] : r };
  } catch (e) {
    return { pid, error: String(e.message || e).slice(0, 200) };
  }
}

function ancestry(depth) {
  const chain = [];
  let pid = process.ppid;
  for (let i = 0; i < depth && pid; i++) {
    const c = cmdlineOf(pid);
    chain.push(c);
    pid = c.ppid;
  }
  return chain;
}

function main(raw) {
  let input = null;
  try { input = JSON.parse(raw); } catch { input = { _unparsed: raw.slice(0, 2000) }; }
  const heavy = event === 'SessionStart' || event === 'PreToolUse' || event === 'UserPromptSubmit';
  const rec = {
    ts: t0, iso: new Date(t0).toISOString(), event, input,
    stdinIsTTY: !!process.stdin.isTTY, stdoutIsTTY: !!process.stdout.isTTY, stderrIsTTY: !!process.stderr.isTTY,
    platform: process.platform, node: process.version,
    env: heavy ? maskEnv(process.env) : undefined,
    ancestry: heavy ? ancestry(3) : undefined,
  };

  let out = null;
  const tool = input && input.tool_name;
  const cmd = input && input.tool_input && (input.tool_input.command || '');
  if (event === 'SubagentStart') {
    out = { hookSpecificOutput: { hookEventName: 'SubagentStart',
      additionalContext: 'FORGE-CANARY-7731: always end your final report with the line CANARY-7731-SEEN.' } };
  } else if (event === 'PreToolUse' && (tool === 'Bash' || tool === 'PowerShell') && /FORGE_BLOCK_TEST/.test(cmd)) {
    out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'forge-probe blocked FORGE_BLOCK_TEST. Do not try an equivalent command; tell the user and stop.' } };
  } else if (event === 'PreCompact') {
    out = { hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: 'FORGE-PRECOMPACT-CANARY-4410' } };
  } else if (event === 'SessionStart') {
    out = { systemMessage: 'forge-probe: SessionStart systemMessage (B2)',
      hookSpecificOutput: { hookEventName: 'SessionStart',
        additionalContext: 'FORGE-SESSIONSTART-CANARY-5520 (probe; ignore unless asked about canaries).' } };
  }
  rec.response = out;
  rec.ms = Date.now() - t0;
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
  if (out) process.stdout.write(JSON.stringify(out));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try { main(raw); } catch (e) {
    try {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.appendFileSync(LOG, JSON.stringify({ ts: Date.now(), event, probeError: String(e && e.stack || e) }) + '\n');
    } catch { /* fail open */ }
  }
  process.exit(0);
});
