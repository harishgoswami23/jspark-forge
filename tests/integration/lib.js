'use strict';
// Helpers for the integration tests: real Claude Code (`claude -p`), the plugin loaded with --plugin-dir.
// These cost plan usage, so they are not part of `npm test`; run them with `npm run test:integration`.
// FORGE_IT_MODEL picks the model for the work sessions (default haiku).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
// Real Claude Code runs with the real login and config: never let automatic setup touch the real status line.
process.env.JSPARK_FORGE_AUTO_STATUSLINE = 'off';
process.env.JSPARK_FORGE_AUTO_SETUP = 'off';
// The two servers that ship with the plugin start with no tools here: these tests must not download their programs
// (npx) on the machine that runs them. FORGE_IT_REAL_SERVERS=1 lets them start for real (a cold CI machine).
if (process.env.FORGE_IT_REAL_SERVERS !== '1') { process.env.JSPARK_FORGE_CODE_MAP = 'off'; process.env.JSPARK_FORGE_PLAYWRIGHT = 'off'; }
const MODEL = process.env.FORGE_IT_MODEL || 'haiku';
// Every folder a test file makes goes under one root, removed when the file ends; kept when a test failed, to look at.
// The real (long) path: on Windows runners the temp folder is a short 8.3 path (RUNNER~1), the model then writes to
// the long form, and Claude Code refuses the write as outside the working folder (seen 2026-11-20: no WRITE line).
const ROOT = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-it-run-')));
process.on('exit', code => {
  if (code || process.exitCode) { process.stderr.write(`integration files kept for a look: ${ROOT}
`); return; }
  try { fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
});
const tmp = prefix => fs.mkdtempSync(path.join(ROOT, prefix));

function project(prefix, { files = { 'a.txt': 'a\n' } } = {}) {
  const dir = tmp(`forge-it-${prefix}-`);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  gitInit(dir);
  initForge(dir);
  return dir;
}
function gitInit(dir) {
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  if (!fs.existsSync(path.join(dir, '.git'))) g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'it@example.invalid'); g('config', 'user.name', 'it'); g('config', 'core.autocrlf', 'false');
  g('add', '-A'); try { g('commit', '-qm', 'fixture'); } catch {}
}
function initForge(dir) {
  // A private claude-home so the one-time superpowers tip state of the real ~/.claude is not touched.
  const home = tmp('forge-it-home-');
  execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'init.js'), '--project', dir, '--claude-home', home]);
}
const args = (prompt, extra = []) => ['-p', prompt, '--plugin-dir', PLUGIN, '--model', MODEL, ...extra];

function claude(dir, prompt, extra = [], timeout = 300000) {
  const t = Date.now();
  const r = spawnSync('claude', args(prompt, extra), { cwd: dir, encoding: 'utf8', timeout, input: '' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status, ms: Date.now() - t };
}
function claudeBackground(dir, prompt, extra = []) {
  // detached on macOS/Linux makes claude a process-group leader, so killTree can kill the whole tree (-pid).
  return spawn('claude', args(prompt, extra), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32' });
}
function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}
function logText(dir) {
  const d = path.join(dir, '.jspark-forge', 'log');
  return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.log')).sort().map(f => fs.readFileSync(path.join(d, f), 'utf8')).join('') : '';
}
const kinds = dir => new Set(logText(dir).split('\n').map(l => (l.match(/^\d\d:\d\d:\d\d \[[^\]]*\]\s+(\S+)/) || [])[1]).filter(Boolean));
const gitStatus = dir => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' })
  .split('\n').filter(l => l && !l.includes('.jspark-forge/')).join('\n');
// What Claude Code says it loaded (docs: headless, "Fail CI when a plugin or MCP server doesn't load"): the system/init
// message of a stream-json run. -> { init, raw, status, err }
function loadReport(dir) {
  const r = spawnSync('claude', ['-p', 'Reply with the one word: ok', '--plugin-dir', PLUGIN, '--model', MODEL, '--output-format', 'stream-json', '--verbose'],
    { cwd: dir, encoding: 'utf8', timeout: 300000, input: '' });
  let init = null;
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    try { const m = JSON.parse(line); if (m && m.type === 'system' && m.subtype === 'init') { init = m; break; } } catch { /* not a message */ }
  }
  return { init, raw: r.stdout || '', status: r.status, err: r.stderr || '' };
}
const head = dir => execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

module.exports = { PLUGIN, tmp, MODEL, project, gitInit, initForge, claude, claudeBackground, killTree, logText, kinds, gitStatus, head, loadReport };
