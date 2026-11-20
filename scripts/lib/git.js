'use strict';
// Git facts for the handoff, in as few spawns as possible (one `git status` per save).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const run = (dir, args, timeout = 3000) => execFileSync('git', ['--no-optional-locks', '-C', dir, ...args],
  { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

const DIRTY_CAP = 2000; // stop counting files here and say "2000+"

function parseStatus(out, cap) {
  let branch = null, head = null, dirty = 0, noCommits = false, capped = false;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const o = line.slice(13).trim();
      head = /^[0-9a-f]+$/.test(o) ? o.slice(0, 7) : null;
      noCommits = o === '(initial)';
    } else if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
    else if (line && !line.startsWith('#')) {
      const p = line.startsWith('?') ? line.slice(2) : line.split(' ').slice(-1)[0];
      if (!p.startsWith('.jspark-forge')) {
        dirty++;
        if (cap && dirty >= cap) { capped = true; break; }
      }
    }
  }
  return { branch, head, dirty, noCommits, capped };
}

// -> { branch, head, dirty, noCommits, capped?, approx? } or null when not a repo / git missing. Forge's own folder is
// not counted as dirty. dirty counts files (an untracked folder shows every file in it), up to 2000 (capped). One
// 3 s limit in all: the full count gets 2 s; when it does not finish, today's count (an untracked folder is one line)
// is used and marked approx. noCommits: the repo has no commit yet (no HEAD).
function gitInfo(dir, opts = {}) {
  let out, approx = false;
  try {
    out = run(dir, ['status', '--porcelain=v2', '--branch', '--untracked-files=all'], opts.fullTimeoutMs || 2000);
  } catch {
    try { out = run(dir, ['status', '--porcelain=v2', '--branch'], 1000); approx = true; } catch { return null; }
  }
  const r = parseStatus(out, approx ? 0 : DIRTY_CAP);
  const info = { branch: r.branch, head: r.head, dirty: r.dirty };
  if (r.noCommits) info.noCommits = true;
  if (r.capped) info.capped = true;
  if (approx) info.approx = true;
  return info;
}

// -> { sha, subject, files } (files: repo-relative, as git prints them; a first commit works too) or null.
// One call gives both, so decision memory's stale check adds no git process (design-v0.2 1.5).
function lastCommit(dir) {
  try {
    const [first, ...rest] = run(dir, ['-c', 'core.quotePath=false', 'log', '-1', '--name-only', '--format=%h%x09%s']).split(/\r?\n/);
    const [sha, subject] = first.trim().split('\t');
    return sha ? { sha, subject: subject || '', files: rest.map(s => s.trim()).filter(Boolean) } : null;
  } catch { return null; }
}

// The current branch from .git/HEAD without starting git (~0.1 ms instead of ~50 ms on Windows).
// Walks up to the repo root; follows a worktree's ".git" file ("gitdir: <path>"). Detached or no repo -> null.
function headBranch(start) {
  try {
    let d = path.resolve(start);
    for (;;) {
      const g = path.join(d, '.git');
      if (fs.existsSync(g)) {
        let gitDir = g;
        if (fs.statSync(g).isFile()) {
          const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
          if (!m) return null;
          gitDir = path.resolve(d, m[1]);
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const r = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return r ? r[1] : null;
      }
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
  } catch { return null; }
}

// The short HEAD commit from .git files, no git process (read-only sources in the handoff). Unknown -> null.
function headCommit(start) {
  try {
    const g = path.join(path.resolve(start), '.git');
    let gitDir = g;
    if (fs.statSync(g).isFile()) {
      const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return null;
      gitDir = path.resolve(start, m[1]);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*(.+)$/);
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head.slice(0, 7) : null;
    try { return fs.readFileSync(path.join(gitDir, ref[1]), 'utf8').trim().slice(0, 7); } catch { /* packed */ }
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split(/\r?\n/).find(l => l.endsWith(` ${ref[1]}`));
    return packed ? packed.slice(0, 7) : null;
  } catch { return null; }
}

module.exports = { gitInfo, lastCommit, headBranch, headCommit };
