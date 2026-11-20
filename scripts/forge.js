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
const { check, BUILTINS, STOP, isGitCommit, writeTargets, changeTargets, toFs } = require('./lib/blocklist');
const memory = require('./lib/memory');
const dialectOf = tool => (tool === 'PowerShell' ? 'ps' : 'bash');
const { loadRules } = require('./lib/rules');
const confirm = require('./lib/confirm');
const shell = require('./lib/shell');
const state = require('./lib/state');
const handoff = require('./lib/handoff');
const waiting = require('./lib/waiting');
const git = require('./lib/git');
const { parsePlan } = require('./lib/plan');
const usageLib = require('./lib/usage');
const setup = require('./lib/setup');
const paths = require('./lib/paths');
const licence = require('./lib/licence');
const uitip = require('./lib/uitip');

const event = process.argv[2] || '';
const DEBOUNCE_MS = 5000;

// ---------- helpers ----------
const isInitialised = dir => paths.isActive(dir);
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
  else if (t === 'Bash' || t === 'PowerShell') paths = writeTargets(ti.command || '', dialectOf(t));
  return paths.filter(p => p && !/^\/dev\//.test(p) && !/^nul$/i.test(p) && !/[$`]/.test(p))
    .map(p => path.resolve(toFs(cwd), toFs(p)))
    .filter(abs => insideProject(dir, abs));
}

const branchOf = dir => git.headBranch(dir) || ''; // read from .git/HEAD, no git process
// quarantine: only in a guest repo after /jspark-forge:init --guest (one small file read, no git).
const blockCtx = (dir, rules) => ({ projectDir: dir, home: os.homedir(), rules, branchOf,
  quarantine: paths.isGuest(dir) && !!(paths.guestMeta(dir) || {}).quarantine, repoRoot: paths.repoRoot(dir) });
// A Never rule's id is confirmable only for its "took too long to check" hold; a real Never match is hard and never spends a token.
const confirmableIds = rules => Object.keys(BUILTINS).concat(rules.confirm.map(r => r.id), rules.never.map(r => r.id));
const preTool = (decision, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } });
const context = (ev, text) => ({ hookSpecificOutput: { hookEventName: ev, additionalContext: text } });
const notesOn = dir => loadRules(dir).settings.notes !== 'off';

const WAIT_CTX = 'JSPARK Forge: these questions to the user are still open (spec 5.2a). Ask them again in one short list, ' +
  "or carry on with work they do not block and say what is parked. Never act on a recommendation without the user's answer.";
function waitingNotice(dir) { // -> { msg, ctx } for session start, or null
  const items = waiting.read(dir);
  if (!items.length) return null;
  const list = items.map((x, i) => `${i + 1}. ${waiting.line(x)}`).join('\n');
  return { msg: `Waiting on you (${items.length}):\n${list}\nAnswer here, or run /jspark-forge:waiting.`, ctx: `${WAIT_CTX}\n${list}` };
}

function doSave(dir, sid, reason, lines, opts) {
  if (handoff.save(dir, sid, reason, opts)) lines.push(['SAVE', reason]); // null: no work to resume, nothing written
}

// Decision memory just in time (design-v0.2 1.3): the decisions about the files this call changes, each shown once
// per conversation (per helper: agent_id). Called only for allowed calls, so a denied one uses nothing up.
function decisionNotes(dir, input) {
  const t = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || dir;
  let files = [];
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') files = [ti.file_path || ti.notebook_path];
  // A shell word with $ or ` is not a real path yet; a tool's file path can contain $ (Remix routes: review M3).
  else if (t === 'Bash' || t === 'PowerShell') files = changeTargets(ti.command || '', dialectOf(t), cwd).map(toFs).filter(p => !/[$`]/.test(p));
  files = files.filter(Boolean);
  if (!files.length || !memory.load(dir).length) return null;
  // "Already shown" lives in its own merged file, not the session file (review M1: parallel hooks lost ids).
  const key = input.agent_id || 'main';
  const n = memory.notesFor(dir, toFs(cwd), files, memory.readShown(dir, input.session_id)[key] || []);
  if (!n) return null;
  memory.addShown(dir, input.session_id, key, n.ids);
  return n;
}

// Offers to record and stale flags (design-v0.2 1.4, 1.5) go to the main conversation only (a helper's reply goes to
// its parent, not the user), only in attended sessions (someone can answer), never at 95 % usage. Mutates sess.
function offerContext(dir, input, sess) {
  if (input.agent_id || process.env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return null;
  const pct = usageLib.highest(dir, input.session_id);
  if (pct !== null && pct >= 95) return null;
  return memory.deliver(sess);
}

const MODEL_MAP_LINE = 'JSPARK Forge model map: when a superpowers skill dispatches a helper, use subagent_type ' +
  'jspark-forge:builder for implementers, jspark-forge:reviewer for spec and code reviews, and jspark-forge:checker for ' +
  'mechanical checks (tests, logs); jspark-forge:planner for designs and plans. Each runs on its tier (strongest for ' +
  'planner and reviewer, standard for builder, light for checker); if you also pass a model, pass the same tier.';

// ---------- handlers ----------
// A handler returns null, [kind, detail] (one log line), or { lines: [[kind, detail], ...], out: <hook JSON> }.
const handlers = {
  SessionStart(dir, input) {
    log.rotate(dir, new Date());
    handoff.pruneArchive(dir);
    const rules = loadRules(dir);
    const msgs = rules.errors.map(e => `JSPARK Forge: ${e.file || '.jspark-forge/rules.md'} line ${e.line} skipped (${e.message}).`);
    for (const r of rules.readonly) {
      if (!fs.existsSync(path.resolve(dir, r.path))) msgs.push(`JSPARK Forge: read-only source ${r.path} was not found (the rule is kept).`);
    }
    // Licence check (spec 5.2b): a guest repo and each existing read-only source, one line each, once per licence.
    const licItems = rules.readonly.filter(r => fs.existsSync(path.resolve(dir, r.path))).map(r => ({ label: r.path, folder: path.resolve(dir, r.path) }));
    if (paths.isGuest(dir)) licItems.unshift({ label: 'this repo', folder: paths.repoRoot(dir) });
    if (licItems.length) msgs.push(...licence.notices(dir, licItems));
    const uiTip = uitip.notice(dir); // UI/UX companions tip, once per own front-end project (spec 5.14)
    if (uiTip) msgs.push(uiTip);
    if (rules.disabled.length) msgs.push(`JSPARK Forge: you switched off ${rules.disabled.join(', ')} in rules.md.`);
    let offerAfterCompact = null;
    if (input.source === 'compact') { // the summary dropped the decisions Claude was shown: show them again when relevant
      const sess = state.readSession(dir, input.session_id);
      memory.clearShown(dir, input.session_id);
      sess.offerTurn = null; // and pending offers to record come back once (design-v0.2 1.4)
      offerAfterCompact = offerContext(dir, input, sess);
      state.writeSession(dir, input.session_id, sess);
    }
    const rc = handoff.resumeContext(dir, input.session_id, input.source || 'startup');
    if (offerAfterCompact) rc.context = `${rc.context}\n\n${offerAfterCompact}`;
    // Model map (design-v0.2 4): superpowers starts general-purpose helpers and names a model per call, so with it the
    // map is steered, not enforced: one line asking Claude to use JSPARK Forge's helpers.
    try {
      if (setup.superpowersInstalled(setup.claudeHome())) rc.context = `${rc.context}\n\n${MODEL_MAP_LINE}`;
    } catch { /* never break a session start */ }
    // Decision memory (design-v0.2 1.6): the index of titles for Claude; for the user, entries that arrived with git
    // (once) and one line when some need a look. Off in guest repos (the functions check).
    try {
      const idx = memory.index(dir);
      if (idx) rc.context = `${rc.context}\n\n${idx}`;
      const arrived = memory.arrivals(dir);
      if (arrived) msgs.push(arrived);
      const n = memory.problems(dir);
      if (n) msgs.push(`JSPARK Forge: ${n} decision${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a look: /jspark-forge:check`);
    } catch { /* never break a session start */ }
    if (rc.systemMessage) msgs.unshift(rc.systemMessage);
    const w = input.source === 'compact' ? null : waitingNotice(dir); // shown first (spec 5.2a)
    if (w) msgs.unshift(w.msg);
    const out = context('SessionStart', w ? `${rc.context}\n\n${w.ctx}` : rc.context);
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
      // The user replied: a question Claude ended its last reply with is answered (spec 5.2a).
      const n = waiting.remove(dir, x => x.source === 'reply' && x.session === input.session_id);
      if (n) lines.push(['WAIT', `${n} answered`]);
    }
    const granted = confirm.grantFromPrompt(dir, input.session_id, prompt, confirmableIds(loadRules(dir)));
    for (const id of granted) lines.push(['CONFIRM', `${id} granted`]);
    const say = id => (confirm.SESSION_LONG.has(id)
      ? `JSPARK Forge: the user typed CONFIRM ${id}. Matching actions are allowed for the rest of this session.`
      : `JSPARK Forge: the user typed CONFIRM ${id}. The next matching action is allowed once within 5 minutes; ` +
        'Claude Code will still ask the user for a final yes/no.');
    const parts = granted.map(say);
    // A new user turn: pending offers to record are delivered again (design-v0.2 1.4).
    const sess = state.readSession(dir, input.session_id);
    sess.turn = (sess.turn || 0) + 1;
    // A short reply ("yes", "skip", "edit: …") is most likely the answer to the last offer: do not repeat it with it.
    const offer = prompt.trim().length < 25 ? null : offerContext(dir, input, sess);
    state.writeSession(dir, input.session_id, sess);
    if (offer) parts.push(offer);
    const out = parts.length ? context('UserPromptSubmit', parts.join('\n')) : null;
    return { lines, out };
  },

  PreToolUse(dir, input) {
    if (input.tool_name === 'AskUserQuestion') { // filed before the dialog shows: a cutoff cannot lose it (spec 5.2a)
      const n = waiting.add(dir, waiting.fromTool(input.tool_input, input.session_id));
      return n ? ['WAIT', `${n} asked`] : null;
    }
    const rules = loadRules(dir);
    let hits = check(input, blockCtx(dir, rules), { all: true });
    // A session-long CONFIRM (guest-quarantine) removes only its own hit: every other block in the same command is
    // still judged (Fable review H2: "npm test && git push --force origin main").
    const lines = [];
    for (const id of confirm.SESSION_LONG) {
      if (hits.some(h => h.id === id) && confirm.consume(dir, input.session_id, id)) {
        hits = hits.filter(h => h.id !== id);
        lines.push(['CONFIRM', `${id} used :: ${String((input.tool_input || {}).command || '')}`]);
      }
    }
    const r = hits[0]; // hard hits first
    if (r) {
      const what = String(r.matched || '');
      // Every different block in the command needs its own CONFIRM; tokens are spent only when all are there
      // (Fable verification N6: "git reset --hard && git push --force origin main").
      const ids = [...new Set(hits.map(h => h.id))];
      const plains = ids.map(id => hits.find(h => h.id === id).plain);
      if (!r.hard && ids.every(id => confirm.has(dir, input.session_id, id))) {
        for (const id of ids) confirm.consume(dir, input.session_id, id);
        const out = preTool('ask', `JSPARK Forge: you typed ${ids.map(id => `CONFIRM ${id}`).join(' and ')}, so this is allowed once: ${plains.join('; and ')}.`);
        const n = decisionNotes(dir, input); // allowed: the decisions about its files come with it (design-v0.2 1.3)
        if (n) out.hookSpecificOutput.additionalContext = n.text;
        return { lines: lines.concat(ids.map(id => ['CONFIRM', `${id} used :: ${what}`]), n ? [['DECISION', n.ids.join(',')]] : []), out };
      }
      const reason = r.hard || ids.length === 1 ? r.reason
        : `JSPARK Forge blocked: ${plains.join('; and ')}. ${STOP} To allow it once, the user types: ${ids.map(id => `CONFIRM ${id}`).join(' and ')}`;
      return { lines: lines.concat([['BLOCK', `${ids.join(',')} :: ${what}`]]), out: preTool('deny', reason) }; // denied: no notes
    }
    // Allowed. One context for everything: the decisions about the files it changes and the notes reminder before a
    // commit (design-v0.2 1.3, design 5.3).
    const parts = [];
    const n = decisionNotes(dir, input);
    if (n) { parts.push(n.text); lines.push(['DECISION', n.ids.join(',')]); }
    const t = input.tool_name;
    if ((t === 'Bash' || t === 'PowerShell') && rules.settings.notes !== 'off' &&
        isGitCommit((input.tool_input || {}).command || '', input.cwd || dir, dialectOf(t))) {
      parts.push(handoff.notesLine(dir));
    }
    if (parts.length) return { lines, out: context('PreToolUse', parts.join('\n\n')) };
    if (lines.length) return { lines, out: null }; // allowed for the session: Claude Code's normal permission flow decides
    return null;
  },

  PostToolUse(dir, input) {
    const lines = [];
    const first = toolLine(dir, input);
    if (first) lines.push(first);
    const sid = input.session_id;
    const t = input.tool_name || '';
    const ti = input.tool_input || {};
    if (t === 'AskUserQuestion') { // answered in the dialog
      const asked = new Set(waiting.fromTool(ti, sid).map(q => q.question.replace(/\s+/g, ' ').trim()));
      const n = waiting.remove(dir, x => x.session === sid && asked.has(x.question));
      if (n) lines.push(['WAIT', `${n} answered`]);
      return { lines, out: null };
    }
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
    if (t === 'ExitPlanMode' && !input.agent_id && memory.noteApproved(dir, sess, (input.tool_response || {}).plan)) sessDirty = true; // spike E
    const written = writtenFiles(dir, input);
    for (const abs of written) {
      const r = rel(dir, abs);
      if (r.startsWith('.superpowers/')) continue; // superpowers' own ledger and briefs: saves, but not "files touched"
      task.files = [r].concat(task.files.filter(f => f !== r)).slice(0, 50);
      if (/\.md$/i.test(r)) { try { if (parsePlan(fs.readFileSync(abs, 'utf8'))) task.planFile = r; } catch {} }
      if (/^docs\/superpowers\/(plans|specs)\/[^/]+\.md$/i.test(r) && memory.notePlan(dir, sess, r)) sessDirty = true; // design-v0.2 1.4
      taskDirty = true;
    }
    let reason = null;
    if ((t === 'Bash' || t === 'PowerShell') && isGitCommit(ti.command || '', input.cwd || dir, dialectOf(t))) {
      const gi = git.gitInfo(dir);
      if (gi && gi.head && gi.head !== (sess.git && sess.git.head)) {
        const lc = git.lastCommit(dir);
        if (lc) {
          task.lastCommit = { sha: lc.sha, subject: lc.subject }; taskDirty = true; lines.push(['COMMIT', `${lc.sha} ${lc.subject}`]);
          if (memory.noteCommit(dir, sess, lc)) sessDirty = true; // an offer to record, stale flags (design-v0.2 1.4, 1.5)
        }
        reason = 'commit';
      }
    }
    if (!reason && written.length && now - sess.lastSaveAt >= DEBOUNCE_MS) reason = 'file write';
    const offer = offerContext(dir, input, sess);
    if (offer) sessDirty = true;
    if (sessDirty) state.writeSession(dir, sid, sess);
    if (taskDirty) state.writeTask(dir, task);
    if (reason) doSave(dir, sid, reason, lines);
    return { lines, out: offer ? context('PostToolUse', offer) : null };
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
    state.writeSession(dir, sid, sess);
    const lines = [['STOP', '']];
    // The reply ends with a question for the user: filed only when there is work it can hold up ("Hello! What shall
    // we do?" is not waiting on anyone).
    const q = waiting.lastQuestion(input.last_assistant_message);
    if (q && handoff.hasWork(dir, sid) && waiting.add(dir, [{ question: q, session: sid, source: 'reply' }])) lines.push(['WAIT', '1 asked']);
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
    if (handoff.save(dir, sid, sess.lastSaveReason || 'session end', { refreshGit: false })) lines.push(['SAVE', 'session end']);
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

// ---------- usage bands (design 7.2) ----------
// Checked on the events that can show output; PreCompact cannot, PreToolUse stays lean.
const USAGE_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'Stop']);
const MSG95 = 'Usage at 95 %. Handoff saved. Next session, JSPARK Forge shows where you were.';
const ctx95 = dir => 'JSPARK Forge: usage is at 95 %. The handoff is saved. Please finish the current small step, update your ' +
  `notes in ${paths.display(dir, path.join(paths.forgeDir(dir), 'state', 'notes.md'))}, and do not start new work.`;

function withUsage(dir, sid, lines, out) {
  const band = usageLib.crossed(dir, sid);
  if (!band) return out;
  const before = lines.length;
  doSave(dir, sid, `usage ${band} %`, lines);
  if (lines.length === before) return out; // no work to save: "Handoff saved" would not be true, so say nothing
  const msg = band === 95 ? MSG95 : null;
  const ctx = band === 95 ? ctx95(dir) : (notesOn(dir) ? handoff.notesLine(dir) : null);
  if (!msg && !ctx) return out;
  const o = out || {};
  if (msg) o.systemMessage = o.systemMessage ? `${o.systemMessage}\n${msg}` : msg;
  if (ctx && event !== 'Stop') { // Stop carries no additionalContext
    o.hookSpecificOutput = o.hookSpecificOutput || { hookEventName: event };
    const had = o.hookSpecificOutput.additionalContext;
    o.hookSpecificOutput.additionalContext = had ? `${had}\n\n${ctx}` : ctx;
  }
  return Object.keys(o).length ? o : null;
}

const SETUP_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);

// ---------- hook entry ----------
function main(raw) {
  let input = null;
  let dir = projectDirOf(null);
  try {
    input = JSON.parse(raw);
    dir = projectDirOf(input);
    // Automatic setup (owner 2026-11-19): the first session or prompt in a git project switches JSPARK Forge on.
    // A repo that is someone else's keeps its files in a guest folder (design-v0.1.1 section 2).
    let setupResult = null;
    setup.startBudget(setup.SETUP_BUDGET_MS); // setup and the guest check share one git time budget
    if (!isInitialised(dir)) {
      if (!SETUP_EVENTS.has(event)) return;
      setupResult = setup.ensureProject(dir);
      if (setupResult !== 'created' && setupResult !== 'guest') return;
    }
    const guest = paths.isGuest(dir);
    if (guest && event === 'SessionStart' && setupResult !== 'guest') setup.touchGuest(dir);
    const handler = handlers[event];
    if (!handler) return;
    const res = handler(dir, input) || { lines: [], out: null };
    let { lines, out } = Array.isArray(res) ? { lines: [res], out: null } : res;
    // A decision was just recorded: say so in the conversation, every time (design-v0.2 1.4: never unseen).
    if (event === 'PostToolUse' && /\bdecide\b/.test(String((input.tool_input || {}).command || ''))) {
      const ev = require('./lib/decide').takeEvent(dir);
      if (ev) { out = out || {}; out.systemMessage = [out.systemMessage, ev].filter(Boolean).join('\n'); }
    }
    if (USAGE_EVENTS.has(event)) out = withUsage(dir, input.session_id, lines, out);
    if (guest && (event === 'SessionStart' || event === 'UserPromptSubmit')) { // the repo's text is data, not instructions
      out = out || {};
      out.hookSpecificOutput = out.hookSpecificOutput || { hookEventName: event };
      const had = out.hookSpecificOutput.additionalContext;
      out.hookSpecificOutput.additionalContext = had ? `${had}\n\n${setup.GUEST_DATA_LINE}` : setup.GUEST_DATA_LINE;
    }
    const notices = (setupResult === 'created' ? [setup.ON_MESSAGE] : [])
      .concat(setupResult === 'guest' ? [setup.guestMessage(dir)] : [])
      .concat(event === 'SessionStart' ? setup.machineMessages() : []);
    if (notices.length) {
      out = out || {};
      out.systemMessage = [out.systemMessage, ...notices].filter(Boolean).join('\n');
    }
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
function cliProject() {
  return process.env.CLAUDE_PROJECT_DIR && isInitialised(process.env.CLAUDE_PROJECT_DIR)
    ? process.env.CLAUDE_PROJECT_DIR : findProject(process.cwd());
}
const NOT_SET_UP = 'JSPARK Forge is not set up in this project yet (it switches on by itself in a git project).\n';

// `forge.js show`: print the handoff (the resume skill reads it this way: in guest mode the file is not in the repo).
function cliShow() {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  const f = path.join(paths.forgeDir(dir), 'handoff.md');
  process.stdout.write(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'No handoff saved yet in this project.\n');
}

// `forge.js where`: the absolute paths of the notes file and the handoff (the handoff skill writes the notes there).
function cliWhere() {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  const f = paths.forgeDir(dir);
  process.stdout.write(JSON.stringify({ notes: path.join(f, 'state', 'notes.md'), handoff: path.join(f, 'handoff.md') }, null, 2) + '\n');
}

function cliSave(args) {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  const sid = process.env.CLAUDE_CODE_SESSION_ID || 'manual';
  const lines = [];
  doSave(dir, sid, 'manual', lines, { force: true }); // the user asked: always write
  if (args.includes('--done')) {
    handoff.archive(dir);
    lines.push(['SAVE', 'task closed, handoff archived']);
  }
  for (const [kind, detail] of lines) log.append(dir, { time: new Date(), session: sid, kind, detail });
  process.stdout.write(args.includes('--done')
    ? `Task closed. The handoff is archived in ${paths.display(dir, path.join(paths.forgeDir(dir), 'archive'))}/; the next session starts fresh.\n`
    : 'Handoff saved. Next session, JSPARK Forge shows where you were.\n');
}

// `forge.js waiting [--clear <id>|all]`: the /jspark-forge:waiting skill lists the open questions and clears answered ones.
function cliWaiting(args) {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  const i = args.indexOf('--clear');
  if (i >= 0) {
    const ids = new Set(args.slice(i + 1).filter(a => !a.startsWith('--')));
    const n = waiting.remove(dir, x => ids.has('all') || ids.has(x.id));
    if (n) log.append(dir, { time: new Date(), session: process.env.CLAUDE_CODE_SESSION_ID || 'manual', kind: 'WAIT', detail: `${n} cleared` });
    process.stdout.write(`Removed ${n} from the list; ${waiting.read(dir).length} still waiting.\n`);
    return;
  }
  const items = waiting.read(dir);
  if (!items.length) { process.stdout.write('Nothing is waiting on you.\n'); return; }
  const now = Date.now();
  process.stdout.write(`${items.length} waiting on you (oldest first):\n${items.map((x, n) =>
    `${n + 1}. [${x.id}] ${waiting.line(x)}${x.about ? ` (about: ${x.about})` : ''}${x.options.length ? `; options: ${x.options.join(' / ')}` : ''}; asked ${waiting.ago(now - x.askedAt)} ago`).join('\n')}\n`);
}

// `forge.js doctor` / `forge.js status` (spec 5.13c): read-only health check; what is saved now.
const cliDoctor = () => process.stdout.write(require('./lib/doctor').doctor(cliProject(), setup.claudeHome()));
const cliStatus = () => process.stdout.write(require('./lib/doctor').status(cliProject()));

// `forge.js decide --from <file.json> | --verify <id> | --retire <id> [--by <id>]` (design-v0.2 1.4).
function cliDecide(args) {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  process.stdout.write(require('./lib/decide').run(dir, args, process.env.CLAUDE_CODE_SESSION_ID || 'manual'));
}

// `forge.js decisions [--all] [--kb-request "<line>"]` and `forge.js check` (design-v0.2 1.7).
const cliMemory = fn => args => {
  const dir = cliProject();
  if (!dir) { process.stdout.write(NOT_SET_UP); return; }
  process.stdout.write(require('./lib/decide')[fn](dir, args || []));
};

// `forge.js lint [paths...]` (design-v0.2 section 3): check skills and briefs; default is the project's own.
const cliLint = args => process.stdout.write(require('./lib/lint').run(cliProject() || process.cwd(), args));

const CLI = { lint: cliLint, save: cliSave, show: cliShow, where: cliWhere, waiting: cliWaiting, doctor: cliDoctor, status: cliStatus, decide: cliDecide,
  decisions: cliMemory('list'), check: cliMemory('check') };
if (CLI[event]) {
  try { CLI[event](process.argv.slice(3)); } catch (e) { process.stdout.write(`JSPARK Forge could not ${event}: ${e.message}\n`); }
} else {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  // No process.exit(): on Windows a pipe write is asynchronous, so exiting early could cut the reply short.
  process.stdin.on('end', () => { process.exitCode = 0; main(raw); });
  process.stdin.on('error', () => { process.exitCode = 0; });
}
