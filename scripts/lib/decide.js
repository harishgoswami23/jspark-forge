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
const { safeSee } = require('./memory');
const { writeAtomic } = require('./fsx');

const LONG_WORDS = 80;
const fileOf = dir => path.join(paths.repoForgeDir(dir), 'decisions.md');
const stateFile = dir => path.join(paths.forgeDir(dir), 'state', 'decisions.json');
function readState(dir) { try { return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) || {}; } catch { return {}; } }
const writeState = (dir, s) => writeAtomic(stateFile(dir), `${JSON.stringify(s, null, 1)}\n`);
const today = () => new Date().toISOString().slice(0, 10);
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
    if (!/^!decisions\.md\s*$/m.test(t)) fs.writeFileSync(g, `${t.replace(/\s*$/, '\n')}!decisions.md\n`);
  } catch { /* no .gitignore: nothing hides the file */ }
}

// -> the text to print. sid: the conversation (pending offers it settles are dropped).
function run(dir, args, sid) {
  if (!paths.isOwn(dir)) return 'Decision memory is off in a repo you are reviewing: JSPARK Forge writes nothing into it.\n';
  const o = opts(args);
  let j = {};
  if (o.from) {
    try { j = JSON.parse(fs.readFileSync(path.resolve(o.from), 'utf8')); } catch (e) { return `JSPARK Forge could not read ${o.from}: ${e.message}\n`; }
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
  st.known = Object.assign({}, st.known, { [id]: true });
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

module.exports = { run, takeEvent, readState, writeState };
