'use strict';
// Automatic setup (owner 2026-11-19: install the plugin and it works; no setup step).
// - ensureProject: in a git project, create .jspark-forge/ (own .gitignore, starter rules.md). Never outside git
//   projects, never in the home folder or a drive root.
// - machineMessages: once per machine, add JSPARK Forge's status line when the user has none (so the 80 % / 95 %
//   saves work), or leave theirs untouched and show a one-time tip; and suggest superpowers once.
//   JSPARK_FORGE_AUTO_STATUSLINE=off turns the automatic status line off (CI, people who never want it touched).
// Claude Code's own CLAUDE_CONFIG_DIR is honoured for where settings live.
const fs = require('fs');
const os = require('os');
const path = require('path');
const statusline = require('./statusline-install');
const paths = require('./paths');


const GITIGNORE = '*\n!.gitignore\n!rules.md\n';
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function inGitProject(dir) {
  const d0 = path.resolve(dir);
  if (d0 === path.resolve(os.homedir()) || path.dirname(d0) === d0) return false;
  for (let d = d0; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// -> 'created' | 'exists' | 'skipped'
function ensureProject(dir, { force = false } = {}) {
  const forge = paths.repoForgeDir(dir);
  if (fs.existsSync(forge)) return 'exists';
  if (!force && !inGitProject(dir)) return 'skipped';
  fs.mkdirSync(forge, { recursive: true });
  fs.writeFileSync(path.join(forge, '.gitignore'), GITIGNORE);
  fs.copyFileSync(path.join(__dirname, '..', '..', 'templates', 'rules.md'), path.join(forge, 'rules.md'));
  return 'created';
}

const ON_MESSAGE = 'JSPARK Forge is on in this project: it saves where you are and blocks dangerous commands. ' +
  'Its files are in .jspark-forge/ (commit rules.md and .gitignore; the rest stays local).';

function superpowersInstalled(home) {
  const plugins = path.join(home, 'plugins');
  try { if (fs.readFileSync(path.join(plugins, 'installed_plugins.json'), 'utf8').includes('superpowers')) return true; } catch {}
  try { return fs.readdirSync(path.join(plugins, 'cache')).some(m => fs.existsSync(path.join(plugins, 'cache', m, 'superpowers'))); } catch {}
  return false;
}
const SUPERPOWERS_TIP = 'Tip (shown once): JSPARK Forge works best with superpowers (https://github.com/obra/superpowers) for ' +
  'planning, tests first and reviews. Install it with: /plugin install superpowers@jspark-forge . Optional; JSPARK Forge never needs it.';

function machineMessages(home = claudeHome()) {
  const stateFile = path.join(home, 'jspark-forge', 'state.json');
  const st = readJson(stateFile) || {};
  const msgs = [];
  let changed = false;
  if (!st.statusline && process.env.JSPARK_FORGE_AUTO_STATUSLINE !== 'off') {
    const settings = path.join(home, 'settings.json');
    const cur = statusline.status({ settings });
    if (cur.ok && !cur.statusLine) {
      const r = statusline.install({ settings, home: path.join(home, 'jspark-forge') });
      if (r.ok) {
        st.statusline = 'installed';
        msgs.push('JSPARK Forge added a status line (you had none) so it can save at 80 % and 95 % usage. ' +
          'Undo any time: /jspark-forge:init --undo-statusline');
      }
    } else if (cur.ok) {
      st.statusline = 'own';
      msgs.push('You have your own status line, so JSPARK Forge left it untouched. To let it save at 80 % and 95 % ' +
        'usage, run /jspark-forge:init once (it asks first and keeps your status line as it is).');
    }
    changed = !!st.statusline;
  }
  // superpowers is a dependency (installed with JSPARK Forge from our marketplace). A user who already had it from
  // another marketplace now has it twice, so every skill shows twice: say once which copy to remove.
  const enabled = (readJson(path.join(home, 'settings.json')) || {}).enabledPlugins || {};
  const copies = Object.keys(enabled).filter(k => /^superpowers@/.test(k) && enabled[k] === true);
  if (copies.length > 1 && !st.superpowersDuplicateNoted) {
    const others = copies.filter(k => k !== 'superpowers@jspark-forge');
    msgs.push(`superpowers is installed twice (${copies.join(', ')}), so its skills show twice. JSPARK Forge needs its ` +
      `own copy; remove the other with: ${others.map(k => `/plugin uninstall ${k}`).join(' and ')}`);
    st.superpowersDuplicateNoted = true;
    changed = true;
  }
  if (!st.superpowersSuggested && !superpowersInstalled(home)) {
    msgs.push(SUPERPOWERS_TIP);
    st.superpowersSuggested = true;
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(st, null, 2) + '\n');
  }
  return msgs;
}

module.exports = { ensureProject, machineMessages, inGitProject, superpowersInstalled, claudeHome, ON_MESSAGE, SUPERPOWERS_TIP, GITIGNORE };
