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
const CLAUDE_HOME = opt('--claude-home', path.join(os.homedir(), '.claude'));
const FORGE = require('./lib/paths').repoForgeDir(PROJECT);
const GITIGNORE = '*\n!.gitignore\n!rules.md\n';
const out = [];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Node
const major = Number(process.versions.node.split('.')[0]);
out.push(major >= 18 ? `Node.js ${process.versions.node}: ok`
  : `Node.js ${process.versions.node}: too old. JSPARK Forge needs 18 or newer; until then its hooks stay off.`);

// Project folder
if (fs.existsSync(FORGE)) out.push('JSPARK Forge is already set up in this project (.jspark-forge/).');
else {
  fs.mkdirSync(FORGE, { recursive: true });
  out.push('Created .jspark-forge/ (git-ignored except rules.md).');
  out.push('Commit .jspark-forge/rules.md and .jspark-forge/.gitignore with your project; everything else in it stays local.');
}
// Running init here is an explicit "this project is mine": state/ is the never-cloned proof of that (guest mode).
fs.mkdirSync(path.join(FORGE, 'state'), { recursive: true });
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
  out.push('Tip (shown once): JSPARK Forge works best with superpowers (https://github.com/obra/superpowers) for ' +
    'planning, tests first and reviews. Install it with: /plugin install superpowers@jspark-forge . Optional; JSPARK Forge never needs it.');
  ms.superpowersSuggested = true;
  fs.mkdirSync(path.dirname(machineState), { recursive: true });
  fs.writeFileSync(machineState, JSON.stringify(ms, null, 2) + '\n');
}

process.stdout.write(out.join('\n') + '\n');
