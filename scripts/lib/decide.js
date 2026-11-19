'use strict';
// `forge.js decide` (design-v0.2 sections 1.1, 1.4, 1.5): the only writer of .jspark-forge/decisions.md.
// The entry comes from a JSON file (--from), never from the command line, so quotes, $( ) and the user's own block
// rules cannot mangle or block it. Validates, keeps every other byte, never reuses an id (local high-water mark),
// refuses duplicate ids, and leaves a "recorded" note that the next PostToolUse shows in the conversation.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const state = require('./state');
const D = require('./decisions');
const { safeSee, readState, writeState, hashOf, isGlob, clean } = require('./memory');
const { spawnSync } = require('child_process');

const LONG_WORDS = 80;
const fileOf = dir => path.join(paths.repoForgeDir(dir), 'decisions.md');
const today = D.today; // the local calendar date (review, low)
const ID = /^D-\d{1,9}$/;
const one = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function badPath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  return !s || s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.split('/').includes('..');
}

function opts(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') o.from = args[++i];
    else if (args[i] === '--verify') o.verify = args[++i];
    else if (args[i] === '--retire') o.retire = args[++i];
    else if (args[i] === '--by') o.by = args[++i];
  }
  return o;
}

// The .jspark-forge/.gitignore keeps everything local except what it lists; decisions.md is shared (owner Q-D2).
function shareFile(dir) {
  const g = path.join(paths.repoForgeDir(dir), '.gitignore');
  try {
    const t = fs.readFileSync(g, 'utf8');
    const eol = /\r\n/.test(t) ? '\r\n' : '\n'; // in the file's own line ending (review, low)
    if (!/^!decisions\.md\s*$/m.test(t)) fs.writeFileSync(g, `${t.replace(/\s*$/, eol)}!decisions.md${eol}`);
  } catch { /* no .gitignore: nothing hides the file */ }
}

// -> the text to print. sid: the conversation (pending offers it settles are dropped).
function run(dir, args, sid) {
  if (!paths.isOwn(dir)) return 'Decision memory is off in a repo you are reviewing: JSPARK Forge writes nothing into it.\n';
  const o = opts(args);
  let j = {};
  if (o.from) {
    // Never echo the file: --from could be pointed at a secret (review, low).
    try { j = JSON.parse(fs.readFileSync(path.resolve(o.from), 'utf8')); } catch { return `JSPARK Forge could not read ${path.basename(String(o.from))} as a JSON entry; nothing was changed.\n`; }
    if (!j || typeof j !== 'object') return 'JSPARK Forge: the entry file holds no JSON object; nothing was changed.\n';
  }
  const verify = o.verify || j.verify;
  const retire = o.retire || j.retire;
  const update = j.update;
  const f = fileOf(dir);
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch { /* first entry */ }
  const st = readState(dir);
  const done = msg => {
    st.lastEvent = { text: msg, shown: false, at: Date.now() };
    writeState(dir, st);
    const sess = state.readSession(dir, sid);
    const settled = new Set([].concat(j.skip || [], (String(j.source || '').match(/\b[0-9a-f]{7,40}\b/g) || [])));
    if (settled.size && Array.isArray(sess.offers)) {
      sess.offers = sess.offers.filter(x => ![...settled].some(s => String(x.sha).startsWith(s) || s.startsWith(String(x.sha))));
      state.writeSession(dir, sid, sess);
    }
    return `${msg}\n`;
  };

  const target = verify || retire || update;
  if (target) {
    const by0 = o.by || j.by;
    if (!ID.test(String(target)) || (by0 && !ID.test(String(by0)))) return 'Not changed: an id must look like D-012.\n';
    const counts = D.idCounts(text);
    if (!counts[target]) return `There is no ${target} in decisions.md.\n`;
    if (counts[target] > 1) return `There are two entries with the id ${target} (probably from two branches); rename one in decisions.md, then try again.\n`;
    if (verify) { fs.writeFileSync(f, D.setField(text, verify, 'Last verified', today())); return done(`${verify} still valid: Last verified set to ${today()}.`); }
    if (retire) {
      const by = o.by || j.by;
      fs.writeFileSync(f, D.setField(text, retire, 'Status', by ? `superseded by ${by}` : 'retired'));
      return done(`Retired ${retire}${by ? ` (superseded by ${by})` : ''}.`);
    }
    const title = one(j.title, 200);
    if (!title) return 'Nothing to update: give the new title.\n';
    let t = D.setTitle(text, update, title);
    t = D.setField(t, update, 'Last verified', today());
    fs.writeFileSync(f, t);
    const upd = D.parse(t).entries.find(e => e.id === update);
    if (upd) st.known = Object.assign({}, st.known, { [update]: hashOf(upd) });
    return done(`Updated ${update}: ${title}.`);
  }

  // Add.
  if (j.skip && !j.title) return done(`Not recorded (skipped ${[].concat(j.skip).join(', ')}).`);
  const title = one(j.title, 200);
  if (!title) return 'Not recorded: a decision needs a one-line title.\n';
  const kind = String(j.kind || 'decision').toLowerCase();
  if (!D.KINDS.has(kind)) return `Not recorded: unknown kind "${j.kind}" (decision, rule, lesson or reference).\n`;
  const touches = (Array.isArray(j.touches) ? j.touches : String(j.touches || '').split(',')).map(s => String(s).trim()).filter(Boolean);
  const bad = touches.find(badPath);
  if (bad) return `Not recorded: "${bad}" must be a path inside the project (relative, no "..").\n`;
  let see = '';
  if (kind === 'reference') {
    see = safeSee(dir, j.see);
    if (!see) return 'Not recorded: a reference needs "see": a file inside the project that is not a secret file.\n';
  }
  const hwm = Number(st.hwm) || 0;
  const id = `D-${String(Math.max(Number(D.nextId(text).slice(2)), hwm + 1)).padStart(3, '0')}`;
  // A long why is accepted (warned once below); the just-in-time line shows only its first 160 characters.
  const entry = { id, title, kind, why: one(j.why, 2000), see, source: one(j.source, 120), touches,
    by: j.drafted ? 'you (drafted by Claude)' : 'you' };
  const out = D.addEntry(text, entry);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out.text);
  shareFile(dir);
  st.hwm = Number(id.slice(2));
  const added = D.parse(out.text).entries.find(e => e.id === id);
  if (added) st.known = Object.assign({}, st.known, { [id]: hashOf(added) }); // recorded here: not "arrived with git"
  let msg = `Recorded ${id}: ${title}${touches.length ? ` (touches ${touches.join(', ')})` : ' (no Touches: it is never shown just in time)'}.`;
  if (D.words(entry) > LONG_WORDS && !st.longWarned) {
    st.longWarned = true;
    msg += ` Long entries go stale and cost tokens on every matching edit; for detail, consider a reference entry pointing to a doc.`;
  }
  return done(msg);
}

// For PostToolUse: the "recorded" note, once. -> text or null.
function takeEvent(dir) {
  const st = readState(dir);
  if (!st.lastEvent || st.lastEvent.shown) return null;
  st.lastEvent.shown = true;
  writeState(dir, st);
  return `JSPARK Forge ${st.lastEvent.text.replace(/^Recorded/, 'recorded')}`;
}

// ---------- `forge.js decisions [--all] [--kb-request "<line>"]` (design-v0.2 1.7) ----------
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function list(dir, args) {
  if (!paths.isOwn(dir)) return 'Decision memory is off in a repo you are reviewing.\n';
  const st = readState(dir);
  const k = args.indexOf('--kb-request');
  if (k >= 0) {
    st.declined = (st.declined || []).concat([{ text: one(args[k + 1], 200), at: Date.now() }]);
    writeState(dir, st);
    return `Noted (${st.declined.length} so far): decisions stay one line each, with the files they touch. JSPARK Forge counts ` +
      'these requests on this machine only, to see whether a separate knowledge feature is wanted.\n';
  }
  let text = '';
  try { text = fs.readFileSync(fileOf(dir), 'utf8'); } catch { return 'No decisions recorded yet. Add one with /jspark-forge:decide.\n'; }
  const all = D.parse(text).entries;
  const active = all.filter(e => e.active);
  const show = args.includes('--all') ? all : active;
  const line = e => `${e.id} ${clean(e.title, 100)} (${[e.active ? null : clean(e.status, 40),
    e.kind === 'reference' && e.see ? `reference: ${clean(e.see, 120)}` : null,
    e.touches.length ? `touches ${clean(e.touches.join(', '), 160)}` : e.active ? 'no Touches' : null].filter(Boolean).join('; ')})`;
  const refs = active.filter(e => e.kind === 'reference').length;
  const long = active.filter(e => D.words(e) > LONG_WORDS).length;
  const kb = (st.declined || []).length;
  const L = [`${plural(active.length, 'active decision', 'active decisions')}:`, ...show.map(line), '',
    `${plural(refs, 'reference', 'references')}, ${plural(long, 'long entry', 'long entries')}, ` +
    `${plural(kb, 'knowledge-base request', 'knowledge-base requests')} declined.`];
  if (all.length > 200) L.push('Over 200 entries: consider moving retired ones to an archive file to keep the file quick to read.');
  L.push('A rule that must never be broken can also become a hard block: add it under "## Never" in .jspark-forge/rules.md.');
  return `${L.join('\n')}\n`;
}

// ---------- `forge.js check`: is my memory still true? (design-v0.2 1.7), read-only ----------
function gitOut(dir, args) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: dir, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? String(r.stdout) : null;
}
// Every commit since the oldest Last verified date, with its local date and files (paths relative to the project), in
// one git call for all entries (review: one call per entry took 7.9 s for 150 entries).
function commitsSince(dir, entries) {
  const dates = entries.map(e => e.lastVerified || e.date).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  if (!dates.length) return [];
  const log = gitOut(dir, ['log', '--relative', `--since=${dates[0]} 00:00:00`, '--name-only', '--format=%x01%cs']) || '';
  return log.split(String.fromCharCode(1)).slice(1).map(block => {
    const [date, ...rest] = block.split(/\r?\n/);
    return { date: date.trim(), files: rest.map(x => x.trim()).filter(Boolean) };
  });
}
function check(dir) {
  if (!paths.isOwn(dir)) return 'Decision memory is off in a repo you are reviewing.\n';
  let text = '';
  try { text = fs.readFileSync(fileOf(dir), 'utf8'); } catch { return 'No decisions recorded yet.\n'; }
  const { entries, errors } = D.parse(text);
  const out = errors.map(e => `decisions.md line ${e.line}: ${e.message} (this entry is skipped until it is fixed)`);
  for (const [id, n] of Object.entries(D.idCounts(text))) if (n > 1) out.push(`${id}: ${n === 2 ? 'two' : n} entries share this id (two branches merged?); rename one`);
  const files = (gitOut(dir, ['ls-files', '-co', '--exclude-standard']) || '').split(/\r?\n/).filter(Boolean);
  const now = Date.now();
  const active = entries.filter(x => x.active);
  const history = commitsSince(dir, active);
  for (const e of active) {
    const name = `${e.id} "${clean(e.title, 60)}"`;
    for (const t of e.touches) {
      if (isGlob(t)) { if (files.length && !files.some(f => D.matches(t, f))) out.push(`${name}: ${clean(t, 80)} matches no file`); }
      else if (!fs.existsSync(path.join(dir, t.replace(/\/+$/, '')))) out.push(`${name}: ${clean(t, 80)} does not exist (renamed or deleted?)`);
    }
    if (e.kind === 'reference' && e.see && !safeSee(dir, e.see)) out.push(`${name}: its reference is not a plain file inside the project, so it is never shown`);
    else if (e.kind === 'reference' && e.see && !fs.existsSync(path.join(dir, e.see))) out.push(`${name}: its reference ${clean(e.see, 80)} does not exist`);
    const since = e.lastVerified || e.date;
    if (e.touches.length && /^\d{4}-\d\d-\d\d$/.test(since)) {
      // A verification date has no time: count commits made after that day (local dates on both sides).
      const n = history.filter(c => c.date > since && c.files.some(fl => e.touches.some(t => D.matches(t, fl)))).length;
      if (n) out.push(`${name}: its files changed in ${plural(n, 'commit', 'commits')} since ${since} (last verified)`);
    }
    if (!e.touches.length && e.kind !== 'reference' && now - (Date.parse(since) || now) > 30 * 86400000) {
      out.push(`${name}: no Touches, so it is never shown before an edit; last verified ${clean(since, 20)}`);
    }
  }
  if (!out.length) return `All ${plural(entries.filter(x => x.active).length, 'decision looks', 'decisions look')} fine.\n`;
  return `${out.map(l => `- ${l}`).join('\n')}\n\nFor each: still valid? / update / retire. Nothing changes until you answer.\n`;
}

module.exports = { run, takeEvent, list, check };
