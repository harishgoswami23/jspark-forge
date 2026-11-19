'use strict';
// Action log (design section 6): one line per event, one file per local day, 2 MB cap per day,
// files older than 7 days summarised mechanically into summary.md and deleted (latest 60 summaries kept).
const fs = require('fs');
const path = require('path');
const { redact } = require('./redact');
const { writeAtomic } = require('./fsx');

const CAP_BYTES = 2 * 1024 * 1024;
const KEEP_AFTER_CAP = new Set(['SAVE', 'BLOCK', 'CONFIRM', 'COMMIT']);
const ID_WIDTH = 19; // "[a1b2c3d4/9f8e7d6c]"
const LINE_RE = /^(\d\d:\d\d:\d\d) \[([^\]]*)\]\s+(\S+)\s?(.*)$/;

const pad2 = n => String(n).padStart(2, '0');
const dayStamp = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const clock = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const logDir = projectDir => path.join(projectDir, '.jspark-forge', 'log');

function idField(session, agent) {
  const s = String(session || '').slice(0, 8);
  return `[${agent ? `${s}/${String(agent).slice(0, 8)}` : s}]`;
}

function formatLine({ time, session, agent, kind, detail }, secrets = []) {
  const clean = redact(String(detail || ''), secrets).replace(/\s+/g, ' ').trim().slice(0, 300);
  return `${clock(time)} ${idField(session, agent).padEnd(ID_WIDTH)} ${String(kind).padEnd(5)} ${clean}`.trimEnd();
}

function append(projectDir, entry, opts = {}) {
  const cap = opts.capBytes || CAP_BYTES;
  const dir = logDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = dayStamp(entry.time);
  const file = path.join(dir, `${stamp}.log`);
  const marker = path.join(dir, `.capped-${stamp}`);
  const line = formatLine(entry, opts.secrets) + '\n';
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  if (size + Buffer.byteLength(line) > cap && !KEEP_AFTER_CAP.has(entry.kind)) {
    if (!fs.existsSync(marker)) {
      fs.appendFileSync(file, `${clock(entry.time)} ${idField(entry.session, entry.agent).padEnd(ID_WIDTH)} LOG CAPPED\n`);
      fs.writeFileSync(marker, '');
    }
    return;
  }
  fs.appendFileSync(file, line);
}

function summarise(stamp, text) {
  const counts = {}, files = {}, commits = [], blocks = [], sessions = new Set();
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const [, , id, kind, detail] = m;
    sessions.add(id.split('/')[0]);
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'EDIT' || kind === 'WRITE') files[detail] = (files[detail] || 0) + 1;
    if (kind === 'COMMIT') commits.push(detail);
    if (kind === 'BLOCK') blocks.push(detail);
  }
  const top = Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f, n]) => `${f} (${n})`);
  const lines = [`## ${stamp}`,
    `- Kinds: ${Object.keys(counts).sort().map(k => `${k} ${counts[k]}`).join(', ') || 'none'}`];
  if (top.length) lines.push(`- Top files: ${top.join(', ')}`);
  if (commits.length) lines.push(`- Commits: ${commits.join(' · ')}`);
  if (blocks.length) lines.push(`- Blocks: ${blocks.join(' · ')}`);
  lines.push(`- Sessions: ${sessions.size}`);
  return lines.join('\n');
}

function rotate(projectDir, now = new Date(), { keepDays = 7, keepSummaries = 60 } = {}) {
  const dir = logDir(projectDir);
  if (!fs.existsSync(dir)) return;
  const cutoff = dayStamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays));
  const old = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f) && f.slice(0, 10) < cutoff).sort();
  if (!old.length) return;
  const summaryFile = path.join(dir, 'summary.md');
  const blocks = new Map();
  if (fs.existsSync(summaryFile)) {
    for (const b of fs.readFileSync(summaryFile, 'utf8').split(/^(?=## \d{4}-\d{2}-\d{2})/m)) {
      const m = b.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (m) blocks.set(m[1], b.trim());
    }
  }
  for (const f of old) blocks.set(f.slice(0, 10), summarise(f.slice(0, 10), fs.readFileSync(path.join(dir, f), 'utf8')));
  const kept = [...blocks.keys()].sort().reverse().slice(0, keepSummaries).map(k => blocks.get(k));
  writeAtomic(summaryFile, `# JSPARK Forge log summary\n\nOne block per expired day, newest first.\n\n${kept.join('\n\n')}\n`);
  for (const f of old) {
    fs.unlinkSync(path.join(dir, f));
    try { fs.unlinkSync(path.join(dir, `.capped-${f.slice(0, 10)}`)); } catch {}
  }
}

const TEMPLATE = /\.(example|sample|template|dist)$/i;

function envSecrets(projectDir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(projectDir); } catch { return out; }
  for (const name of names) {
    if (!/^\.env(\..+)?$/.test(name) || TEMPLATE.test(name)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(projectDir, name), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (v) out.push(v);
    }
  }
  return out;
}

module.exports = { formatLine, append, rotate, envSecrets, dayStamp, LINE_RE };
