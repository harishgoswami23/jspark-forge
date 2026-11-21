#!/usr/bin/env node
'use strict';
// /jspark-forge:init, the part that needs no questions (design 3.1, 7.4, 11; spec 5.9).
// Creates <project>/.jspark-forge/ with its own .gitignore and a starter rules.md (never edits the root .gitignore),
// checks Node, reports the status line, warns about a project-level status line, suggests superpowers once.
// Options: --project <dir> (default $CLAUDE_PROJECT_DIR or cwd), --claude-home <dir> (default ~/.claude)
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PROJECT = path.resolve(opt('--project', process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const CLAUDE_HOME = opt('--claude-home', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')); // like paths.js
const FORGE = require('./lib/paths').repoForgeDir(PROJECT);
const GITIGNORE = require('./lib/setup').GITIGNORE; // one default (launch.md is shared: design-v0.3 2.1)
const out = [];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Node
const major = Number(process.versions.node.split('.')[0]);
out.push(major >= 18 ? `Node.js ${process.versions.node}: ok`
  : `Node.js ${process.versions.node}: too old. JSPARK Forge needs 18 or newer; until then its hooks stay off.`);

// ---------- --mine / --guest (guest mode, design-v0.1.1 section 2) ----------
// Only JSPARK Forge's own local files move; tracked files (rules.md, .gitignore) and everything of the user's stay.
const paths = require('./lib/paths');
const setup = require('./lib/setup');
const OWN_FILES = ['state', 'log', 'archive', 'usage', 'handoff.md'];
// Copy everything first, then delete (Fable code review M8): an error part-way leaves every file in at least one
// place, and running the same command again finishes the move.
function moveOwnFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const present = OWN_FILES.filter(n => fs.existsSync(path.join(from, n)));
  for (const n of present) fs.cpSync(path.join(from, n), path.join(to, n), { recursive: true, force: true });
  for (const n of present) fs.rmSync(path.join(from, n), { recursive: true, force: true });
}
const finish = () => { process.stdout.write(out.join('\n') + '\n'); process.exit(0); };
const isDirSync = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function guarded(what, fn) {
  try { fn(); } catch (e) {
    out.push(`JSPARK Forge could not finish ${what}: ${e.message}. Nothing was lost; run the same command again to finish.`);
    finish();
  }
}

// The whole repo is yours or a guest, so --mine and --guest act on its top folder, also from a subfolder session.
const ROOT = paths.repoRoot(PROJECT);
const ROOT_FORGE = paths.repoForgeDir(ROOT);
if (args.includes('--mine')) {
  guarded('moving its files into the repo', () => {
    // Also when the repo is already marked yours: a half-done earlier move left files in the guest folder.
    if (isDirSync(paths.guestDir(ROOT))) {
      moveOwnFiles(paths.guestDir(ROOT), ROOT_FORGE);
      fs.rmSync(paths.guestDir(ROOT), { recursive: true, force: true });
    }
  });
  fs.mkdirSync(path.join(ROOT_FORGE, 'state'), { recursive: true });
  paths.markOwn(ROOT); // yours: the marker inside .git
  if (!fs.existsSync(path.join(ROOT_FORGE, '.gitignore'))) fs.writeFileSync(path.join(ROOT_FORGE, '.gitignore'), GITIGNORE);
  if (!fs.existsSync(path.join(ROOT_FORGE, 'rules.md'))) fs.copyFileSync(path.join(__dirname, '..', 'templates', 'rules.md'), path.join(ROOT_FORGE, 'rules.md'));
  out.push('This repo is now yours: JSPARK Forge keeps its files in .jspark-forge/ (commit rules.md and .gitignore; the ' +
    'rest stays local). The guest quarantine is off.');
  finish();
}

if (args.includes('--guest')) {
  guarded('moving its files out of the repo', () => {
    // Only JSPARK Forge's own local files (proven by the .git marker): a cloned repo's committed state/ stays put.
    if (paths.isOwn(ROOT)) moveOwnFiles(ROOT_FORGE, paths.guestDir(ROOT));
  });
  paths.unmarkOwn(ROOT);
  setup.writeGuest(ROOT, { quarantine: true });
  out.push('JSPARK Forge now treats this repo as one you are reviewing: nothing is written into it (its files are in ' +
    `${paths.guestDir(ROOT).replace(/\\/g, '/')}), and its common install, build, test and run commands are held ` +
    'until you type CONFIRM guest-quarantine (then allowed for the rest of that session). Undo: /jspark-forge:init --mine');
  finish();
}

if (paths.isGuest(PROJECT)) {
  out.push('This repo is treated as one you are reviewing, so JSPARK Forge writes nothing into it. If it is yours: ' +
    '/jspark-forge:init --mine. To hold its install, build and run commands: /jspark-forge:init --guest.');
  finish();
}

// Project folder
if (fs.existsSync(FORGE)) out.push('JSPARK Forge is already set up in this project (.jspark-forge/).');
else {
  fs.mkdirSync(FORGE, { recursive: true });
  out.push('Created .jspark-forge/ (git-ignored except rules.md).');
  out.push('Commit .jspark-forge/rules.md and .jspark-forge/.gitignore with your project; everything else in it stays local.');
}
// Running init here is an explicit "this project is mine": state/ is the never-cloned proof of that (guest mode).
fs.mkdirSync(path.join(FORGE, 'state'), { recursive: true });
if (!args.includes('--guest')) paths.markOwn(PROJECT); // yours: the marker inside .git
if (!fs.existsSync(path.join(FORGE, '.gitignore'))) fs.writeFileSync(path.join(FORGE, '.gitignore'), GITIGNORE);
if (!fs.existsSync(path.join(FORGE, 'rules.md'))) {
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'rules.md'), path.join(FORGE, 'rules.md'));
  out.push('Added .jspark-forge/rules.md: add your own Confirm / Never rules there.');
}

// Status line
const userSl = (readJson(path.join(CLAUDE_HOME, 'settings.json')) || {}).statusLine;
out.push(userSl && /jspark-forge[\\/]+statusline\.js/.test(userSl.command || '')
  ? 'Status line: wrapped by JSPARK Forge'
  : `Status line: ${userSl && userSl.command ? 'yours, not wrapped yet' : 'none set, not wrapped yet'}`);
for (const f of ['settings.json', 'settings.local.json']) {
  const s = readJson(path.join(PROJECT, '.claude', f));
  if (s && s.statusLine) {
    out.push(`Note: this project sets its own status line in .claude/${f}, which wins over yours, so plan-limit saves will not work here.`);
    break;
  }
}

// superpowers, suggested once (spec 5.9)
function superpowersInstalled() {
  const plugins = path.join(CLAUDE_HOME, 'plugins');
  try { if (fs.readFileSync(path.join(plugins, 'installed_plugins.json'), 'utf8').includes('superpowers')) return true; } catch {}
  try { return fs.readdirSync(path.join(plugins, 'cache')).some(m => fs.existsSync(path.join(plugins, 'cache', m, 'superpowers'))); } catch {}
  return false;
}
const machineState = path.join(CLAUDE_HOME, 'jspark-forge', 'state.json');
const ms = readJson(machineState) || {};
if (!superpowersInstalled() && !ms.superpowersSuggested) {
  out.push(require('./lib/setup').SUPERPOWERS_TIP); // one text for both places (superpowers is required since 2026-11-20)
  ms.superpowersSuggested = true;
  fs.mkdirSync(path.dirname(machineState), { recursive: true });
  fs.writeFileSync(machineState, JSON.stringify(ms, null, 2) + '\n');
}

process.stdout.write(out.join('\n') + '\n');
