'use strict';
// Git facts for the handoff, in as few spawns as possible (one `git status` per save).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const run = (dir, args) => execFileSync('git', ['-C', dir, ...args],
  { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

// -> { branch, head, dirty } or null when not a repo / git missing. Forge's own folder is not counted as dirty.
function gitInfo(dir) {
  try {
    const out = run(dir, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch']);
    let branch = null, head = null, dirty = 0;
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.oid ')) { const o = line.slice(13).trim(); head = /^[0-9a-f]+$/.test(o) ? o.slice(0, 7) : null; }
      else if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
      else if (line && !line.startsWith('#')) {
        const p = line.startsWith('?') ? line.slice(2) : line.split(' ').slice(-1)[0];
        if (!p.startsWith('.jspark-forge')) dirty++;
      }
    }
    return { branch, head, dirty };
  } catch { return null; }
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
