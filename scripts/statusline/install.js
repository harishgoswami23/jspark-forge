#!/usr/bin/env node
'use strict';
// JSPARK Forge status-line installer (design 7.1, 7.4; owner 2026-11-19: refreshInterval 30 when the user has none).
//   node install.js             wrap the user's status line (asked first by /jspark-forge:init)
//   node install.js --undo      put it back
//   node install.js --status    print the current status-line command (for the disclosure); changes nothing
// Options for tests: --settings <path> (default ~/.claude/settings.json), --home <dir> (default ~/.claude/jspark-forge)
// Undo is byte-identical when settings.json was not edited since install; otherwise only the statusLine value is
// put back (or the key removed) and every other edit is kept.
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SETTINGS = opt('--settings', path.join(os.homedir(), '.claude', 'settings.json'));
const HOME = opt('--home', path.join(os.homedir(), '.claude', 'jspark-forge'));
const CONFIG = path.join(HOME, 'statusline.json');
const WRAPPER = path.join(HOME, 'statusline.js');
const REFRESH_S = 30;

const fwd = p => p.replace(/\\/g, '/');
const OUR_COMMAND = `node "${fwd(WRAPPER)}"`;

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const indentOf = text => { const m = text.match(/\n([ \t]+)"/); return m ? m[1] : 2; };
function fail(msg) { process.stdout.write(`${msg}\n`); process.exit(1); }

function readSettings() {
  const before = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
  const text = before ? before.toString('utf8') : '{}';
  let obj;
  try { obj = JSON.parse(text); } catch { fail(`JSPARK Forge did not change anything: ${SETTINGS} is not valid JSON.`); }
  return { before, text, obj };
}

if (args.includes('--status')) {
  const { obj } = readSettings();
  const sl = obj.statusLine;
  process.stdout.write(`Current status line: ${sl && sl.command ? sl.command : 'none'}\n`);
  process.exit(0);
}

if (args.includes('--undo')) {
  if (!fs.existsSync(CONFIG)) { process.stdout.write('Nothing to undo: JSPARK Forge has not wrapped your status line.\n'); process.exit(0); }
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const now = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
  if (now && now.toString('base64') === cfg.settingsAfter) {
    if (cfg.settingsBefore === null) fs.unlinkSync(SETTINGS);
    else atomicWrite(SETTINGS, Buffer.from(cfg.settingsBefore, 'base64'));
    process.stdout.write('Your status line is restored exactly as it was.\n');
  } else {
    const text = now ? now.toString('utf8') : '{}';
    let obj;
    try { obj = JSON.parse(text); } catch { fail(`JSPARK Forge did not change anything: ${SETTINGS} is not valid JSON.`); }
    if (cfg.hadKey) obj.statusLine = cfg.original; else delete obj.statusLine;
    atomicWrite(SETTINGS, JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
    process.stdout.write('Your status line is restored; your other settings changes since then are kept.\n');
  }
  fs.renameSync(CONFIG, path.join(HOME, `statusline.undone-${Date.now()}.json`));
  process.exit(0);
}

// ---- install ----
const { before, text, obj } = readSettings();
fs.mkdirSync(HOME, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'wrapper.js'), WRAPPER);
const current = obj.statusLine;
if (current && current.command === OUR_COMMAND) {
  process.stdout.write('JSPARK Forge already wraps your status line; the wrapper copy is updated.\n');
  process.exit(0);
}
const hadKey = Object.prototype.hasOwnProperty.call(obj, 'statusLine');
const original = hadKey ? current : null;
const next = { type: 'command', command: OUR_COMMAND };
if (original && original.padding !== undefined) next.padding = original.padding;
next.refreshInterval = original && original.refreshInterval !== undefined ? original.refreshInterval : REFRESH_S;
obj.statusLine = next;
const after = Buffer.from(JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') || !before ? '\n' : ''));
if (before) fs.writeFileSync(path.join(HOME, `settings.backup-${Date.now()}.json`), before);
atomicWrite(CONFIG, JSON.stringify({
  original, hadKey,
  settingsBefore: before ? before.toString('base64') : null,
  settingsAfter: after.toString('base64'),
  installedAt: new Date().toISOString(),
}, null, 2) + '\n');
atomicWrite(SETTINGS, after);
process.stdout.write(`Done. Your status line now ends with "· JSPARK Forge saved …" and refreshes every ${next.refreshInterval} s. ` +
  'Undo any time: /jspark-forge:init --undo-statusline\n');
