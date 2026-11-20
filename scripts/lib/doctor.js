'use strict';
// Health check and status (spec 5.13c, pulled into v0.1.1). doctor is read-only: one line per check, "ok" or "FIX"
// with the one step that fixes it. The hook timing runs each hook once in a new empty temp folder (outside the
// project and the config folder) and removes it. status: what is saved now.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths');

const ROOT = path.join(__dirname, '..', '..');
const REINSTALL = 'reinstall with /plugin install jspark-forge@jspark-forge';
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
const ago = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 172800 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

function checkNode() {
  const v = process.versions.node;
  return Number(v.split('.')[0]) >= 18 ? ['ok', `Node.js ${v}`]
    : ['FIX', `Node.js ${v} is too old; JSPARK Forge needs 18 or newer. Fix: install the current LTS from nodejs.org.`];
}

function forgeHooks(hooks) { // [{ event, timeout }] for every hook that runs forge.js
  const out = [];
  for (const [event, groups] of Object.entries((hooks && hooks.hooks) || {})) {
    for (const g of groups) for (const h of g.hooks || []) {
      if ((h.args || []).some(a => /scripts\/forge\.js$/.test(a))) out.push({ event, timeout: (h.timeout || 60) * 1000, args: h.args });
    }
  }
  return out;
}

function checkFiles() {
  const hooks = readJson(path.join(ROOT, 'hooks', 'hooks.json'));
  const missing = [];
  if (!hooks) missing.push('hooks/hooks.json');
  for (const h of forgeHooks(hooks)) {
    const f = h.args.find(a => /forge\.js$/.test(a)).replace('${CLAUDE_PLUGIN_ROOT}', ROOT);
    if (!fs.existsSync(f) && !missing.includes('scripts/forge.js')) missing.push('scripts/forge.js');
  }
  if (!readJson(path.join(ROOT, 'rules', 'default-blocklist.json'))) missing.push('rules/default-blocklist.json');
  for (const f of ['rules/grounding.md', 'templates/rules.md', 'scripts/statusline/wrapper.js']) if (!fs.existsSync(path.join(ROOT, f))) missing.push(f);
  return missing.length ? ['FIX', `Plugin files: missing or broken: ${missing.join(', ')}. Fix: ${REINSTALL}.`]
    : ['ok', `Plugin files: complete (${forgeHooks(hooks).length} hooks registered)`];
}

// Best of two tries: one slow start on a busy machine (antivirus, a build running) is not a slow hook. Flagged only
// when even the better try fails or uses more than 90 % of the hook's limit.
function timeHook(h, run) {
  let best = run();
  if (!best.ok || best.ms > h.timeout * 0.5) { const again = run(); if (again.ok && (!best.ok || again.ms < best.ms)) best = again; }
  return { ms: best.ms, slow: !best.ok || best.ms > h.timeout * 0.9 };
}

function checkHooks() {
  const list = forgeHooks(readJson(path.join(ROOT, 'hooks', 'hooks.json')));
  if (!list.length) return ['FIX', `Hooks: none registered. Fix: ${REINSTALL}.`];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jspark-forge-doctor-'));
  const slow = [];
  let worst = { event: '', ms: 0, limit: 1 };
  try {
    const runOnce = h => {
      const t = Date.now();
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'forge.js'), h.event], { cwd: tmp, encoding: 'utf8', timeout: h.timeout,
        input: JSON.stringify({ session_id: 'doctor', cwd: tmp, source: 'startup', tool_name: 'Bash', tool_input: { command: 'echo ok' } }),
        env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp, CLAUDE_CONFIG_DIR: tmp, JSPARK_FORGE_AUTO_STATUSLINE: 'off', JSPARK_FORGE_AUTO_SETUP: 'off' }), windowsHide: true });
      return { ms: Date.now() - t, ok: !r.error && r.status === 0 };
    };
    for (const h of list) {
      const r = timeHook(h, () => runOnce(h));
      if (r.slow) slow.push(`${h.event} (${r.ms} ms of ${h.timeout})`);
      if (r.ms / h.timeout > worst.ms / worst.limit) worst = { event: h.event, ms: r.ms, limit: h.timeout };
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return slow.length
    ? ['FIX', `Hooks: too slow or failing: ${slow.join(', ')}; a hook past its limit is skipped. Fix: close heavy programs and run /jspark-forge:doctor again; if it stays, ${REINSTALL}.`]
    : ['ok', `Hooks: ${list.length} answer in time (slowest: ${worst.event}, ${worst.ms} ms of ${worst.limit})`];
}

function checkGit() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  return !r.error && r.status === 0 ? ['ok', `Git: ${String(r.stdout).trim().replace(/^git version\s*/, '')}`]
    : ['FIX', 'Git: not found. Without it JSPARK Forge cannot tell your repos from ones you review. Fix: install Git from git-scm.com.'];
}

function checkProject(dir) {
  if (!dir) return [['ok', 'Project: JSPARK Forge is not on in this folder (it switches on by itself at the next session in a git project).']];
  const out = [];
  const f = paths.forgeDir(dir);
  const where = paths.isGuest(dir) ? `a repo you are reviewing; files in ${f.replace(/\\/g, '/')}` : 'yours; files in .jspark-forge/';
  try { fs.accessSync(f, fs.constants.W_OK); out.push(['ok', `Project: ${where}`]); }
  catch { out.push(['FIX', `Project: ${where}, but that folder cannot be written. Fix: check its permissions (or that the disk is not full).`]); }
  // Rules
  const rules = require('./rules').loadRules(dir);
  if (rules.errors.length) {
    for (const e of rules.errors) out.push(['FIX', `Rules: ${e.file || '.jspark-forge/rules.md'} line ${e.line}: ${e.message}; the line is skipped. Fix: correct or remove that line.`]);
  } else {
    out.push(['ok', `Rules: ${rules.confirm.length} confirm, ${rules.never.length} never, ${rules.readonly.length} read-only${rules.disabled.length ? `; you switched off ${rules.disabled.join(', ')}` : ''}`]);
  }
  // Handoff
  const md = path.join(f, 'handoff.md');
  if (fs.existsSync(md)) {
    const meta = readJson(path.join(f, 'state', 'handoff.json'));
    out.push(meta && typeof meta === 'object'
      ? ['ok', `Handoff: readable, saved ${meta.savedAt ? ago(Date.now() - meta.savedAt) : 'at an unknown time'}`]
      : ['FIX', 'Handoff: its record (state/handoff.json) is damaged, so the next session cannot offer to resume. Fix: run /jspark-forge:handoff to write a fresh one.']);
  } else out.push(['ok', 'Handoff: none yet (written once there is work to resume)']);
  return out;
}

function checkStatusLine(home, dir) {
  const settings = readJson(path.join(home, 'settings.json'));
  if (settings === undefined && fs.existsSync(path.join(home, 'settings.json'))) {
    return [['FIX', 'Status line: settings.json is not valid JSON, so Claude Code ignores it. Fix: correct the file (JSPARK Forge never edits it while it is broken).']];
  }
  const sl = settings && settings.statusLine;
  if (!sl || !sl.command) return [['FIX', 'Status line: none, so the saves at 80 % and 95 % usage are off. Fix: /jspark-forge:init (asks first).']];
  if (!/jspark-forge\/statusline\.js/.test(String(sl.command).replace(/\\/g, '/'))) {
    return [['FIX', 'Status line: your own; JSPARK Forge left it untouched, so the 80 % and 95 % saves are off. Fix: /jspark-forge:init (keeps your status line as it is and asks first).']];
  }
  if (!fs.existsSync(path.join(home, 'jspark-forge', 'statusline.js'))) {
    return [['FIX', 'Status line: set to JSPARK Forge, but its file is missing. Fix: /jspark-forge:init --undo-statusline, then /jspark-forge:init.']];
  }
  const out = [['ok', 'Status line: JSPARK Forge wrapper in place']];
  const u = dir && newestUsage(dir);
  if (u && Date.now() - u.ts > 10 * 60000) {
    out.push(['FIX', `Usage figures: last update ${ago(Date.now() - u.ts)}; the status line is not reaching this project. Fix: restart Claude Code here; if it stays, run /jspark-forge:init.`]);
  }
  return out;
}

function checkAutoUpdate(home) {
  const au = require('./autoupdate');
  const st = au.state(home);
  if (st === 'on') return ['ok', 'Auto-update: on'];
  // Off by an explicit false, or JSPARK Forge already switched it on once and it is not on now: the user's choice.
  if (st === 'off' || (st === 'undecided' && au.decided(home))) return ['ok', 'Auto-update: off by your choice (turn on: /plugin → Marketplaces → jspark-forge)'];
  if (st === 'undecided') return ['FIX', 'Auto-update: not on yet, so new JSPARK Forge versions do not arrive. Fix: restart Claude Code (JSPARK Forge switches it on at the next start), or /plugin → Marketplaces → jspark-forge.'];
  return ['ok', 'Auto-update: not installed from the jspark-forge marketplace (a local copy updates by hand)'];
}

// The two bundled servers: what the project's switches say first, then what the launcher recorded in bundled.json.
function checkBundled(home, dir) {
  const bundled = require('./bundled');
  const folder = dir || process.cwd();
  const rec = bundled.read(home, folder);
  const out = [];
  for (const [name, label] of [['codebase-memory', 'Code map'], ['playwright', 'Playwright']]) {
    const mode = bundled.mode(name, folder);
    const r = rec[name];
    const s = bundled.SERVERS[name];
    if (mode === 'off') out.push(['ok', `${label}: off by your choice`]);
    else if (mode === 'no-frontend') out.push(['ok', 'Playwright: off here (no front end in this project)']);
    else if (mode === 'node-too-old') out.push(['ok', `Playwright: off here (it needs Node.js 20 or newer; you have ${process.versions.node})`]);
    else if (!r || typeof r !== 'object') out.push(['FIX', `${label}: the engine has not started. Fix: restart Claude Code; if it stays, update Claude Code.`]);
    else if (r.exit) out.push(['FIX', `${label}: the engine did not start (${String(r.exit.reason || `exit code ${r.exit.code}`)}). Fix: check the network and that antivirus has not quarantined it, then restart Claude Code.`]);
    else if (r.mode !== 'run' || !bundled.pidAlive(r.pid)) out.push(['FIX', `${label}: the engine is not running in this session. Fix: restart Claude Code; if it stays, run /mcp and check that the jspark-forge servers are on.`]);
    else out.push(['ok', `${label}: engine running (${s.pkg} ${r.pin || s.pin})`]);
  }
  try {
    const userHome = process.env.CLAUDE_CONFIG_DIR ? home : os.homedir(); // with a custom config folder, .claude.json lives in it
    const e = require('./map').engines(dir, userHome);
    if (e.bundled && e.own) out.splice(1, 0, ['FIX', "Code map: two engines (JSPARK Forge's and your own codebase-memory-mcp). Fix: remove yours with: claude mcp remove codebase-memory-mcp"]);
  } catch { /* the check is a bonus */ }
  return out;
}

// v0.5: in a front-end project, which skills Claude is told to load before UI work.
function checkUiSkills(home, dir) {
  if (!dir) return [];
  const f = require('./uiskills').facts(dir, home);
  if (!f) return [];
  if (!f.on) return [['ok', 'UI skills: off by your choice (- ui-skills: off)']];
  const fd = f.frontendDesign ? 'frontend-design' : 'frontend-design (once it is installed)';
  return [['ok', f.brand
    ? `UI skills: ${fd} and the brand skill ${f.brand} are loaded before UI work`
    : `UI skills: ${fd} is loaded before UI work; no brand skill is named (name yours: - brand-skill: <name> under ## Settings in rules.md)`]];
}

function checkCompanions(home) {
  const c = require('./companions');
  const flags = (readJson(path.join(home, 'jspark-forge', 'state.json')) || {}).companions || {};
  const results = c.results(home);
  const missing = c.LIST.filter(x => !c.installed(home, x.name));
  if (!missing.length) return [['ok', `UI companions: ${c.LIST.map(x => x.name).join(' and ')} installed`]];
  return missing.map(x => {
    const r = results[x.name];
    if (!flags[x.name]) return ['ok', `UI companions: ${x.name} not added yet (JSPARK Forge adds it at the next start from its marketplace; or: /plugin install ${x.id})`];
    if (r && r.ok === false) return ['FIX', `UI companions: ${x.name} could not be added (${r.reason || 'no reason recorded'}). Fix: /plugin install ${x.id}`];
    // The flag is the time the install was started (companions.ensure). No result after 10 minutes: it never finished.
    if (!r && !(typeof flags[x.name] === 'number' && Date.now() - flags[x.name] <= 10 * 60000)) return ['FIX', `UI companions: ${x.name} could not be added (no result from the install). Fix: /plugin install ${x.id}`];
    if (!r) return ['ok', `UI companions: ${x.name} is being added; it loads the next time Claude Code starts`];
    return ['ok', `UI companions: ${x.name} not installed (add: /plugin install ${x.id})`];
  });
}

function newestUsage(dir) {
  const d = path.join(paths.forgeDir(dir), 'usage');
  let best = null;
  try { for (const n of fs.readdirSync(d)) { const j = readJson(path.join(d, n)); if (j && typeof j.ts === 'number' && (!best || j.ts > best.ts)) best = j; } } catch {}
  return best;
}

function doctor(dir, home) {
  const lines = [checkNode(), checkFiles(), checkHooks(), checkGit(), ...checkProject(dir), ...checkStatusLine(home, dir), checkAutoUpdate(home), ...checkBundled(home, dir), ...checkCompanions(home), ...checkUiSkills(home, dir)];
  const bad = lines.filter(l => l[0] === 'FIX').length;
  return `JSPARK Forge doctor: ${lines.length - bad} ok, ${bad} to fix\n${lines.map(([s, t]) => `${s.padEnd(4)} ${t}`).join('\n')}\n`;
}

function status(dir) {
  if (!dir) return 'JSPARK Forge is not on in this folder (it switches on by itself at the next session in a git project).\n';
  const f = paths.forgeDir(dir);
  const L = [`JSPARK Forge status (${paths.isGuest(dir) ? 'a repo you are reviewing' : 'your project'})`];
  const meta = readJson(path.join(f, 'state', 'handoff.json'));
  if (meta && meta.status === 'open' && meta.savedAt) {
    L.push(`Handoff: saved ${ago(Date.now() - meta.savedAt)}${meta.task ? `: "${meta.task}"` : ''}${meta.step ? `, step ${meta.step.n} of ${meta.step.m}` : ''}`);
  } else L.push('Handoff: nothing to resume');
  const items = require('./waiting').read(dir);
  L.push(items.length ? `Waiting on you: ${items.length} (oldest ${require('./waiting').ago(Date.now() - Math.min(...items.map(x => x.askedAt)))})` : 'Waiting on you: nothing');
  const u = newestUsage(dir);
  const pct = (label, v) => (typeof v === 'number' ? `${label} ${Math.round(v)} %` : null);
  const figs = u ? [pct('context', u.context_pct), pct('5-hour', u.five_hour_pct), pct('7-day', u.seven_day_pct)].filter(Boolean) : [];
  L.push(figs.length ? `Usage: ${figs.join(', ')} (as of ${ago(Date.now() - u.ts)})` : 'Usage: no figures yet (they come from the status line)');
  return `${L.join('\n')}\n`;
}

module.exports = { doctor, status, timeHook };
