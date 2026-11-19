#!/usr/bin/env node
'use strict';
// JSPARK Forge hook dispatcher: `node forge.js <HookEvent>` with the hook JSON on stdin (design section 3),
// or `node forge.js save [--done]` from the /jspark-forge:handoff skill.
// Hook rules: never raise; on any internal error print nothing, exit 0 (fail open) and log one FORGE-ERROR line.
// Writes nothing in a project without .jspark-forge/ (created by /jspark-forge:init).
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./lib/log');
const { redact } = require('./lib/redact');
const { check, BUILTINS, isGitCommit, toFs } = require('./lib/blocklist');
const { loadRules } = require('./lib/rules');
const confirm = require('./lib/confirm');
const shell = require('./lib/shell');
const state = require('./lib/state');
const handoff = require('./lib/handoff');
const git = require('./lib/git');
const { parsePlan } = require('./lib/plan');

const event = process.argv[2] || '';
const DEBOUNCE_MS = 5000;

// ---------- helpers ----------
const isInitialised = dir => { try { return fs.statSync(path.join(dir, '.jspark-forge')).isDirectory(); } catch { return false; } };
function findProject(start) {
  let d = path.resolve(start);
  for (;;) { if (isInitialised(d)) return d; const up = path.dirname(d); if (up === d) return null; d = up; }
}
const projectDirOf = input => process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();

function rel(dir, p) {
  if (!p) return '';
  const r = path.relative(dir, p);
  const shown = r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
  return shown.replace(/\\/g, '/');
}
function insideProject(dir, abs) {
  const r = path.relative(dir, abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) && !r.replace(/\\/g, '/').startsWith('.jspark-forge');
}

function toolLine(dir, input) {
  const t = input.tool_name || '';
  const ti = input.tool_input || {};
  const shellLine = () => (ti.description ? `${ti.description} :: ${ti.command || ''}` : (ti.command || ''));
  if (t === 'Edit') return ['EDIT', rel(dir, ti.file_path)];
  if (t === 'Write') return ['WRITE', rel(dir, ti.file_path)];
  if (t === 'NotebookEdit') return ['EDIT', rel(dir, ti.notebook_path || ti.file_path)];
  if (t === 'Bash') return ['BASH', shellLine()];
  if (t === 'PowerShell') return ['PS', shellLine()];
  if (t.startsWith('mcp__')) return ['MCP', t];
  return null;
}

// Files a tool call wrote inside the project (save trigger a): Edit/Write/NotebookEdit, or a Bash-form
// redirect / tee into the project. PowerShell forms (Set-Content, Out-File) come in v0.1.1.
function writtenFiles(dir, input) {
  const t = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || dir;
  let paths = [];
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') paths = [ti.file_path || ti.notebook_path];
  else if (t === 'Bash' || t === 'PowerShell') {
    for (const pl of shell.parse(ti.command || '')) for (const st of pl) {
      paths.push(...st.redirects);
      const c = shell.command(st.words);
      if (c && c.cmd === 'tee') paths.push(...c.args.filter(a => !a.startsWith('-')));
    }
  }
  return paths.filter(p => p && !/^\/dev\//.test(p) && !/^nul$/i.test(p) && !/[$`]/.test(p))
    .map(p => path.resolve(toFs(cwd), toFs(p)))
    .filter(abs => insideProject(dir, abs));
}

const branchOf = dir => git.headBranch(dir) || ''; // read from .git/HEAD, no git process
const blockCtx = (dir, rules) => ({ projectDir: dir, home: os.homedir(), rules, branchOf });
const confirmableIds = rules => Object.keys(BUILTINS).concat(rules.confirm.map(r => r.id));
const preTool = (decision, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } });
const context = (ev, text) => ({ hookSpecificOutput: { hookEventName: ev, additionalContext: text } });
const notesOn = dir => loadRules(dir).settings.notes !== 'off';

function lastQuestion(msg) {
  const t = String(msg || '').trim();
  if (!t.endsWith('?')) return null;
  const q = t.split(/(?<=[.!?])\s+/).pop();
  return `Claude asked: "${q.length > 150 ? `${q.slice(0, 149)}…` : q}"`;
}

function doSave(dir, sid, reason, lines, opts) {
  handoff.save(dir, sid, reason, opts);
  lines.push(['SAVE', reason]);
}

// ---------- handlers ----------
// A handler returns null, [kind, detail] (one log line), or { lines: [[kind, detail], ...], out: <hook JSON> }.
const handlers = {
  SessionStart(dir, input) {
    log.rotate(dir, new Date());
    handoff.pruneArchive(dir);
    const rules = loadRules(dir);
    const msgs = rules.errors.map(e => `JSPARK Forge: .jspark-forge/rules.md line ${e.line} skipped (${e.message}).`);
    if (rules.disabled.length) msgs.push(`JSPARK Forge: you switched off ${rules.disabled.join(', ')} in rules.md.`);
    const rc = handoff.resumeContext(dir, input.session_id, input.source || 'startup');
    if (rc.systemMessage) msgs.unshift(rc.systemMessage);
    const out = context('SessionStart', rc.context);
    if (msgs.length) out.systemMessage = msgs.join('\n');
    return { lines: [['GROUNDING', input.source || '']], out };
  },

  UserPromptSubmit(dir, input) {
    const prompt = String(input.prompt || '');
    const lines = [['USER', prompt]];
    if (!/^\s*\//.test(prompt) && !/^\s*confirm\s+[\w-]+\s*$/i.test(prompt)) {
      const sess = state.readSession(dir, input.session_id);
      sess.lastPrompt = redact(prompt, log.envSecrets(dir)).replace(/\s+/g, ' ').trim().slice(0, 200);
      state.writeSession(dir, input.session_id, sess);
    }
    const granted = confirm.grantFromPrompt(dir, input.session_id, prompt, confirmableIds(loadRules(dir)));
    for (const id of granted) lines.push(['CONFIRM', `${id} granted`]);
    const out = granted.length ? context('UserPromptSubmit',
      `JSPARK Forge: the user typed CONFIRM ${granted.join(', ')}. The next matching action is allowed once within 5 minutes; ` +
      'Claude Code will still ask the user for a final yes/no.') : null;
    return { lines, out };
  },

  PreToolUse(dir, input) {
    const rules = loadRules(dir);
    const r = check(input, blockCtx(dir, rules));
    if (r) {
      const what = String(r.matched || '');
      if (!r.hard && confirm.consume(dir, input.session_id, r.id)) {
        return { lines: [['CONFIRM', `${r.id} used :: ${what}`]],
          out: preTool('ask', `JSPARK Forge: you typed CONFIRM ${r.id}, so this is allowed once: ${r.plain}.`) };
      }
      return { lines: [['BLOCK', `${r.id} :: ${what}`]], out: preTool('deny', r.reason) };
    }
    const t = input.tool_name;
    if ((t === 'Bash' || t === 'PowerShell') && rules.settings.notes !== 'off' &&
        isGitCommit((input.tool_input || {}).command || '', input.cwd || dir)) {
      return { lines: [], out: context('PreToolUse', handoff.NOTES_LINE) }; // design 5.3
    }
    return null;
  },

  PostToolUse(dir, input) {
    const lines = [];
    const first = toolLine(dir, input);
    if (first) lines.push(first);
    const sid = input.session_id;
    const t = input.tool_name || '';
    const ti = input.tool_input || {};
    const now = Date.now();
    const sess = state.readSession(dir, sid);
    const task = state.readTask(dir);
    let sessDirty = false, taskDirty = false;

    if (t === 'TodoWrite' && Array.isArray(ti.todos)) {
      task.todos = ti.todos.map(x => ({ content: String(x.content || ''), status: String(x.status || 'pending') }));
      taskDirty = true;
    }
    const bgId = input.tool_response && input.tool_response.backgroundTaskId;
    if (bgId && !sess.background.some(b => b.id === bgId)) {
      sess.background.push({ id: bgId, command: ti.command || '', description: ti.description || '', at: now });
      sessDirty = true;
    }
    const written = writtenFiles(dir, input);
    for (const abs of written) {
      const r = rel(dir, abs);
      if (r.startsWith('.superpowers/')) continue; // superpowers' own ledger and briefs: saves, but not "files touched"
      task.files = [r].concat(task.files.filter(f => f !== r)).slice(0, 50);
      if (/\.md$/i.test(r)) { try { if (parsePlan(fs.readFileSync(abs, 'utf8'))) task.planFile = r; } catch {} }
      taskDirty = true;
    }
    let reason = null;
    if ((t === 'Bash' || t === 'PowerShell') && isGitCommit(ti.command || '', input.cwd || dir)) {
      const gi = git.gitInfo(dir);
      if (gi && gi.head && gi.head !== (sess.git && sess.git.head)) {
        const lc = git.lastCommit(dir);
        if (lc) { task.lastCommit = lc; taskDirty = true; lines.push(['COMMIT', `${lc.sha} ${lc.subject}`]); }
        reason = 'commit';
      }
    }
    if (!reason && written.length && now - sess.lastSaveAt >= DEBOUNCE_MS) reason = 'file write';
    if (sessDirty) state.writeSession(dir, sid, sess);
    if (taskDirty) state.writeTask(dir, task);
    if (reason) doSave(dir, sid, reason, lines);
    return { lines, out: null };
  },

  PostToolUseFailure(dir, input) {
    const ti = input.tool_input || {};
    const what = ti.command || ti.file_path || ti.notebook_path || '';
    return ['FAIL', [input.tool_name || '?', what, input.error || ''].filter(Boolean).join(' :: ')];
  },

  Stop(dir, input) {
    const sid = input.session_id;
    const sess = state.readSession(dir, sid);
    if (Array.isArray(input.background_tasks)) {
      const prev = new Map(sess.background.map(b => [b.id, b]));
      sess.background = input.background_tasks.filter(b => b && b.status === 'running')
        .map(b => ({ id: b.id, command: b.command || '', description: b.description || '', at: (prev.get(b.id) || {}).at || Date.now() }));
    }
    sess.waiting = lastQuestion(input.last_assistant_message);
    state.writeSession(dir, sid, sess);
    const lines = [['STOP', '']];
    doSave(dir, sid, 'reply finished', lines);
    return { lines, out: null };
  },

  PreCompact(dir, input) { // must print nothing (design 16, deviation 1)
    const sid = input.session_id;
    if (notesOn(dir)) { const sess = state.readSession(dir, sid); sess.notesDue = true; state.writeSession(dir, sid, sess); }
    const lines = [['COMPACT', input.trigger || '']];
    doSave(dir, sid, 'before compaction', lines);
    return { lines, out: null };
  },

  SessionEnd(dir, input) { // minimal write, no git: Stop already saved the content (design 4, trigger e)
    const sid = input.session_id;
    const sess = state.readSession(dir, sid);
    sess.ended = { reason: input.reason || 'other', at: Date.now() };
    state.writeSession(dir, sid, sess);
    const lines = [['END', input.reason || '']];
    // Keep the last real save reason in the header; the "session ended" stamp says the rest.
    handoff.save(dir, sid, sess.lastSaveReason || 'session end', { refreshGit: false });
    lines.push(['SAVE', 'session end']);
    return { lines, out: null };
  },

  SubagentStart(dir, input) {
    if (input.agent_id) {
      const sess = state.readSession(dir, input.session_id);
      sess.helpers[input.agent_id] = { type: input.agent_type || 'agent', at: Date.now() };
      state.writeSession(dir, input.session_id, sess);
    }
    return ['AGENT+', input.agent_type || ''];
  },

  SubagentStop(dir, input) { // an unpaired stop (internal helpers) is ignored (design 16, deviation 6)
    const sess = state.readSession(dir, input.session_id);
    if (input.agent_id && sess.helpers[input.agent_id]) {
      delete sess.helpers[input.agent_id];
      state.writeSession(dir, input.session_id, sess);
    }
    return ['AGENT-', input.agent_type || ''];
  },
};

// ---------- hook entry ----------
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

// ---------- `forge.js save [--done]` (the /jspark-forge:handoff skill) ----------
function cliSave(args) {
  const dir = process.env.CLAUDE_PROJECT_DIR && isInitialised(process.env.CLAUDE_PROJECT_DIR)
    ? process.env.CLAUDE_PROJECT_DIR : findProject(process.cwd());
  if (!dir) { process.stdout.write('JSPARK Forge is not set up in this project yet (run /jspark-forge:init).\n'); return; }
  const sid = process.env.CLAUDE_CODE_SESSION_ID || 'manual';
  const lines = [];
  doSave(dir, sid, 'manual', lines);
  if (args.includes('--done')) {
    handoff.archive(dir);
    lines.push(['SAVE', 'task closed, handoff archived']);
  }
  for (const [kind, detail] of lines) log.append(dir, { time: new Date(), session: sid, kind, detail });
  process.stdout.write(args.includes('--done')
    ? 'Task closed. The handoff is archived in .jspark-forge/archive/; the next session starts fresh.\n'
    : 'Handoff saved. Next session, JSPARK Forge shows where you were.\n');
}

if (event === 'save') {
  try { cliSave(process.argv.slice(3)); } catch (e) { process.stdout.write(`JSPARK Forge could not save: ${e.message}\n`); }
} else {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  // No process.exit(): on Windows a pipe write is asynchronous, so exiting early could cut the reply short.
  process.stdin.on('end', () => { process.exitCode = 0; main(raw); });
  process.stdin.on('error', () => { process.exitCode = 0; });
}
