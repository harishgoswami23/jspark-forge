'use strict';
// v0.2 UI/UX companions tip (spec 5.14): once per project, in your own project only, when it has a front end, one line
// at SessionStart naming only the companions that are still missing, each with its install line. (Since v0.5 the
// companions are added automatically, by companions.js; this tip itself installs nothing.) Every read fails silently; a wrong guess about "installed" only shows the tip once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./paths');
const setup = require('./setup');
const { installed: pluginsMention } = require('./companions');
const bundled = require('./bundled');

const FRONTEND_DEPS = ['react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', '@angular/core',
  'solid-js', 'preact', '@remix-run/react', 'vite'];
const REACT_DEPS = ['react', 'react-dom', 'next', '@remix-run/react'];
const FRONTEND_FILE = /\.(html|tsx|jsx|vue|svelte)$/i;

const FD_INSTALL = '/plugin install frontend-design@claude-plugins-official';
const PW_INSTALL = 'claude mcp add playwright npx @playwright/mcp@0.0.86';
const SHADCN_INSTALL = 'npx shadcn@4.23.0 mcp init --client claude';
// Research 2026-11-20 (docs/ui-research.md): console errors, performance and layout shift on the live page.
const DEVTOOLS_INSTALL = '/plugin install chrome-devtools-mcp@claude-plugins-official';

const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = f => { try { return JSON.parse(readText(f)); } catch { return null; } };
const stateFile = dir => path.join(paths.forgeDir(dir), 'state', 'tips.json');

function deps(dir) {
  const p = readJson(path.join(dir, 'package.json'));
  return Object.assign({}, p && p.dependencies, p && p.devDependencies);
}
function hasFrontEndFiles(dir) {
  for (const d of [dir, path.join(dir, 'src')]) {
    try { if (fs.readdirSync(d, { withFileTypes: true }).some(e => e.isFile() && FRONTEND_FILE.test(e.name))) return true; } catch { /* none */ }
  }
  return false;
}

// Does the project have a front end: a known framework in package.json, or html/tsx/jsx/vue/svelte files.
const hasFrontEnd = dir => { const d = deps(dir); return FRONTEND_DEPS.some(n => n in d) || hasFrontEndFiles(dir); };

function notice(dir) {
  try {
    if (!paths.isOwn(dir)) return null;
    const file = stateFile(dir);
    const st = readJson(file) || {};
    if (st.uiCompanions) return null;
    const d = deps(dir);
    if (!FRONTEND_DEPS.some(n => n in d) && !hasFrontEndFiles(dir)) return null;
    const isReact = REACT_DEPS.some(n => n in d);

    const mcp = readText(path.join(dir, '.mcp.json'));
    const userMcp = readText(path.join(os.homedir(), '.claude.json'));
    const home = setup.claudeHome();
    const tried = (readJson(path.join(home, 'jspark-forge', 'state.json')) || {}).companions || {}; // automatic install is over
    const missing = [];
    if (tried['frontend-design'] && !pluginsMention(home, 'frontend-design')) missing.push(['frontend-design', FD_INSTALL]);
    if (bundled.mode('playwright', dir) === 'off' && !/playwright/i.test(mcp) && !/playwright/i.test(userMcp)) missing.push(['Playwright MCP', PW_INSTALL]);
    if (isReact && !fs.existsSync(path.join(dir, 'components.json')) && !/shadcn/i.test(mcp)) missing.push(['shadcn MCP', SHADCN_INSTALL]);
    if (tried['chrome-devtools-mcp'] && !/chrome-devtools/i.test(mcp) && !/chrome-devtools/i.test(userMcp) && !pluginsMention(home, 'chrome-devtools-mcp')) missing.push(['Chrome DevTools MCP', DEVTOOLS_INSTALL]);

    // Remembered even when everything is installed: nothing to say, nothing to ask again.
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(Object.assign(st, { uiCompanions: true }), null, 1)}\n`); } catch { /* fail open */ }
    if (!missing.length) return null;
    const parts = missing.map(([n, cmd]) => `${n} (${cmd})`);
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `JSPARK Forge tip (once): for top-quality UI work here, add ${list}, so Claude can design and check its own screens.`;
  } catch { return null; }
}

module.exports = { notice, hasFrontEnd, FD_INSTALL, PW_INSTALL, SHADCN_INSTALL, DEVTOOLS_INSTALL };
