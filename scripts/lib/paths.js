'use strict';
// The one place that decides where JSPARK Forge keeps a project's files (guest mode, design-v0.1.1 section 2).
// - Yours: <project>/.jspark-forge/. Proven only by state/ or log/ in it: both are git-ignored, so never cloned
//   (a committed .jspark-forge/rules.md alone proves nothing).
// - Guest (someone else's repo): <claude home>/jspark-forge/guests/<id>/, nothing inside the repo.
//   <id> = first 12 hex of sha1 of the normalised real path of the project folder. No git call here: this runs on
//   every hook, PreToolUse included. The status-line wrapper repeats this computation (it runs from its own copy).
// Every module asks forgeDir() instead of building the path itself (enforced by tests/paths.test.js).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = '.jspark-forge';
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function normPath(p) {
  let r;
  try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); }
  r = r.replace(/\\/g, '/');
  if (r.length > 1 && !/^[a-zA-Z]:\/$/.test(r)) r = r.replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
// The repo's top folder (where .git is), walking up from the project folder; no git process. None -> the project.
// A session opened in a subfolder of a guest repo is the same guest, under the same hold (Fable code review, low).
function repoRoot(project) {
  for (let d = path.resolve(project); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return path.resolve(project);
  }
}
const guestId = project => crypto.createHash('sha1').update(normPath(repoRoot(project))).digest('hex').slice(0, 12);
const guestsRoot = () => path.join(claudeHome(), 'jspark-forge', 'guests');
const guestDir = project => path.join(guestsRoot(), guestId(project));

const repoForgeDir = project => path.join(project, NAME);
const hasRepoState = project => isDir(path.join(repoForgeDir(project), 'state')) || isDir(path.join(repoForgeDir(project), 'log'));

// The git folder of the repo the project is in (walks up; follows a worktree's ".git" file). None -> null.
function gitDirOf(project) {
  try {
    for (let d = path.resolve(project); ; d = path.dirname(d)) {
      const g = path.join(d, '.git');
      if (fs.existsSync(g)) {
        if (!fs.statSync(g).isFile()) return g;
        const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
        return m ? path.resolve(d, m[1]) : null;
      }
      if (path.dirname(d) === d) return null;
    }
  } catch { return null; }
}
// Proof that a repo is yours (Fable code review H1, 2026-11-19): a marker inside .git, which no clone carries.
// A committed .jspark-forge/state/ proves nothing. Outside git (no .git anywhere up) a state/ folder is enough:
// nothing was cloned.
const ownMarker = project => { const g = gitDirOf(project); return g ? path.join(g, 'jspark-forge-own') : null; };
function isOwn(project) {
  if (!hasRepoState(project)) return false;
  const m = ownMarker(project);
  return !m || fs.existsSync(m);
}
function markOwn(project) {
  const m = ownMarker(project);
  if (m) fs.writeFileSync(m, `${JSON.stringify({ path: normPath(project), at: Date.now() })}\n`);
}
function unmarkOwn(project) { const m = ownMarker(project); if (m) { try { fs.unlinkSync(m); } catch { /* none */ } } }
const isGuest = project => !isOwn(project) && isDir(guestDir(project));
const forgeDir = project => (isGuest(project) ? guestDir(project) : repoForgeDir(project));
const isActive = project => isOwn(project) || isGuest(project);

function guestMeta(project) {
  try { return JSON.parse(fs.readFileSync(path.join(guestDir(project), 'meta.json'), 'utf8')); } catch { return null; }
}

// A path as shown to Claude or the user: project-relative with forward slashes when inside the project, else absolute.
function display(project, p) {
  const r = path.relative(project, p);
  const shown = r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
  return shown.replace(/\\/g, '/');
}

module.exports = { NAME, claudeHome, normPath, guestId, guestsRoot, guestDir, guestMeta, repoForgeDir, hasRepoState, gitDirOf,
  ownMarker, markOwn, unmarkOwn, isOwn, isGuest, repoRoot,
  forgeDir, isActive, display };
