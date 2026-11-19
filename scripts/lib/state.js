'use strict';
// Small JSON state files under .jspark-forge/state/ (design 3.1).
//   task.json            task-level facts shared across sessions: files touched, plan file, todos, last commit
//   session-<id>.json    one session: last request, helpers, background shells, waiting, git, last save, end
//   handoff.json         what SessionStart needs without parsing handoff.md: savedAt, task, step, next, branch
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');

const stateDir = dir => path.join(dir, '.jspark-forge', 'state');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');

const TASK_DEFAULT = () => ({ files: [], planFile: null, todos: null, lastCommit: null });
const SESSION_DEFAULT = id => ({ session: id, lastSaveAt: 0, lastSaveReason: null, lastPrompt: null, helpers: {},
  background: [], waiting: null, git: null, ended: null, notesDue: false });

const taskFile = dir => path.join(stateDir(dir), 'task.json');
const sessionFile = (dir, id) => path.join(stateDir(dir), `session-${String(id || 'unknown').replace(/[^A-Za-z0-9-]/g, '')}.json`);
const metaFile = dir => path.join(stateDir(dir), 'handoff.json');

module.exports = {
  stateDir,
  readTask: dir => Object.assign(TASK_DEFAULT(), readJson(taskFile(dir), {})),
  writeTask: (dir, t) => writeJson(taskFile(dir), t),
  resetTask: dir => writeJson(taskFile(dir), TASK_DEFAULT()),
  readSession: (dir, id) => Object.assign(SESSION_DEFAULT(id), readJson(sessionFile(dir, id), {})),
  writeSession: (dir, id, s) => writeJson(sessionFile(dir, id), s),
  allSessions(dir) {
    let names = [];
    try { names = fs.readdirSync(stateDir(dir)).filter(f => /^session-.+\.json$/.test(f)); } catch { return []; }
    return names.map(f => readJson(path.join(stateDir(dir), f), null)).filter(Boolean);
  },
  readMeta: dir => readJson(metaFile(dir), null),
  writeMeta: (dir, m) => writeJson(metaFile(dir), m),
  deleteMeta: dir => { try { fs.unlinkSync(metaFile(dir)); } catch {} },
};
