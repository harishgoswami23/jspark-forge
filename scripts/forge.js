#!/usr/bin/env node
'use strict';
// JSPARK Forge hook dispatcher: `node forge.js <event>` with the hook JSON on stdin (design section 3).
// Hook rules: never raise; on any internal error print nothing, exit 0 (fail open) and log one FORGE-ERROR line.
// Writes nothing in a project without .jspark-forge/ (created by /jspark-forge:init).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const log = require('./lib/log');
const { check, BUILTINS } = require('./lib/blocklist');
const { loadRules } = require('./lib/rules');
const confirm = require('./lib/confirm');

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

function branchOf(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
    { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
const blockCtx = (dir, rules) => ({ projectDir: dir, home: os.homedir(), rules, branchOf });
const confirmableIds = rules => Object.keys(BUILTINS).concat(rules.confirm.map(r => r.id));
const preTool = (decision, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } });

// A handler returns null, [kind, detail] (one log line), or { lines: [[kind, detail], ...], out: <hook JSON> }.
const handlers = {
  SessionStart(dir) {
    log.rotate(dir, new Date());
    const rules = loadRules(dir);
    const msgs = rules.errors.map(e => `JSPARK Forge: .jspark-forge/rules.md line ${e.line} skipped (${e.message}).`);
    if (rules.disabled.length) msgs.push(`JSPARK Forge: you switched off ${rules.disabled.join(', ')} in rules.md.`);
    return { lines: [], out: msgs.length ? { systemMessage: msgs.join('\n') } : null };
  },
  UserPromptSubmit(dir, input) {
    const lines = [['USER', input.prompt || '']];
    const granted = confirm.grantFromPrompt(dir, input.session_id, input.prompt, confirmableIds(loadRules(dir)));
    for (const id of granted) lines.push(['CONFIRM', `${id} granted`]);
    const out = granted.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext:
      `JSPARK Forge: the user typed CONFIRM ${granted.join(', ')}. The next matching action is allowed once within 5 minutes; ` +
      'Claude Code will still ask the user for a final yes/no.' } } : null;
    return { lines, out };
  },
  PreToolUse(dir, input) {
    const rules = loadRules(dir);
    const r = check(input, blockCtx(dir, rules));
    if (!r) return null;
    const what = String(r.matched || '');
    if (!r.hard && confirm.consume(dir, input.session_id, r.id)) {
      return { lines: [['CONFIRM', `${r.id} used :: ${what}`]],
        out: preTool('ask', `JSPARK Forge: you typed CONFIRM ${r.id}, so this is allowed once: ${r.plain}.`) };
    }
    return { lines: [['BLOCK', `${r.id} :: ${what}`]], out: preTool('deny', r.reason) };
  },
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
    const res = handler(dir, input);
    if (!res) return;
    const { lines, out } = Array.isArray(res) ? { lines: [res], out: null } : res;
    // Helpers' tool calls carry agent_id; SubagentStart/Stop describe the helper itself, so they stay main-session.
    const agent = event.startsWith('Subagent') ? null : input.agent_id;
    const secrets = lines.length ? log.envSecrets(dir) : [];
    for (const [kind, detail] of lines) {
      log.append(dir, { time: new Date(), session: input.session_id, agent, kind, detail }, { secrets });
    }
    if (out) process.stdout.write(JSON.stringify(out));
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
// No process.exit(): on Windows a pipe write is asynchronous, so exiting early could cut the reply short.
process.stdin.on('end', () => { process.exitCode = 0; main(raw); });
process.stdin.on('error', () => process.exit(0));
