'use strict';
// A script that fails to load switches every hook off silently (they fail open by design), so: every module loads,
// and no source file holds characters that break a line or hide text (a tool once wrote a real U+2028 into a regex).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const files = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, dir, f));
const ALL = [...files('scripts/lib'), ...files('scripts'), ...files('scripts/statusline'), ...files('tests')];
const BAD = [0x2028, 0x2029, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff];

for (const f of files('scripts/lib')) {
  test(`loads: ${path.relative(ROOT, f)}`, () => { assert.doesNotThrow(() => require(f)); });
}

test('no source file holds line-breaking or hidden characters', () => {
  for (const f of ALL) {
    const text = fs.readFileSync(f, 'utf8');
    for (let i = 0; i < text.length; i++) {
      if (BAD.includes(text.charCodeAt(i))) assert.fail(`${path.relative(ROOT, f)}: U+${text.charCodeAt(i).toString(16)} at offset ${i}`);
    }
  }
});

test('forge.js answers a hook (the whole chain of modules loads)', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-load-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'forge.js'), 'PreToolUse'], { encoding: 'utf8',
    input: JSON.stringify({ session_id: 'load', cwd: tmp, tool_name: 'Bash', tool_input: { command: 'echo hi' } }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp }) });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '', 'no load error');
});

// CI (2026-11-20): a background `git status` took git's index lock and a user's own `git add` failed. Every git call
// JSPARK Forge makes runs with --no-optional-locks, so it never takes a lock git does not strictly need.
test('every git call JSPARK Forge makes passes --no-optional-locks', () => {
  const bad = [];
  for (const f of [...files('scripts/lib'), ...files('scripts')]) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/(spawnSync|execFileSync|spawn)\(\s*'git'/.test(l) && !/--no-optional-locks/.test(l) && !/'--version'/.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

// 2026-11-20: test runs had left about 50,000 folders in the OS temp folder. Each `npm test` run gets its own temp
// folder (tests/helpers/isolate.js), removed when the run ends.
test('tests write their temp files into one per-run folder', { skip: !process.env.FORGE_TEST_ISOLATED && 'not under npm test' }, () => {
  assert.match(path.basename(require('node:os').tmpdir()), /^forge-run-/);
  assert.ok(process.env.CLAUDE_CONFIG_DIR.startsWith(require('node:os').tmpdir()), 'the config folder is inside it too');
});

// 2026-11-20: a merge left conflict markers in a graph template that still passed lint. No shipped text file may hold one.
test('no shipped file holds a merge conflict marker', () => {
  const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(js|md|json|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const bad = [];
  for (const d of ['scripts', 'skills', 'agents', 'templates', 'rules', 'hooks', 'docs', '.claude-plugin']) {
    if (!fs.existsSync(path.join(ROOT, d))) continue;
    for (const f of walk(d)) {
      fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
        if (/^(<{7}|>{7}|={7})( |$)/.test(l.replace(/\r$/, ''))) bad.push(`${f}:${i + 1}`);
      });
    }
  }
  for (const f of ['README.md', 'JSPARK-FORGE.md']) {
    if (fs.existsSync(path.join(ROOT, f))) fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((l, i) => { if (/^(<{7}|>{7})( |$)/.test(l)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});
