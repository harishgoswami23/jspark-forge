'use strict';
// Fixtures for the crash-recovery tests: a temp git project, hooks run as `node scripts/forge.js <Event>`, and a
// session that "died" at a chosen moment (its state, log lines and in-flight file written by hand, no real crash).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', '..', 'scripts', 'forge.js');
const A = 'aaaaaaaa-0000-0000-0000-000000000000'; // the session that gets cut off
const B = 'bbbbbbbb-0000-0000-0000-000000000000'; // the session that starts next

function repo(prefix = 'forge-crashfx-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  require('../../scripts/lib/paths').markOwn(dir);
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', 'a.txt'); g('commit', '-qm', 'init');
  return dir;
}
function run(dir, event, input = {}, sid = B) {
  const stdin = JSON.stringify(Object.assign({ session_id: sid, cwd: dir, hook_event_name: event }, input));
  return spawnSync(process.execPath, [FORGE, event], { input: stdin, encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) });
}
const show = (dir, ...args) => spawnSync(process.execPath, [FORGE, 'show', ...args], { cwd: dir, encoding: 'utf8',
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: B }) }).stdout;
const out = r => (r.stdout ? JSON.parse(r.stdout) : null);
const ctxOf = r => { const o = out(r); return o && o.hookSpecificOutput ? o.hookSpecificOutput.additionalContext || '' : ''; };
const msgOf = r => { const o = out(r); return (o && o.systemMessage) || ''; };
const start = (dir, source = 'startup', extra = {}) => run(dir, 'SessionStart', Object.assign({ source }, extra), B);

const forge = dir => require('../../scripts/lib/paths').forgeDir(dir); // the project's own folder, or the guest folder
const stateFile = (dir, name) => path.join(forge(dir), 'state', name);
const readSessionFile = (dir, sid = A) => JSON.parse(fs.readFileSync(stateFile(dir, `session-${sid}.json`), 'utf8'));
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const logPath = dir => path.join(forge(dir), 'log', `${stamp(new Date())}.log`);
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

// One log line as the product writes it, `secsAgo` seconds before now.
const logLine = (secsAgo, kind, detail, sid = A) => `${clock(new Date(Date.now() - secsAgo * 1000))} ${`[${sid.slice(0, 8)}]`.padEnd(19)} ${kind.padEnd(5)} ${detail}\n`;

// Write a session that died: opts = { sid, lastSaveAgo (s), lastPrompt, log: [[secsAgo, kind, detail]], inflight: [{tool, what, agoSecs, agent}],
// inflightAgo (s: the file's mtime), background: [{id, command, agoSecs}], helpers: {id: {type, agoSecs}}, ended, transcriptPath, extra }
function died(dir, opts = {}) {
  const sid = opts.sid || A;
  const now = Date.now();
  const sess = Object.assign({ session: sid, lastSaveAt: now - (opts.lastSaveAgo === undefined ? 600 : opts.lastSaveAgo) * 1000, lastSaveReason: 'file write',
    lastPrompt: opts.lastPrompt || 'build the invoice report with the monthly totals', helpers: {}, background: [], waiting: null, git: null,
    ended: opts.ended || null, notesDue: false, worked: true }, opts.extra || {});
  for (const b of opts.background || []) sess.background.push({ id: b.id || 'bg1', command: b.command, description: b.description || '', at: now - (b.agoSecs || 300) * 1000 });
  for (const [id, h] of Object.entries(opts.helpers || {})) sess.helpers[id] = { type: h.type, at: now - (h.agoSecs || 300) * 1000 };
  if (opts.transcriptPath) sess.transcriptPath = opts.transcriptPath;
  fs.mkdirSync(path.dirname(stateFile(dir, 'x')), { recursive: true });
  fs.writeFileSync(stateFile(dir, `session-${sid}.json`), JSON.stringify(sess, null, 2));
  if (opts.log && opts.log.length) {
    fs.mkdirSync(path.dirname(logPath(dir)), { recursive: true });
    fs.appendFileSync(logPath(dir), opts.log.map(([s, k, d]) => logLine(s, k, d, sid)).join(''));
  }
  if (opts.inflight) {
    const f = stateFile(dir, `inflight-${sid}.json`);
    fs.writeFileSync(f, JSON.stringify(opts.inflight.map(e => ({ tool: e.tool, what: e.what, at: now - (e.agoSecs || 200) * 1000, agent: e.agent || null, id: null }))));
    const t = new Date(now - (opts.inflightAgo === undefined ? 200 : opts.inflightAgo) * 1000);
    fs.utimesSync(f, t, t);
  }
  return sess;
}

module.exports = { FORGE, A, B, repo, run, show, out, ctxOf, msgOf, start, forge, stateFile, readSessionFile, logPath, logLine, hhmm, died };
