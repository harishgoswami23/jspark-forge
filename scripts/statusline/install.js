#!/usr/bin/env node
'use strict';
// JSPARK Forge status-line installer, command-line form (used by /jspark-forge:init).
//   node install.js             wrap the user's status line
//   node install.js --undo      put it back
//   node install.js --status    print the current status-line command; changes nothing
// Defaults: --settings <CLAUDE_CONFIG_DIR or ~/.claude>/settings.json, --home <same>/jspark-forge
const os = require('os');
const path = require('path');
const sl = require('../lib/statusline-install');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const p = {
  settings: opt('--settings', path.join(claudeHome, 'settings.json')),
  home: opt('--home', path.join(claudeHome, 'jspark-forge')),
};
const r = args.includes('--status') ? sl.status(p) : args.includes('--undo') ? sl.undo(p) : sl.install(p);
process.stdout.write(`${r.message}\n`);
process.exitCode = r.ok ? 0 : 1;
