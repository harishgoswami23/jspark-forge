'use strict';
// v0.5 design section 3: the two UI companions (frontend-design, Chrome DevTools MCP) are added once per machine, in
// the background, when JSPARK Forge came from its marketplace and the official marketplace is known. The hook only
// sets the flags and starts a detached runner (scripts/companion-install.js); it never waits for the install.
// Machine files live in <claude home>/jspark-forge/: state.json (flags, here) and companions.json (the runner's result).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { writeAtomic } = require('./fsx');
const memory = require('./memory');

const LIST = [
  { name: 'frontend-design', id: 'frontend-design@claude-plugins-official' },
  { name: 'chrome-devtools-mcp', id: 'chrome-devtools-mcp@claude-plugins-official' },
];
const RUNNER = path.join(__dirname, '..', 'companion-install.js');

const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = f => { try { return JSON.parse(readText(f)); } catch { return null; } };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const dirOf = home => path.join(home, 'jspark-forge');

// Same detection as superpowers (installed_plugins.json text, or a folder in plugins/cache/<marketplace>/).
function installed(home, name) {
  const plugins = path.join(home, 'plugins');
  if (readText(path.join(plugins, 'installed_plugins.json')).includes(name)) return true;
  try { return fs.readdirSync(path.join(plugins, 'cache')).some(m => fs.existsSync(path.join(plugins, 'cache', m, name))); } catch { return false; }
}

function fromMarketplace(home) {
  const k = readJson(path.join(home, 'plugins', 'known_marketplaces.json'));
  return isObj(k) && isObj(k['jspark-forge']) && isObj(k['claude-plugins-official']);
}

const join = a => (a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// -> lines for the start-up message. Flags are written to state.json (under a lock, atomically) BEFORE anything starts,
// so two sessions starting together start each install once. Never throws.
function ensure(home, st) {
  try {
    if (process.env.JSPARK_FORGE_AUTO_SETUP === 'off' || !fromMarketplace(home)) return [];
    const stateFile = path.join(dirOf(home), 'state.json');
    fs.mkdirSync(dirOf(home), { recursive: true });
    const fresh = [];
    memory.withLock(stateFile, () => {
      const disk = readJson(stateFile);
      const cur = isObj(disk) ? disk : {};
      const flags = Object.assign({}, isObj(cur.companions) ? cur.companions : {}, isObj(st.companions) ? st.companions : {});
      const now = Date.now();
      for (const c of LIST) if (!flags[c.name]) { flags[c.name] = now; fresh.push(c); }
      st.companions = flags;
      if (fresh.length) writeAtomic(stateFile, JSON.stringify(Object.assign(cur, { companions: flags }), null, 2) + '\n');
    });
    // One detached runner for all of them: the installs run one after the other, never two claude processes at once.
    // It starts in the claude home (not the session's folder) with NoDefaultCurrentDirectoryInExePath set.
    const adding = fresh.filter(c => !installed(home, c.name));
    if (adding.length) {
      try {
        const p = spawn(process.execPath, [RUNNER, home, ...adding.map(c => c.name)], { detached: true, stdio: 'ignore', windowsHide: true,
          cwd: home, env: Object.assign({}, process.env, { NoDefaultCurrentDirectoryInExePath: '1' }) });
        p.on('error', () => {});
        p.unref();
      } catch { adding.length = 0; /* never break a session start */ }
    }
    if (!adding.length) return [];
    return [`JSPARK Forge is adding ${join(adding.map(c => c.name))} (for UI work); they load the next time Claude Code starts. ` +
      `Remove any time: /plugin uninstall ${adding.map(c => c.id).join(' or /plugin uninstall ')}.`];
  } catch { return []; }
}

// For the doctor: { "<name>": { at, ok, reason } } as the runner wrote it, or {}.
function results(home) {
  const r = readJson(path.join(dirOf(home), 'companions.json'));
  return isObj(r) ? r : {};
}

module.exports = { LIST, installed, ensure, results, fromMarketplace };
