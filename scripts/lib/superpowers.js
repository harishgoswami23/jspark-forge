'use strict';
// Read-only view of the superpowers progress ledger (owner 2026-11-19; spec principle 7, soft coupling).
// superpowers plans have "### Task N: name" headings; executing-plans / subagent-driven-development record
// progress in <project>/.superpowers/sdd/<plan>/progress.md: first line "# SDD ledger — plan: <plan path>",
// then "Task N: complete (...)" lines. Anything missing, unreadable or in another shape -> null (skipped silently).
const fs = require('fs');
const path = require('path');

const WIN = process.platform === 'win32';
const FIRST = /^#\s*SDD ledger\s*[—–-]+\s*plan:\s*(.+?)\s*$/;
const DONE = /^\s*(?:[-*]\s*)?Task\s+(\d+):\s*complete\b/gim;
const norm = p => { const s = path.resolve(p).replace(/\\/g, '/'); return WIN ? s.toLowerCase() : s; };

function ledgers(dir) {
  const root = path.join(dir, '.superpowers', 'sdd');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const n of names) {
    const file = path.join(root, n, 'progress.md');
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.split(/\r?\n/, 1)[0].match(FIRST);
      if (m) out.push({ file, plan: path.resolve(dir, m[1]), text, mtime: fs.statSync(file).mtimeMs });
    } catch { /* skip */ }
  }
  return out;
}

function ledgerProgress(dir, planRel, plan) {
  try {
    if (!plan || !plan.tasks || !plan.tasks.length) return null;
    const want = norm(path.resolve(dir, planRel));
    const led = ledgers(dir).find(l => norm(l.plan) === want);
    if (!led) return null;
    const complete = new Set([...led.text.matchAll(DONE)].map(m => Number(m[1])));
    const done = plan.tasks.filter(t => complete.has(t.n)).length;
    const open = plan.tasks.findIndex(t => !complete.has(t.n));
    return {
      total: plan.tasks.length,
      done,
      stepIndex: open < 0 ? plan.tasks.length : open + 1,
      next: open < 0 ? null : `Task ${plan.tasks[open].n}: ${plan.tasks[open].title}`,
      title: plan.title,
    };
  } catch { return null; }
}

// The plan named by the most recently updated ledger, as a project-relative path (or null).
function newestLedgerPlan(dir) {
  try {
    const l = ledgers(dir).sort((a, b) => b.mtime - a.mtime)[0];
    if (!l || !fs.existsSync(l.plan)) return null;
    const r = path.relative(dir, l.plan);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : null;
  } catch { return null; }
}

module.exports = { ledgerProgress, newestLedgerPlan };
