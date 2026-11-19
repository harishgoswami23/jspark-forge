#!/usr/bin/env node
'use strict';
// JSPARK Forge hook dispatcher: `node forge.js <event>` with the hook JSON on stdin (design section 3).
// Hook rules: never raise; on any internal error print nothing, exit 0 (fail open) and log one FORGE-ERROR line.
// Writes nothing in a project without .jspark-forge/ (created by /jspark-forge:init).
const fs = require('fs');
const path = require('path');
const log = require('./lib/log');

const event = process.argv[2] || '';

function projectDirOf(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}
const isInitialised = dir => { try { return fs.statSync(path.join(dir, '.jspark-forge')).isDirectory(); } catch { return false; } };

function rel(dir, p) {
  if (!p) return '';
  const r = path.relative(dir, p);
  const shown = r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
  return shown.replace(/\\/g, '/');
}

function toolLine(dir, input) {
  const t = input.tool_name || '';
  const ti = input.tool_input || {};
  if (t === 'Edit') return ['EDIT', rel(dir, ti.file_path)];
  if (t === 'Write') return ['WRITE', rel(dir, ti.file_path)];
  if (t === 'NotebookEdit') return ['EDIT', rel(dir, ti.notebook_path || ti.file_path)];
  if (t === 'Bash') return ['BASH', ti.description ? `${ti.description} :: ${ti.command || ''}` : (ti.command || '')];
  if (t === 'PowerShell') return ['PS', ti.description ? `${ti.description} :: ${ti.command || ''}` : (ti.command || '')];
  if (t.startsWith('mcp__')) return ['MCP', t];
  return null; // todo/task/agent tools: state only (handoff, build step 5)
}

function commandOf(input) {
  const ti = input.tool_input || {};
  return ti.command || ti.file_path || ti.notebook_path || '';
}

const handlers = {
  SessionStart(dir) { log.rotate(dir, new Date()); return null; },
  UserPromptSubmit(dir, input) { return ['USER', input.prompt || '']; },
  PreToolUse() { return null; }, // block list: build step 2
  PostToolUse(dir, input) { return toolLine(dir, input); },
  PostToolUseFailure(dir, input) {
    return ['FAIL', [input.tool_name || '?', commandOf(input), input.error || ''].filter(Boolean).join(' :: ')];
  },
  Stop() { return ['STOP', '']; },
  PreCompact(dir, input) { return ['COMPACT', input.trigger || '']; }, // must print nothing (design 16, #1)
  SessionEnd(dir, input) { return ['END', input.reason || '']; },
  SubagentStart(dir, input) { return ['AGENT+', input.agent_type || '']; },
  SubagentStop(dir, input) { return ['AGENT-', input.agent_type || '']; },
};

function main(raw) {
  let input = null;
  let dir = projectDirOf(null);
  try {
    input = JSON.parse(raw);
    dir = projectDirOf(input);
    if (!isInitialised(dir)) return;
    const handler = handlers[event];
    if (!handler) return;
    const out = handler(dir, input);
    if (!out) return;
    const [kind, detail] = out;
    // Helpers' tool calls carry agent_id; SubagentStart/Stop describe the helper itself, so they stay main-session.
    const agent = event.startsWith('Subagent') ? null : input.agent_id;
    log.append(dir, { time: new Date(), session: input.session_id, agent, kind, detail }, { secrets: log.envSecrets(dir) });
  } catch (e) {
    try {
      if (isInitialised(dir)) {
        log.append(dir, { time: new Date(), session: input && input.session_id, kind: 'FORGE-ERROR',
          detail: `${event}: ${e && e.message ? e.message : e}` });
      }
    } catch { /* fail open */ }
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => { main(raw); process.exit(0); });
process.stdin.on('error', () => process.exit(0));
