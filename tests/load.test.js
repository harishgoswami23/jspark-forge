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
