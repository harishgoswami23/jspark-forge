'use strict';
// "Waiting on you" (spec 5.2a, design-v0.1.1 section 4): questions that block work, kept until the user answers.
// Source: <forge dir>/state/waiting.json = { items: [{ id, question, about, options, recommendation, askedAt, session,
// source: 'tool' | 'reply' }] }. A readable copy is rewritten to <forge dir>/waiting.md on each change.
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');
const paths = require('./paths');

const MAX_ITEMS = 20;
const MAX_AGE_MS = 14 * 86400000;
const fileOf = dir => path.join(paths.forgeDir(dir), 'state', 'waiting.json');
const short = (s, n = 200) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function read(dir, now = Date.now()) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return (Array.isArray(j.items) ? j.items : []).filter(x => x && x.question && now - (x.askedAt || 0) <= MAX_AGE_MS);
  } catch { return []; }
}

// The open items of the launch list (spec 224-225: cost of delay, linked to the launch list). Own projects with a
// launch.md only; any failure -> none.
function launchTitles(dir) {
  try {
    const l = require('./launch').read(dir);
    return l ? l.list.items.filter(x => x.section === 'list' && !x.blank && !x.done).map(x => x.title) : [];
  } catch { return []; }
}
// The open launch item whose title the question's text or its "blocks" field names, or null.
function launchLink(x, titles) {
  const hay = `${x.question} ${x.blocks || ''}`.toLowerCase();
  return (titles || []).find(t => t.length >= 3 && hay.includes(t.toLowerCase())) || null;
}
const yesNo = v => (v === true ? 'yes' : v === false ? 'no' : '');
// What follows the question on its line: what it blocks, whether the answer can be undone, the launch item it holds up.
function extras(x, titles) {
  const out = [];
  if (x.blocks) out.push(`blocks: ${x.blocks}`);
  if (yesNo(x.reversible)) out.push(`reversible: ${yesNo(x.reversible)}`);
  const t = launchLink(x, titles);
  if (t) out.push(`blocks launch item: ${t}`);
  return out;
}

function render(items, titles = []) {
  if (!items.length) return '# Waiting on you\n\nNothing is waiting on you.\n';
  const L = ['# Waiting on you', '', `${items.length} question${items.length === 1 ? '' : 's'} that hold up work. ` +
    'Answer them in Claude Code, or run /jspark-forge:waiting.', ''];
  items.forEach((x, i) => {
    L.push(`${i + 1}. [${x.id}] ${x.question}${x.recommendation ? ` (recommended: ${x.recommendation})` : ''}`);
    if (x.about) L.push(`   About: ${x.about}`);
    if (x.options && x.options.length) L.push(`   Options: ${x.options.join(' / ')}`);
    if (x.blocks) L.push(`   Blocks: ${x.blocks}`);
    if (yesNo(x.reversible)) L.push(`   Reversible: ${yesNo(x.reversible)}`);
    const t = launchLink(x, titles);
    if (t) L.push(`   Blocks launch item: ${t}`);
    L.push(`   Asked: ${new Date(x.askedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  });
  return `${L.join('\n')}\n`;
}

function write(dir, items) {
  const now = Date.now();
  const kept = items.filter(x => now - (x.askedAt || 0) <= MAX_AGE_MS).slice(-MAX_ITEMS);
  writeAtomic(fileOf(dir), `${JSON.stringify({ items: kept }, null, 2)}\n`);
  try { writeAtomic(path.join(paths.forgeDir(dir), 'waiting.md'), render(kept, launchTitles(dir))); } catch { /* the list is what counts */ }
  return kept;
}

// Optional fields Claude can set for an open question (the question tool gives no data for them): what it blocks
// (plain words) and whether the answer can be undone. -> the item, or null when there is no such open question.
function set(dir, id, f = {}) {
  const items = read(dir);
  const x = items.find(i => i.id === id);
  if (!x) return null;
  if (f.blocks !== undefined) { const b = short(f.blocks, 160); if (b) x.blocks = b; else delete x.blocks; }
  if (f.reversible === true || f.reversible === false) x.reversible = f.reversible;
  write(dir, items);
  return x;
}

// Adds questions not already waiting (same question text in the same session). -> how many were added.
function add(dir, questions) {
  const items = read(dir);
  let next = items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
  let added = 0;
  for (const q of questions) {
    const question = short(q.question);
    if (!question || items.some(x => x.question === question && x.session === q.session)) continue;
    const item = { id: `w${++next}`, question, about: short(q.about, 60), options: (q.options || []).map(o => short(o, 80)),
      recommendation: short(q.recommendation, 80), askedAt: q.askedAt || Date.now(), session: q.session || '', source: q.source || 'reply' };
    if (short(q.blocks, 160)) item.blocks = short(q.blocks, 160);
    if (q.reversible === true || q.reversible === false) item.reversible = q.reversible;
    items.push(item);
    added++;
  }
  if (added) write(dir, items);
  return added;
}

// Removes items matching fn. -> how many were removed.
function remove(dir, fn) {
  const items = read(dir);
  const kept = items.filter(x => !fn(x));
  if (kept.length !== items.length) write(dir, kept);
  return items.length - kept.length;
}

// AskUserQuestion input -> questions to file. "(Recommended)" on an option label marks the recommendation.
const REC = /\s*\(recommended\)\s*$/i;
function fromTool(toolInput, session) {
  const qs = Array.isArray(toolInput && toolInput.questions) ? toolInput.questions : [];
  return qs.filter(q => q && q.question).map(q => {
    const opts = Array.isArray(q.options) ? q.options.map(o => String((o && o.label) || '')).filter(Boolean) : [];
    const rec = opts.find(o => REC.test(o));
    return { question: q.question, about: q.header || '', options: opts.map(o => o.replace(REC, '')),
      recommendation: rec ? rec.replace(REC, '') : '', session, source: 'tool' };
  });
}

// The last sentence of a reply, when the reply ends with a question.
function lastQuestion(msg) {
  const t = String(msg || '').trim();
  if (!t.endsWith('?')) return null;
  return short(t.split(/(?<=[.!?])\s+/).pop(), 200);
}

const ago = ms => { const h = Math.floor(ms / 3600000); return h >= 48 ? `${Math.floor(h / 24)}d` : h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60000))}m`; };
const line = (x, titles = []) => [`${x.question}${x.recommendation ? ` (recommended: ${x.recommendation})` : ''}`, ...extras(x, titles)].join(' · ');
// One-line summary for the handoff; null when nothing waits.
function summary(dir) {
  const items = read(dir);
  if (!items.length) return null;
  return items.length === 1 ? `Claude asked: "${items[0].question}"` : `${items.length} questions; oldest: "${items[0].question}"`;
}

module.exports = { read, add, set, remove, launchTitles, fromTool, lastQuestion, render, summary, line, ago, MAX_ITEMS };
