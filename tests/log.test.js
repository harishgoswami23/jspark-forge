'use strict';
// Design section 6: action log format, daily files, 2 MB cap, 7-day expiry into a mechanical summary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const log = require('../scripts/lib/log');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-log-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge'));
  return dir;
}
const at = (y, m, d, hh = 14, mm = 24, ss = 7) => new Date(y, m - 1, d, hh, mm, ss);

test('formats a main-session line: time, padded [session], padded kind, detail', () => {
  const line = log.formatLine({ time: at(2026, 11, 2), session: 'a1b2c3d4-ffff', kind: 'BASH', detail: 'run unit tests :: npm test' });
  assert.equal(line, '14:24:07 [a1b2c3d4]          BASH  run unit tests :: npm test');
});

test('formats a helper line with [session/agent]', () => {
  const line = log.formatLine({ time: at(2026, 11, 2, 14, 24, 31), session: 'a1b2c3d4-x', agent: '9f8e7d6c-y', kind: 'EDIT', detail: 'src/routes/save.ts' });
  assert.equal(line, '14:24:31 [a1b2c3d4/9f8e7d6c] EDIT  src/routes/save.ts');
});

test('collapses whitespace and caps detail at 300 characters', () => {
  const line = log.formatLine({ time: at(2026, 11, 2), session: 's', kind: 'BASH', detail: 'a\n\n  b\t' + 'x'.repeat(400) });
  const detail = line.slice(line.indexOf('BASH  ') + 6);
  assert.ok(!/\s{2,}|\n|\t/.test(detail));
  assert.ok(detail.length <= 300);
  assert.ok(detail.startsWith('a b x'));
});

test('redacts secrets in the detail', () => {
  const line = log.formatLine({ time: at(2026, 11, 2), session: 's', kind: 'BASH', detail: 'mysql -pHunter22 db' });
  assert.ok(!line.includes('Hunter22'));
});

test('appends to .jspark-forge/log/<local date>.log', () => {
  const dir = tmpProject();
  log.append(dir, { time: at(2026, 11, 2), session: 'abc', kind: 'STOP', detail: '' });
  log.append(dir, { time: at(2026, 11, 2, 15), session: 'abc', kind: 'END', detail: 'logout' });
  const text = fs.readFileSync(path.join(dir, '.jspark-forge', 'log', '2026-11-02.log'), 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 2);
  assert.ok(text.endsWith('\n') && !text.includes('\r'));
});

test('at the size cap writes LOG CAPPED once, then keeps only SAVE/BLOCK/CONFIRM/COMMIT', () => {
  const dir = tmpProject();
  const opts = { capBytes: 300 };
  const t = at(2026, 11, 3);
  for (let i = 0; i < 10; i++) log.append(dir, { time: t, session: 's', kind: 'BASH', detail: 'x'.repeat(50) }, opts);
  log.append(dir, { time: t, session: 's', kind: 'BLOCK', detail: 'git-reset-hard' }, opts);
  log.append(dir, { time: t, session: 's', kind: 'EDIT', detail: 'should-not-appear' }, opts);
  const text = fs.readFileSync(path.join(dir, '.jspark-forge', 'log', '2026-11-03.log'), 'utf8');
  assert.equal(text.match(/LOG CAPPED/g).length, 1);
  assert.ok(text.includes('BLOCK git-reset-hard'));
  assert.ok(!text.includes('should-not-appear'));
});

test('rotate: day files older than 7 days become a summary block and are deleted', () => {
  const dir = tmpProject();
  const old = at(2026, 11, 1);
  log.append(dir, { time: old, session: 'aaaa1111', kind: 'EDIT', detail: 'src/a.ts' });
  log.append(dir, { time: old, session: 'aaaa1111', kind: 'EDIT', detail: 'src/a.ts' });
  log.append(dir, { time: old, session: 'bbbb2222', kind: 'WRITE', detail: 'src/b.ts' });
  log.append(dir, { time: old, session: 'aaaa1111', kind: 'COMMIT', detail: '3f2e1d0 add chart model' });
  log.append(dir, { time: old, session: 'aaaa1111', kind: 'BLOCK', detail: 'git-reset-hard :: git reset --hard' });
  log.append(dir, { time: at(2026, 11, 7), session: 'cccc', kind: 'STOP', detail: '' });

  log.rotate(dir, at(2026, 11, 9));

  const logDir = path.join(dir, '.jspark-forge', 'log');
  assert.ok(!fs.existsSync(path.join(logDir, '2026-11-01.log')), 'old file deleted');
  assert.ok(fs.existsSync(path.join(logDir, '2026-11-07.log')), 'recent file kept');
  const sum = fs.readFileSync(path.join(logDir, 'summary.md'), 'utf8');
  assert.match(sum, /## 2026-11-01/);
  assert.match(sum, /EDIT 2/);
  assert.match(sum, /WRITE 1/);
  assert.match(sum, /src\/a\.ts \(2\)/);
  assert.match(sum, /3f2e1d0 add chart model/);
  assert.match(sum, /git-reset-hard/);
  assert.match(sum, /Sessions: 2/);
});

test('rotate keeps only the latest 60 day-summaries, newest first', () => {
  const dir = tmpProject();
  for (let d = 0; d < 65; d++) {
    log.append(dir, { time: new Date(2026, 6, 1 + d, 10), session: 's', kind: 'STOP', detail: '' });
  }
  log.rotate(dir, new Date(2026, 11, 1));
  const sum = fs.readFileSync(path.join(dir, '.jspark-forge', 'log', 'summary.md'), 'utf8');
  const days = sum.match(/^## \d{4}-\d{2}-\d{2}/gm);
  assert.equal(days.length, 60);
  assert.ok(days[0] > days[59], 'newest first');
});

test('envSecrets reads values from .env files but not from templates', () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=real-secret-value-1\n# comment\nEMPTY=\nQUOTED="quoted-secret-2"\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=placeholder-value-3\n');
  const vals = log.envSecrets(dir);
  assert.ok(vals.includes('real-secret-value-1'));
  assert.ok(vals.includes('quoted-secret-2'));
  assert.ok(!vals.includes('placeholder-value-3'));
});
