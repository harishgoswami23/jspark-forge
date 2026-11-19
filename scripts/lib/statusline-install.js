'use strict';
// Status-line install / undo / status (design 7.1, 7.4; owner 2026-11-19: refreshInterval 30 when the user has none).
// Used by scripts/statusline/install.js (CLI, /jspark-forge:init) and by automatic setup (scripts/lib/setup.js).
// Undo is byte-identical when settings.json was not edited since install; otherwise only the statusLine value is put
// back (or the key removed) and every other edit is kept.
// Each function returns { ok, message }.
const fs = require('fs');
const path = require('path');

const REFRESH_S = 30;
const fwd = p => p.replace(/\\/g, '/');
const indentOf = text => { const m = text.match(/\n([ \t]+)"/); return m ? m[1] : 2; };

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readSettings(settings) {
  const before = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
  const text = before ? before.toString('utf8') : '{}';
  try { return { before, text, obj: JSON.parse(text) }; } catch { return null; }
}

const wrapperPath = home => path.join(home, 'statusline.js');
const ourCommand = home => `node "${fwd(wrapperPath(home))}"`;

function status({ settings }) {
  const s = readSettings(settings);
  if (!s) return { ok: false, message: `JSPARK Forge did not change anything: ${settings} is not valid JSON.` };
  const sl = s.obj.statusLine;
  return { ok: true, message: `Current status line: ${sl && sl.command ? sl.command : 'none'}`, statusLine: sl || null };
}

function install({ settings, home }) {
  const s = readSettings(settings);
  if (!s) return { ok: false, message: `JSPARK Forge did not change anything: ${settings} is not valid JSON.` };
  const { before, text, obj } = s;
  fs.mkdirSync(home, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'statusline', 'wrapper.js'), wrapperPath(home));
  const current = obj.statusLine;
  if (current && current.command === ourCommand(home)) {
    return { ok: true, message: 'JSPARK Forge already wraps your status line; the wrapper copy is updated.' };
  }
  const hadKey = Object.prototype.hasOwnProperty.call(obj, 'statusLine');
  const original = hadKey ? current : null;
  const next = { type: 'command', command: ourCommand(home) };
  if (original && original.padding !== undefined) next.padding = original.padding;
  next.refreshInterval = original && original.refreshInterval !== undefined ? original.refreshInterval : REFRESH_S;
  obj.statusLine = next;
  const after = Buffer.from(JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') || !before ? '\n' : ''));
  if (before) fs.writeFileSync(path.join(home, `settings.backup-${Date.now()}.json`), before);
  atomicWrite(path.join(home, 'statusline.json'), JSON.stringify({
    original, hadKey,
    settingsBefore: before ? before.toString('base64') : null,
    settingsAfter: after.toString('base64'),
    installedAt: new Date().toISOString(),
  }, null, 2) + '\n');
  atomicWrite(settings, after);
  return { ok: true, message: `Done. Your status line now ends with "· JSPARK Forge saved …" and refreshes every ${next.refreshInterval} s. ` +
    'Undo any time: /jspark-forge:init --undo-statusline' };
}

function undo({ settings, home }) {
  const config = path.join(home, 'statusline.json');
  if (!fs.existsSync(config)) return { ok: true, message: 'Nothing to undo: JSPARK Forge has not wrapped your status line.' };
  const cfg = JSON.parse(fs.readFileSync(config, 'utf8'));
  const now = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
  let message;
  if (now && now.toString('base64') === cfg.settingsAfter) {
    if (cfg.settingsBefore === null) fs.unlinkSync(settings);
    else atomicWrite(settings, Buffer.from(cfg.settingsBefore, 'base64'));
    message = 'Your status line is restored exactly as it was.';
  } else {
    const text = now ? now.toString('utf8') : '{}';
    let obj;
    try { obj = JSON.parse(text); } catch { return { ok: false, message: `JSPARK Forge did not change anything: ${settings} is not valid JSON.` }; }
    if (cfg.hadKey) obj.statusLine = cfg.original; else delete obj.statusLine;
    atomicWrite(settings, JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''));
    message = 'Your status line is restored; your other settings changes since then are kept.';
  }
  fs.renameSync(config, path.join(home, `statusline.undone-${Date.now()}.json`));
  return { ok: true, message };
}

module.exports = { install, undo, status, ourCommand };
