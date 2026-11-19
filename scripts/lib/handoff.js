'use strict';
// The one-page handoff (design 5): sources (5.1), layout and 600-word cap (5.2), lifecycle (5.4),
// and the resume context shown at SessionStart (design 8).
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');
const { parsePlan } = require('./plan');
const superpowers = require('./superpowers');
const { gitInfo, headBranch, headCommit } = require('./git');
const log = require('./log');
const state = require('./state');
const paths = require('./paths');


const CAP_WORDS = 600;
const OLD_MS = 14 * 24 * 3600 * 1000;
const ARCHIVE_DAYS = 30;
const FIELD_MAX = 200;

const pad2 = n => String(n).padStart(2, '0');
const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const words = s => s.split(/\s+/).filter(Boolean).length;
const cut = (s, n = FIELD_MAX) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const forgeDir = dir => paths.forgeDir(dir);
const handoffFile = dir => path.join(forgeDir(dir), 'handoff.md');
const notesFile = dir => path.join(forgeDir(dir), 'state', 'notes.md');

// ---------- sources ----------
function parseNotes(text) {
  const out = { task: null, step: null, next: null, text: '' };
  const rest = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(task|step|next)\s*:\s*(.+?)\s*$/i);
    if (m && out[m[1].toLowerCase()] === null) out[m[1].toLowerCase()] = m[2];
    else rest.push(line);
  }
  out.text = rest.join('\n').trim();
  return out;
}

const doneText = n => (n <= 0 ? null : n === 1 ? 'step 1' : `steps 1–${n}`);

// Deviation 7: todo list, then a checkbox plan file, then Claude's notes, then the last request.
function taskFields({ todos, plan, notes, lastRequest }) {
  let step = null, next = null, done = null;
  if (Array.isArray(todos) && todos.length) {
    const m = todos.length;
    let i = todos.findIndex(t => t.status === 'in_progress');
    if (i < 0) i = todos.findIndex(t => t.status !== 'completed');
    const all = i < 0;
    step = { n: all ? m : i + 1, m, text: cut(todos[all ? m - 1 : i].content, 120) };
    next = all ? null : step.text;
    done = doneText(todos.filter(t => t.status === 'completed').length);
  } else if (plan) {
    step = { n: plan.stepIndex, m: plan.total, text: plan.next };
    next = plan.next;
    done = doneText(plan.done);
  } else if (notes && notes.step) {
    const s = notes.step.match(/^(\d+)\s*of\s*(\d+)\s*(?::\s*(.*))?$/i);
    step = s ? { n: Number(s[1]), m: Number(s[2]), text: s[3] || null } : null;
  }
  if (!next && notes && notes.next) next = notes.next;
  const task = (plan && plan.title) || (notes && notes.task) || lastRequest || null;
  return { task, step, next, done };
}

// ---------- render ----------
function render(m, opts = {}) {
  const level = opts.level || 0; // 0 full; 1 no recent; 2 + files to 5; 3 + notes to 60 words; 4 + no others
  const L = [];
  const g = m.git;
  let head = `As of ${ymd(m.asOf)} ${hhmm(m.asOf)} · saved because: ${m.reason}`;
  if (g && g.branch) {
    head += ` · branch ${g.branch}${g.head ? ` @ ${g.head}` : ''}`;
    head += g.dirty ? ` · ${g.dirty} ${g.dirty === 1 ? 'file' : 'files'} not committed` : ' · nothing uncommitted';
  }
  if (m.ended) head += ` · session ended ${hhmm(new Date(m.ended.at))} (${m.ended.reason})`;
  L.push('# Where we were');
  if (m.review) L.push(`Review of ${m.review.origin || 'a repo that is not yours'}${m.review.head ? ` @ ${m.review.head}` : ''}`);
  for (const s of m.sources || []) L.push(`Source: ${s.path}${s.head ? ` @ ${s.head}` : ''} (read-only)`);
  L.push(head, '');
  const step = m.step ? `${m.step.n} of ${m.step.m}${m.step.text ? `: ${cut(m.step.text)}` : ''}` : 'not recorded';
  L.push(`**Task:** ${m.task ? cut(m.task) : 'not recorded'}`);
  L.push(`**Step:** ${step}`);
  L.push(`**Done:** ${m.done ? cut(m.done) : 'not recorded'}`);
  L.push(`**Next action:** ${m.next ? cut(m.next) : 'not recorded'}`);
  L.push(`**Still running at cutoff:** ${m.running && m.running.length ? cut(m.running.join(' · '), 400) : 'nothing'}`);
  L.push(`**Waiting on you:** ${m.waiting ? cut(m.waiting) : 'nothing'}`);
  L.push(`**Your last request:** ${m.lastRequest ? `"${cut(m.lastRequest)}"` : 'not recorded'}`);
  if (m.notes && m.notes.text) {
    let t = m.notes.text.replace(/\s+/g, ' ').trim();
    if (level >= 3 && words(t) > 60) t = `${t.split(' ').slice(0, 60).join(' ')}…`;
    L.push('', `**Claude's notes (${hhmm(m.notes.time)}):** ${t}`);
  }
  L.push('');
  if (level < 1 && m.recent && m.recent.length) L.push(`**Recent actions:** ${m.recent.join(' · ')}`);
  if (m.files && m.files.length) {
    const shown = level >= 2 && m.files.length > 5 ? `${m.files.slice(0, 5).join(', ')} (+${m.files.length - 5} more)` : m.files.join(', ');
    L.push(`**Files touched in this task:** ${shown}`);
  }
  if (level < 4 && m.others && m.others.length) {
    const o = m.others.slice(0, 2).map(s => `session ${s.id} (${hhmm(s.at)}): ${s.lastRequest ? `"${cut(s.lastRequest, 80)}"` : 'no request recorded'}` +
      (s.running && s.running.length ? ` · running ${s.running.join(', ')}` : ''));
    L.push(`**Also active:** ${o.join('; ')}`);
  }
  L.push(`**More detail:** ${m.logFile} · older handoffs: ${m.archiveDir || '.jspark-forge/archive/'}`);
  const text = L.join('\n') + '\n';
  if (words(text) > CAP_WORDS && level < 4) return render(m, { level: level + 1 });
  return text;
}

// ---------- building the model from state ----------
function recentActions(dir, sid, now) {
  const file = path.join(forgeDir(dir), 'log', `${log.dayStamp(now)}.log`);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; }
  const s8 = String(sid || '').slice(0, 8);
  const out = [];
  for (const raw of lines) {
    const m = raw.match(log.LINE_RE);
    if (!m || !m[2].startsWith(s8)) continue;
    const [, time, , kind, detail] = m;
    const own = `${paths.display(dir, forgeDir(dir))}/`;
    if ((kind === 'EDIT' || kind === 'WRITE') && (detail.startsWith('.jspark-forge/') || detail.startsWith(own))) continue; // Forge's own files
    const t = time.slice(0, 5);
    const short = s => cut(s, 60);
    const say = { EDIT: `edited ${detail}`, WRITE: `wrote ${detail}`, BASH: `ran ${short(detail.split(' :: ')[0])}`,
      PS: `ran ${short(detail.split(' :: ')[0])}`, COMMIT: `commit ${short(detail)}`, BLOCK: `blocked ${detail.split(' :: ')[0]}`,
      'AGENT+': `started helper ${detail}`, MCP: `used ${detail}`, FAIL: `failed ${short(detail)}` }[kind];
    if (say) out.push(`${t} ${say}`);
  }
  return out.slice(-8);
}

function runningOf(sess) {
  const r = [];
  for (const b of sess.background || []) r.push(`\`${cut(b.command || b.description || 'a background command', 80)}\` (started ${hhmm(new Date(b.at))}, may have stopped)`);
  for (const h of Object.values(sess.helpers || {})) r.push(`helper ${h.type || 'agent'} (started ${hhmm(new Date(h.at))}, may have stopped)`);
  return r;
}

function readNotes(dir) {
  try {
    const st = fs.statSync(notesFile(dir));
    return Object.assign(parseNotes(fs.readFileSync(notesFile(dir), 'utf8')), { time: st.mtime });
  } catch { return null; }
}

// Writes the handoff and returns its model, or returns null without writing when there is no work to resume
// (only talk so far, or a task just closed with done). force: the user asked (/jspark-forge:handoff).
function save(dir, sid, reason, { refreshGit = true, now = new Date(), force = false } = {}) {
  const sess = state.readSession(dir, sid);
  const task = state.readTask(dir);
  const notes = readNotes(dir);
  let plan = null;
  const planFile = task.planFile || superpowers.newestLedgerPlan(dir, task.closedAt || 0);
  const hasWork = force || task.files.length > 0 || !!task.lastCommit || (Array.isArray(task.todos) && task.todos.length > 0) ||
    !!planFile || !!(notes && (notes.text || notes.task)) || runningOf(sess).length > 0;
  if (!hasWork) return null;
  if (refreshGit) sess.git = gitInfo(dir);
  if (planFile) {
    try { plan = parsePlan(fs.readFileSync(path.join(dir, planFile), 'utf8')); } catch {}
    const lp = plan && superpowers.ledgerProgress(dir, planFile, plan); // superpowers tracks tasks, not boxes
    if (lp) plan = Object.assign({}, plan, lp);
  }
  const f = taskFields({ todos: task.todos, plan, notes, lastRequest: sess.lastPrompt });
  let done = f.done;
  if (task.lastCommit) {
    const c = `last commit ${task.lastCommit.sha} "${cut(task.lastCommit.subject, 60)}"`;
    done = done ? `${done} (${c})` : c;
  }
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const others = state.allSessions(dir)
    .filter(s => s.session !== sid && !s.ended && s.lastSaveAt > dayAgo)
    .sort((a, b) => b.lastSaveAt - a.lastSaveAt)
    .map(s => ({ id: String(s.session).slice(0, 8), at: new Date(s.lastSaveAt), lastRequest: s.lastPrompt, running: runningOf(s).map(x => x.split(' (')[0]) }));
  const meta = paths.isGuest(dir) ? paths.guestMeta(dir) : null;
  const model = {
    review: meta ? { origin: meta.origin, head: sess.git && sess.git.head } : null,
    // read-only sources (v0.1.1): the path as written in rules.md and its commit (no git process); "last read" is not
    // recorded: it would need a hook on every Read (design-v0.1.1 section 3)
    sources: require('./rules').loadRules(dir).readonly.map(r => ({ path: r.path, head: headCommit(path.resolve(dir, r.path)) })),
    asOf: now, reason, git: sess.git, task: f.task, step: f.step, done, next: f.next,
    running: runningOf(sess), waiting: sess.waiting, lastRequest: sess.lastPrompt,
    notes: notes && notes.text ? { time: notes.time, text: notes.text } : null,
    recent: recentActions(dir, sid, now), files: task.files, ended: sess.ended,
    logFile: paths.display(dir, path.join(forgeDir(dir), 'log', `${log.dayStamp(now)}.log`)), others,
    archiveDir: `${paths.display(dir, path.join(forgeDir(dir), 'archive'))}/`,
  };
  writeAtomic(handoffFile(dir), render(model));
  state.writeMeta(dir, { status: 'open', savedAt: now.getTime(), session: sid, branch: sess.git && sess.git.branch,
    head: sess.git && sess.git.head, task: f.task, step: f.step, next: f.next });
  sess.lastSaveAt = now.getTime();
  sess.lastSaveReason = reason;
  state.writeSession(dir, sid, sess);
  return model;
}

// ---------- resume (design 8) ----------
const notesLine = dir => `JSPARK Forge: update your notes now in ${paths.display(dir, notesFile(dir))} (max 120 words: what you are doing, ` +
  "anything agreed with the user, what is next). Start with the lines 'Task:', 'Step: n of m: ...' and 'Next:' when you know them.";
const WAIT_LINE = "JSPARK Forge: Before doing anything else, in your first reply show this in plain words (≤ 8 lines, ending with 'Continue?') " +
  'and wait for the user\'s answer. Do not change files or run commands for the old task until they reply. If their first message is ' +
  'a new task, say in one line what was in progress (parked) and then do the new task.';
const CARRY_LINE = 'JSPARK Forge: the conversation was just compacted; above is where the work stands. carry on; no need to ask.';

function grounding() {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'rules', 'grounding.md'), 'utf8').trim(); }
  catch { return 'JSPARK Forge grounding rule: cite path:line; say "not found" otherwise; never describe code you have not read.'; }
}

function openHandoff(dir) {
  const meta = state.readMeta(dir);
  if (!meta || meta.status !== 'open' || !fs.existsSync(handoffFile(dir))) return null;
  return { meta, text: fs.readFileSync(handoffFile(dir), 'utf8').trim() };
}

function summary(meta) {
  let s = meta.task ? `JSPARK Forge: last time you were on "${cut(meta.task, 80)}"` : 'JSPARK Forge: there is unfinished work from last time';
  if (meta.step) s += `, step ${meta.step.n} of ${meta.step.m}`;
  s += '.';
  if (meta.next) s += ` Next: ${cut(meta.next, 80)}.`;
  return `${s} Say 'continue' or tell me what to do instead.`;
}

// -> { systemMessage: string|null, context: string }
function resumeContext(dir, sid, source, now = new Date()) {
  const parts = [grounding()];
  const msgs = [];
  const h = openHandoff(dir);
  if (source === 'compact') {
    if (h) parts.push(h.text, CARRY_LINE);
    const sess = state.readSession(dir, sid);
    if (sess.notesDue) { parts.push(notesLine(dir)); sess.notesDue = false; state.writeSession(dir, sid, sess); }
  } else if (h) {
    if (now.getTime() - h.meta.savedAt < OLD_MS) {
      const current = headBranch(dir);
      const branchNote = current && h.meta.branch && current !== h.meta.branch
        ? `Note: you are on branch ${current}; the handoff was on ${h.meta.branch}.` : null;
      msgs.push(summary(h.meta) + (branchNote ? ` ${branchNote}` : ''));
      parts.push(h.text, WAIT_LINE);
      if (branchNote) parts.push(`JSPARK Forge: ${branchNote}`);
    } else {
      const d = new Date(h.meta.savedAt);
      msgs.push(`JSPARK Forge: an old handoff from ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} exists (${paths.display(dir, handoffFile(dir))}).`);
    }
  }
  return { systemMessage: msgs.length ? msgs.join('\n') : null, context: parts.join('\n\n') };
}

// ---------- lifecycle (5.4) ----------
function archive(dir, now = new Date()) {
  const src = handoffFile(dir);
  if (fs.existsSync(src)) {
    const stamp = `${ymd(now).replace(/-/g, '')}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const dst = path.join(forgeDir(dir), 'archive', `handoff-${stamp}.md`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }
  state.deleteMeta(dir);
  state.resetTask(dir);
  const t = state.readTask(dir);
  t.closedAt = now.getTime(); // older superpowers ledgers must not revive the closed plan
  state.writeTask(dir, t);
  try { fs.unlinkSync(notesFile(dir)); } catch {}
}

function pruneArchive(dir, now = new Date()) {
  const a = path.join(forgeDir(dir), 'archive');
  let names = [];
  try { names = fs.readdirSync(a); } catch { return; }
  const cutoff = now.getTime() - ARCHIVE_DAYS * 24 * 3600 * 1000;
  for (const n of names) {
    try { if (fs.statSync(path.join(a, n)).mtimeMs < cutoff) fs.unlinkSync(path.join(a, n)); } catch {}
  }
}

module.exports = { render, taskFields, parseNotes, save, resumeContext, archive, pruneArchive, notesLine, grounding };
