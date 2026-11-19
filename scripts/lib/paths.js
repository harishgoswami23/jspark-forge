'use strict';
// The one place that decides where JSPARK Forge keeps a project's files (guest mode, design-v0.1.1 section 2).
// G1: always <project>/.jspark-forge/. G2 adds ~/.claude/jspark-forge/guests/<id>/ for repos that are not the
// user's. Every module asks forgeDir() instead of building the path itself (enforced by tests/paths.test.js).
const fs = require('fs');
const path = require('path');

const NAME = '.jspark-forge';

const repoForgeDir = project => path.join(project, NAME);
const forgeDir = project => repoForgeDir(project);
const isActive = project => { try { return fs.statSync(forgeDir(project)).isDirectory(); } catch { return false; } };

// A path as shown to Claude or the user: project-relative with forward slashes when inside the project, else absolute.
function display(project, p) {
  const r = path.relative(project, p);
  const shown = r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
  return shown.replace(/\\/g, '/');
}

module.exports = { NAME, forgeDir, repoForgeDir, isActive, display };
