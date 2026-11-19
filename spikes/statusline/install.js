#!/usr/bin/env node
// Spike B installer (throw-away). Usage:
//   node install.js [--settings <path>] [--home <dir>]          install the wrapper
//   node install.js --undo [--settings <path>] [--home <dir>]   restore
// Defaults: settings = ~/.claude/settings.json, home = ~/.claude/jspark-forge
// Undo is byte-identical when settings.json was not edited since install (restores the saved bytes); otherwise it
// puts back only the original statusLine value (or removes the key) and says so.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SETTINGS = opt('--settings', path.join(os.homedir(), '.claude', 'settings.json'));
const HOME = opt('--home', path.join(os.homedir(), '.claude', 'jspark-forge'));
const CONFIG = path.join(HOME, 'statusline.json');
const WRAPPER = path.join(HOME, 'statusline.js');

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function indentOf(text) { const m = text.match(/\n([ \t]+)"/); return m ? m[1] : 2; }
const fwd = p => p.replace(/\\/g, '/');

if (args.includes('--undo')) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const exists = fs.existsSync(SETTINGS);
  const now = exists ? fs.readFileSync(SETTINGS) : null;
  if (now && now.toString('base64') === cfg.settingsAfter) {
    if (cfg.settingsBefore === null) fs.unlinkSync(SETTINGS);
    else atomicWrite(SETTINGS, Buffer.from(cfg.settingsBefore, 'base64'));
    console.log('undo: settings restored byte-for-byte');
  } else {
    const text = now ? now.toString('utf8') : '{}';
    const obj = JSON.parse(text);
    if (cfg.hadKey) obj.statusLine = cfg.original; else delete obj.statusLine;
    atomicWrite(SETTINGS, JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
    console.log('undo: settings changed since install; restored only the statusLine value');
  }
  process.exit(0);
}

const before = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const text = before ? before.toString('utf8') : '{}';
const obj = JSON.parse(text);
const hadKey = Object.prototype.hasOwnProperty.call(obj, 'statusLine');
const original = hadKey ? obj.statusLine : null;
if (original && typeof original.command === 'string' && original.command.includes('jspark-forge/statusline.js')) {
  console.log('already installed'); process.exit(0);
}
fs.mkdirSync(HOME, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'wrapper.js'), WRAPPER);
const next = { type: 'command', command: `node "${fwd(WRAPPER)}"` };
if (original && original.padding !== undefined) next.padding = original.padding;
if (original && original.refreshInterval !== undefined) next.refreshInterval = original.refreshInterval;
obj.statusLine = next;
const after = Buffer.from(JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') || !before ? '\n' : ''));
atomicWrite(CONFIG, JSON.stringify({
  original, hadKey,
  settingsBefore: before ? before.toString('base64') : null,
  settingsAfter: after.toString('base64'),
  installedAt: new Date().toISOString(),
}, null, 2));
atomicWrite(SETTINGS, after);
console.log(`installed; original statusLine: ${original ? JSON.stringify(original) : 'none'}`);
