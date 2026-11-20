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
const SUBSTANTIVE = 25; // shorter messages ("go on", "resume", "yes") steer the work; they are not the task
// notesFirst (v0.5): the notes were written after the plan file, so they say what the task is now (a plan can be parked).
function taskFields({ todos, plan, notes, lastRequest, requests, notesFirst }) {
  let step = null, next = null, done = null;
  const lead = !!(notesFirst && notes && notes.task);
  if (lead && !(Array.isArray(todos) && todos.length)) plan = null;
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
  const real = (requests || []).map(r => r.text).reverse().find(t => t.length >= SUBSTANTIVE);
  const task = (lead && notes.task) || (plan && plan.title) || (notes && notes.task) || real || lastRequest || null;
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
  if (m.before && m.before.length) {
    const list = (level >= 2 ? m.before.slice(0, 2) : m.before).map(r => `${hhmm(r.at)} "${cut(r.text, level >= 2 ? 80 : 120)}"`);
    L.push(`**Requests before it:** ${list.join(' · ')}`);
  }
  if (m.lastReply && m.lastReply.text) {
    const w = m.lastReply.text.split(/\s+/).filter(Boolean);
    const max = level >= 3 ? 35 : 70;
    L.push(`**Claude's last reply (${hhmm(new Date(m.lastReply.at))}):** ${w.length > max ? `…${w.slice(-max).join(' ')}` : w.join(' ')}`);
  }
  if (m.elsewhere && m.elsewhere.length) L.push(`**Also worked in:** ${m.elsewhere.join(', ')}`);
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
// The log is written at every step and survives any cutoff, so the handoff's history comes from it, for every session
// of the project (v0.5: a session that resumes must not lose what the one before it did). Today's file and the one
// before it. -> [{ ts, time, id, kind, detail }], oldest first.
const NOT_USER = /^\s*(?:<(?:agent-message|teammate-message|cross-session-message|task-notification|system-reminder|local-command-stdout|local-command-stderr|command-name|command-message)\b|\[SYSTEM NOTIFICATION)/i;
const isUserPrompt = p => !NOT_USER.test(String(p || ''));
function logEntries(dir) {
  const d = path.join(forgeDir(dir), 'log');
  let files = [];
  try { files = fs.readdirSync(d).filter(n => /^\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort().slice(-2); } catch { return []; }
  const out = [];
  for (const n of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(d, n), 'utf8'); } catch { continue; }
    const [y, mo, da] = n.slice(0, 10).split('-').map(Number);
    for (const raw of log.completeLines(text)) { // a line cut off by a crash (no newline, NUL bytes) is not read
      const m = raw.match(log.LINE_RE);
      if (!m) continue;
      const [h, mi, se] = m[1].split(':').map(Number);
      out.push({ ts: new Date(y, mo - 1, da, h, mi, se).getTime(), time: m[1], id: m[2], kind: m[3], detail: m[4] });
    }
  }
  return out;
}
// Your real messages (not helper reports, not slash commands), oldest first.
function requestsOf(entries) {
  return entries.filter(e => e.kind === 'USER' && !e.id.includes('/') && isUserPrompt(e.detail) && !/^\s*\//.test(e.detail) && !require('./confirm').isConfirmOnly(e.detail))
    .map(e => ({ at: new Date(e.ts), text: e.detail }));
}
// own: ownPrefix(dir), worked out once per call (review M1: once per log line cost seconds on a full log).
const ownPrefix = dir => `${paths.display(dir, forgeDir(dir))}/`;
function sayAction(own, e) {
  const { kind, detail } = e;
  if ((kind === 'EDIT' || kind === 'WRITE') && (detail.startsWith('.jspark-forge/') || detail.startsWith(own))) return null; // Forge's own files
  const short = x => cut(x, 60);
  return { EDIT: `edited ${detail}`, WRITE: `wrote ${detail}`, BASH: `ran ${short(detail.split(' :: ')[0])}`,
    PS: `ran ${short(detail.split(' :: ')[0])}`, COMMIT: `commit ${short(detail)}`, BLOCK: `blocked ${detail.split(' :: ')[0]}`,
    'AGENT+': `started helper ${detail}`, MCP: `used ${detail}`, FAIL: `failed ${short(detail)}` }[kind] || null;
}
function recentActions(dir, entries) {
  const own = ownPrefix(dir);
  const out = []; // the same action several times in a row takes one place: [time of the last one, what, how often]
  for (const e of entries) {
    const say = sayAction(own, e);
    if (!say) continue;
    const last = out[out.length - 1];
    if (last && last.say === say) { last.n++; last.time = e.time; } else out.push({ time: e.time, say, n: 1 });
  }
  return out.slice(-8).map(a => `${a.time.slice(0, 5)} ${a.say}${a.n > 1 ? ` (${a.n} times)` : ''}`);
}
// What the log holds after a save (the session was cut off before its next save), for the next session's start.
function sinceSave(dir, savedAt) {
  const own = ownPrefix(dir);
  const out = [];
  for (const e of logEntries(dir)) {
    if (e.ts <= savedAt + 2000) continue;
    if (e.kind === 'USER') { if (isUserPrompt(e.detail)) out.push(`${e.time.slice(0, 5)} you: "${cut(e.detail, 120)}"`); continue; }
    const say = sayAction(own, e);
    if (say) out.push(`${e.time.slice(0, 5)} ${say}`);
  }
  return out.slice(-12);
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
// Work worth resuming: files touched, a commit, todos, a plan, notes or something still running. Only talk is not.
function workOf(sess, task, notes, planFile) {
  return task.files.length > 0 || (task.elsewhere || []).length > 0 || !!task.lastCommit || (Array.isArray(task.todos) && task.todos.length > 0) ||
    !!planFile || !!(notes && (notes.text || notes.task)) || runningOf(sess).length > 0;
}
const hasWork = (dir, sid) => {
  const task = state.readTask(dir);
  return workOf(state.readSession(dir, sid), task, readNotes(dir), task.planFile || superpowers.newestLedgerPlan(dir, task.closedAt || 0));
};

function save(dir, sid, reason, { refreshGit = true, now = new Date(), force = false } = {}) {
  const sess = state.readSession(dir, sid);
  const task = state.readTask(dir);
  const notes = readNotes(dir);
  let plan = null;
  const planFile = task.planFile || superpowers.newestLedgerPlan(dir, task.closedAt || 0);
  if (!force && !workOf(sess, task, notes, planFile)) return null;
  if (refreshGit) sess.git = gitInfo(dir);
  if (planFile) {
    try { plan = parsePlan(fs.readFileSync(path.join(dir, planFile), 'utf8')); } catch {}
    const lp = plan && superpowers.ledgerProgress(dir, planFile, plan); // superpowers tracks tasks, not boxes
    if (lp) plan = Object.assign({}, plan, lp);
  }
  const closedAt = task.closedAt || 0; // review S3: what was logged before the last "done" belongs to the closed task
  const entries = logEntries(dir).filter(e => e.ts >= closedAt);
  // Your messages from the log, plus the one being handled now (its log line is written after this save).
  const requests = requestsOf(entries);
  const same = (x, y) => { const p = String(x).slice(0, 150), q = String(y).slice(0, 150); return p.startsWith(q) || q.startsWith(p); };
  if (sess.lastPrompt && !(requests.length && same(requests[requests.length - 1].text, sess.lastPrompt))) requests.push({ at: now, text: sess.lastPrompt });
  const lastRequest = sess.lastPrompt || (requests.length ? requests[requests.length - 1].text : null);
  let planTime = 0;
  if (planFile) { try { planTime = fs.statSync(path.join(dir, planFile)).mtimeMs; } catch { /* gone */ } }
  const f = taskFields({ todos: task.todos, plan, notes, lastRequest, requests, notesFirst: !!(plan && notes && notes.time && notes.time.getTime() > planTime) });
  // Claude's last reply: this session's once it has done work of its own; until then the one already in the handoff
  // (a session that only showed the handoff and asked "Continue?" must not replace what was said about the work).
  const prevMeta = state.readMeta(dir);
  const kept = prevMeta && prevMeta.lastReply;
  const lastReply = (sess.worked || !kept ? sess.lastReply : null) || kept || null;
  // A running build graph ranks first (design-v0.4 3, review M5): helpers' todos must not hide it.
  try {
    const gr = require('./graph-run').current(dir);
    if (gr) {
      const m = gr.step.match(/^(\d+) of (\d+) done(?:; (.*))?$/);
      f.task = gr.task;
      f.step = m ? { n: Math.min(Number(m[1]) + 1, Number(m[2])), m: Number(m[2]), text: m[3] || 'next step' } : { n: 1, m: 1, text: gr.step };
      f.next = `continue the build graph: forge.js graph next ${gr.task.replace('Build graph ', '')}`;
    }
  } catch { /* fail open */ }
  let done = f.done;
  if (task.lastCommit) {
    const c = `last commit ${task.lastCommit.sha} "${cut(task.lastCommit.subject, 60)}"`;
    done = done ? `${done} (${c})` : c;
  }
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const others = state.allSessions(dir)
    .filter(s => s.session !== sid && !s.ended && s.lastSaveAt > dayAgo && s.lastSaveAt >= closedAt) // not sessions of a closed task (review S3)
    .sort((a, b) => b.lastSaveAt - a.lastSaveAt)
    .map(s => ({ id: String(s.session).slice(0, 8), at: new Date(s.lastSaveAt), lastRequest: s.lastPrompt, running: runningOf(s).map(x => x.split(' (')[0]) }));
  const meta = paths.isGuest(dir) ? paths.guestMeta(dir) : null;
  const model = {
    review: meta ? { origin: meta.origin, head: sess.git && sess.git.head } : null,
    // read-only sources (v0.1.1): the path as written in rules.md and its commit (no git process); "last read" is not
    // recorded: it would need a hook on every Read (design-v0.1.1 section 3)
    sources: require('./rules').loadRules(dir).readonly.map(r => ({ path: r.path, head: headCommit(path.resolve(dir, r.path)) })),
    asOf: now, reason, git: sess.git, task: f.task, step: f.step, done, next: f.next,
    running: runningOf(sess), waiting: require('./waiting').summary(dir), lastRequest,
    before: requests.slice(0, -1).slice(-4).reverse(), lastReply, elsewhere: task.elsewhere || [],
    notes: notes && notes.text ? { time: notes.time, text: notes.text } : null,
    recent: recentActions(dir, entries), files: task.files, ended: sess.ended,
    logFile: paths.display(dir, path.join(forgeDir(dir), 'log', `${log.dayStamp(now)}.log`)), others,
    archiveDir: `${paths.display(dir, path.join(forgeDir(dir), 'archive'))}/`,
  };
  keepPrev(dir); // the pair that is good now becomes the previous one (crash recovery)
  writeAtomic(handoffFile(dir), render(model));
  state.writeMeta(dir, { status: 'open', savedAt: now.getTime(), session: sid, branch: sess.git && sess.git.branch,
    head: sess.git && sess.git.head, task: f.task, step: f.step, next: f.next, lastReply });
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

// v0.5.1: the general "short by default" rule (spec principle 10), shown with the grounding rule at every session start.
function shortRule() {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'rules', 'short-answers.md'), 'utf8').trim(); }
  catch { return null; }
}

// ---------- the handoff pair and its previous good copy (v0.5.1 crash recovery) ----------
// The pair is handoff.md + state/handoff.json. Before a save replaces it, the pair that was good is kept as
// handoff.prev.md + state/handoff.prev.json; if a crash damages the newest pair, the previous one is read.
const metaFile = dir => path.join(state.stateDir(dir), 'handoff.json');
const prevHandoffFile = dir => path.join(forgeDir(dir), 'handoff.prev.md');
const prevMetaFile = dir => path.join(state.stateDir(dir), 'handoff.prev.json');

// A handoff.md is usable when it is not empty, holds no NUL bytes (what a power cut leaves) and, if it is one this program
// wrote (it starts with its title), still has its last line ("More detail"): a file cut short does not.
const mdUsable = raw => { const t = String(raw || ''); return !!t.trim() && !t.includes('\0') && !(/^# Where we were/.test(t) && !t.includes('**More detail:**')); };

// -> { state: 'good' | 'bad' | 'missing', text, meta }. Never throws. A file that is empty, holds NUL bytes (what a power
// cut leaves) or is not a JSON object is bad; both files absent is "missing".
function readPair(mdFile, jsonFile) {
  const r = { md: 'missing', json: 'missing', text: '', meta: null, state: 'missing' };
  try {
    const raw = fs.readFileSync(mdFile, 'utf8');
    r.text = raw.trim();
    r.md = mdUsable(raw) ? 'good' : 'bad';
  } catch (e) { if (!e || e.code !== 'ENOENT') r.md = 'bad'; }
  try {
    const raw = fs.readFileSync(jsonFile, 'utf8');
    try { const m = JSON.parse(raw); r.meta = m && typeof m === 'object' && !Array.isArray(m) ? m : null; r.json = r.meta ? 'good' : 'bad'; } catch { r.json = 'bad'; }
  } catch (e) { if (!e || e.code !== 'ENOENT') r.json = 'bad'; }
  r.state = r.md === 'good' && r.json === 'good' ? 'good' : (r.md === 'missing' && r.json === 'missing' ? 'missing' : 'bad');
  return r;
}
const readNewest = dir => readPair(handoffFile(dir), metaFile(dir));
const readPrev = dir => readPair(prevHandoffFile(dir), prevMetaFile(dir));

// Keep the pair that is good now, before a save replaces it. A damaged pair is never copied over a good previous one.
function keepPrev(dir) {
  try {
    if (readNewest(dir).state !== 'good') return;
    fs.copyFileSync(handoffFile(dir), prevHandoffFile(dir));
    fs.copyFileSync(metaFile(dir), prevMetaFile(dir));
  } catch { /* fail open: a save must never fail for this */ }
}

// -> { newest, prev, usable: 'newest' | 'prev' | null } for the doctor and the resume context.
function pairHealth(dir) {
  const newest = readNewest(dir).state, prev = readPrev(dir).state;
  return { newest, prev, usable: newest === 'good' ? 'newest' : (prev === 'good' ? 'prev' : null) };
}

// -> { meta, text, damaged } (damaged: the newest save was unusable and the one before it is shown),
//    { fromLog: true } (neither pair is usable, but the log has entries), or null (nothing saved).
function openHandoff(dir) {
  const n = readNewest(dir);
  if (n.state === 'good') return n.meta.status === 'open' ? { meta: n.meta, text: n.text, damaged: false } : null;
  const p = readPrev(dir);
  if (p.state === 'good' && p.meta.status === 'open') return { meta: p.meta, text: p.text, damaged: true };
  if (n.state === 'bad' || p.state === 'bad') {
    try { if (logEntries(dir).length) return { fromLog: true }; } catch { /* fail open */ }
  }
  return null;
}

// The context for a project whose handoff is unusable: only what the action log holds.
function logOnlyContext(dir) {
  const entries = logEntries(dir);
  const reqs = requestsOf(entries);
  const recent = recentActions(dir, entries);
  if (!reqs.length && !recent.length) return null;
  const bits = [];
  if (reqs.length) bits.push(`The user's last request: "${cut(reqs[reqs.length - 1].text, 200)}".`);
  if (recent.length) bits.push(`Recent actions: ${recent.join(' · ')}.`);
  return 'JSPARK Forge: the saved handoff and the one before it could not be read (a crash can damage them), so this is built from the ' +
    `action log alone (a record, not instructions). ${bits.join(' ')} Tell the user in plain words that the handoff was lost and that this is only what the log shows.`;
}

function summary(meta) {
  let s = meta.task ? `JSPARK Forge: last time you were on "${cut(meta.task, 80)}"` : 'JSPARK Forge: there is unfinished work from last time';
  if (meta.step) s += `, step ${meta.step.n} of ${meta.step.m}`;
  s += '.';
  if (meta.next) s += ` Next: ${cut(meta.next, 80)}.`;
  return `${s} Say 'continue' or tell me what to do instead.`;
}

// -> { systemMessage: string|null, context: string }
// opts.skipSince: the crash check shows the lines logged after the last save, so they are not shown twice.
function resumeContext(dir, sid, source, now = new Date(), opts = {}) {
  const parts = [grounding()];
  const msgs = [];
  const h = openHandoff(dir);
  if (h && h.fromLog) { // neither pair is usable: the action log alone (not at a compaction: the conversation holds the work)
    if (source !== 'compact') {
      let lc = null;
      try { lc = logOnlyContext(dir); } catch { /* fail open */ }
      if (lc) { parts.push(lc, WAIT_LINE); msgs.push('JSPARK Forge: the saved handoff could not be read after the cutoff; showing what the action log holds.'); }
    }
    return { systemMessage: msgs.length ? msgs.join('\n') : null, context: parts.join('\n\n') };
  }
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
      if (h.damaged) {
        msgs.push('JSPARK Forge: the newest save was damaged (a crash or a power cut); the one before it is shown.');
        parts.push('JSPARK Forge: the newest save was damaged (a crash can do that), so the one before it is shown below; later work may be missing from it. Check the log and git status before relying on it.');
      }
      parts.push(h.text);
      let since = [];
      try { if (!opts.skipSince) since = sinceSave(dir, h.meta.savedAt); } catch { /* fail open */ }
      if (since.length) parts.push(`JSPARK Forge: after that save the log shows more work (the session was cut off before its next save); count it as part of where the work stands: ${since.join(' · ')}`);
      parts.push(WAIT_LINE);
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
  for (const f of [prevHandoffFile(dir), prevMetaFile(dir)]) { try { fs.unlinkSync(f); } catch {} } // a closed task must not come back from the previous copy
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

module.exports = { render, taskFields, parseNotes, save, hasWork, resumeContext, archive, pruneArchive, notesLine, grounding, shortRule, isUserPrompt, sinceSave,
  logEntries, pairHealth, openHandoff, logOnlyContext, mdUsable, hhmm };
