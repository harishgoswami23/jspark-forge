'use strict';
// v0.2 UI/UX companions tip (spec 5.14): one line, once per project, own projects with a front end only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (dir, f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };

function project(files, { own = true } = {}) {
  const dir = tmp('forge-uitip-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  for (const [f, c] of Object.entries(files)) put(dir, f, c);
  if (!own) { // someone else's clone: a remote and a commit by another author
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('add', '-A'); g('-c', 'user.email=someone@example.com', '-c', 'user.name=x', 'commit', '-qm', 'theirs');
    g('remote', 'add', 'origin', 'https://example.com/someone/their-repo.git');
    g('config', 'user.email', 'me@example.com');
  }
  if (own) {
    fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
    require('../scripts/lib/paths').markOwn(dir);
  }
  return dir;
}
// One fake home: CLAUDE_CONFIG_DIR is <home>/.claude, so the real ~/.claude and ~/.claude.json are never read.
function session(dir, home, id = 'ui-0001') {
  const r = spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      HOME: home, USERPROFILE: home, JSPARK_FORGE_AUTO_STATUSLINE: 'off' }) });
  const o = r.stdout ? JSON.parse(r.stdout) : null;
  return ((o && o.systemMessage) || '').split('\n').filter(l => /UI\/UX|UI work/.test(l));
}
const pkg = deps => JSON.stringify({ name: 'x', dependencies: deps });

test('a React project gets one line naming all three companions', () => {
  const dir = project({ 'package.json': pkg({ react: '^18.0.0' }) });
  const lines = session(dir, tmp('forge-uitip-home-'));
  assert.equal(lines.length, 1, lines.join('|'));
  assert.match(lines[0], /^JSPARK Forge tip \(once\)/);
  assert.ok(lines[0].includes('/plugin install frontend-design@claude-plugins-official'));
  assert.ok(lines[0].includes('claude mcp add playwright npx @playwright/mcp@0.0.86'));
  assert.ok(lines[0].includes('npx shadcn@4.23.0 mcp init --client claude'));
});

test('a Vue project gets frontend-design and Playwright, not shadcn', () => {
  const dir = project({ 'package.json': pkg({ vue: '^3.0.0' }) });
  const [l] = session(dir, tmp('forge-uitip-home-'));
  assert.ok(l.includes('frontend-design') && l.includes('playwright'));
  assert.ok(!/shadcn/.test(l));
});

test('front end detected from files at the top or in src/ when package.json says nothing', () => {
  const a = project({ 'index.html': '<html></html>' });
  assert.equal(session(a, tmp('forge-uitip-home-')).length, 1);
  const b = project({ 'src/App.svelte': '<p>hi</p>' });
  assert.equal(session(b, tmp('forge-uitip-home-')).length, 1);
});

test('a project with no front end gets nothing', () => {
  const dir = project({ 'package.json': pkg({ express: '^4.0.0' }), 'server.js': 'x' });
  assert.equal(session(dir, tmp('forge-uitip-home-')).length, 0);
});

test('the second session gets nothing', () => {
  const dir = project({ 'package.json': pkg({ react: '1' }) });
  const home = tmp('forge-uitip-home-');
  assert.equal(session(dir, home).length, 1);
  assert.equal(session(dir, home, 'ui-0002').length, 0);
});

test('installed companions are left out', () => {
  const dir = project({ 'package.json': pkg({ react: '1' }), 'components.json': '{}', '.mcp.json': '{"mcpServers":{"playwright":{},"chrome-devtools":{}}}' });
  const home = tmp('forge-uitip-home-');
  put(home, '.claude/plugins/installed_plugins.json', '{"frontend-design@claude-plugins-official":[]}');
  assert.equal(session(dir, home).length, 0, 'all installed: no line');

  const d2 = project({ 'package.json': pkg({ react: '1' }), 'components.json': '{}' });
  const h2 = tmp('forge-uitip-home-');
  put(h2, '.claude.json', '{"mcpServers":{"playwright":{}}}');
  const [l] = session(d2, h2);
  assert.ok(l.includes('frontend-design') && !/playwright/.test(l) && !/shadcn/.test(l), l);
});

test('a guest repo gets nothing and nothing is written in it', () => {
  const dir = project({ 'package.json': pkg({ react: '1' }) }, { own: false });
  assert.equal(session(dir, tmp('forge-uitip-home-')).length, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge')));
});

test('research 2026-11-20: the tip also names Chrome DevTools MCP (live page checks), left out once installed', () => {
  const dir = project({ 'package.json': pkg({ vue: '^3.0.0' }) });
  const [l] = session(dir, tmp('forge-uitip-home-'));
  assert.ok(l.includes('/plugin install chrome-devtools-mcp@claude-plugins-official'), l);
  const dir2 = project({ 'package.json': pkg({ vue: '^3.0.0' }), '.mcp.json': '{"mcpServers":{"chrome-devtools":{"command":"npx"}}}' });
  const [l2] = session(dir2, tmp('forge-uitip-home-'));
  assert.ok(!l2.includes('chrome-devtools'), l2);
});
