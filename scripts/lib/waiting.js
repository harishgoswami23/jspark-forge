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

function render(items) {
  if (!items.length) return '# Waiting on you\n\nNothing is waiting on you.\n';
  const L = ['# Waiting on you', '', `${items.length} question${items.length === 1 ? '' : 's'} that hold up work. ` +
    'Answer them in Claude Code, or run /jspark-forge:waiting.', ''];
  items.forEach((x, i) => {
    L.push(`${i + 1}. [${x.id}] ${x.question}${x.recommendation ? ` (recommended: ${x.recommendation})` : ''}`);
    if (x.about) L.push(`   About: ${x.about}`);
    if (x.options && x.options.length) L.push(`   Options: ${x.options.join(' / ')}`);
    L.push(`   Asked: ${new Date(x.askedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  });
  return `${L.join('\n')}\n`;
}

function write(dir, items) {
  const now = Date.now();
  const kept = items.filter(x => now - (x.askedAt || 0) <= MAX_AGE_MS).slice(-MAX_ITEMS);
  writeAtomic(fileOf(dir), `${JSON.stringify({ items: kept }, null, 2)}\n`);
  try { writeAtomic(path.join(paths.forgeDir(dir), 'waiting.md'), render(kept)); } catch { /* the list is what counts */ }
  return kept;
}

// Adds questions not already waiting (same question text in the same session). -> how many were added.
function add(dir, questions) {
  const items = read(dir);
  let next = items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
  let added = 0;
  for (const q of questions) {
    const question = short(q.question);
    if (!question || items.some(x => x.question === question && x.session === q.session)) continue;
    items.push({ id: `w${++next}`, question, about: short(q.about, 60), options: (q.options || []).map(o => short(o, 80)),
      recommendation: short(q.recommendation, 80), askedAt: q.askedAt || Date.now(), session: q.session || '', source: q.source || 'reply' });
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
const line = x => `${x.question}${x.recommendation ? ` (recommended: ${x.recommendation})` : ''}`;
// One-line summary for the handoff; null when nothing waits.
function summary(dir) {
  const items = read(dir);
  if (!items.length) return null;
  return items.length === 1 ? `Claude asked: "${items[0].question}"` : `${items.length} questions; oldest: "${items[0].question}"`;
}

module.exports = { read, add, remove, fromTool, lastQuestion, render, summary, line, ago, MAX_ITEMS };
