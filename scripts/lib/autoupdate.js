'use strict';
// v0.5 design section 1: once per machine, when JSPARK Forge came from its marketplace and auto-update is not
// decided yet, switch it on in settings.json (extraKnownMarketplaces["jspark-forge"].autoUpdate = true; the settings
// entry wins, and the /plugin toggle writes there too: Claude Code docs, plugins/loading). Only that key changes.
// known_marketplaces.json is only read.
const fs = require('fs');
const path = require('path');
const { readSettings, atomicWrite, indentOf } = require('./statusline-install');

const NAME = 'jspark-forge';
const SOURCE = { source: 'github', repo: 'harishgoswami23/jspark-forge' };
const MESSAGE = 'JSPARK Forge switched on its own auto-update; new versions load when Claude Code starts. ' +
  'Undo: /plugin \u2192 Marketplaces \u2192 jspark-forge.';

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const known = home => {
  const k = readJson(path.join(home, 'plugins', 'known_marketplaces.json'));
  return isObj(k) && isObj(k[NAME]) ? k[NAME] : null;
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function ensure(home, st) {
  try {
    if (process.env.JSPARK_FORGE_AUTO_SETUP === 'off' || st.autoUpdateSet) return null;
    const k = known(home);
    if (!k || k.autoUpdate === false || k.autoUpdate === true) return null;
    const file = path.join(home, 'settings.json');
    // Read, change and write under one lock, so a second session (or anything else using the lock) cannot lose the key.
    // The flag is set only after the file is read again and the key is seen in it.
    fs.mkdirSync(home, { recursive: true });
    return require('./memory').withLock(file, () => {
      const s = readSettings(file);
      if (!s || !isObj(s.obj)) return null;
      const { before, text, obj } = s;
      if (obj.extraKnownMarketplaces !== undefined && !isObj(obj.extraKnownMarketplaces)) return null;
      const mk = obj.extraKnownMarketplaces || (obj.extraKnownMarketplaces = {});
      if (mk[NAME] !== undefined && !isObj(mk[NAME])) return null;
      if (mk[NAME] && has(mk[NAME], 'autoUpdate')) {
        if (mk[NAME].autoUpdate === true) st.autoUpdateSet = true; // already on (a second session got there first): done
        return null;
      }
      if (!mk[NAME]) mk[NAME] = { source: { ...SOURCE } };
      mk[NAME].autoUpdate = true;
      atomicWrite(file, JSON.stringify(obj, null, indentOf(text)) + (text.endsWith('\n') || !before ? '\n' : ''));
      const again = readSettings(file);
      const e = again && isObj(again.obj) && isObj(again.obj.extraKnownMarketplaces) ? again.obj.extraKnownMarketplaces[NAME] : null;
      if (!isObj(e) || e.autoUpdate !== true) return null;
      st.autoUpdateSet = true;
      return MESSAGE;
    });
  } catch { return null; }
}

// Read-only, for the doctor. F1: the settings entry's value when it has one, else the known file's.
function state(home) {
  const k = known(home);
  if (!k) return 'not-from-marketplace';
  const s = readSettings(path.join(home, 'settings.json'));
  const e = s && isObj(s.obj) && isObj(s.obj.extraKnownMarketplaces) ? s.obj.extraKnownMarketplaces[NAME] : null;
  const v = isObj(e) && has(e, 'autoUpdate') ? e.autoUpdate : k.autoUpdate;
  if (v === true) return 'on';
  return v === false ? 'off' : 'undecided';
}

// Read-only, for the doctor: has JSPARK Forge already made its one decision on this machine (state.json)?
function decided(home) {
  const st = readJson(path.join(home, 'jspark-forge', 'state.json'));
  return isObj(st) && st.autoUpdateSet === true;
}

module.exports = { ensure, state, decided, MESSAGE };
