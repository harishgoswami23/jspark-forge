'use strict';
// v0.5 design section 1: JSPARK Forge switches on its own auto-update once per machine (settings.json entry), when it
// came from its marketplace and nobody has decided yet. Every test uses its own temp home.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const setup = require('../scripts/lib/setup');
const autoupdate = require('../scripts/lib/autoupdate');

// These tests are about settings.json byte for byte: keep the automatic status line out of it.
process.env.JSPARK_FORGE_AUTO_STATUSLINE = 'off';

const SOURCE = { source: 'github', repo: 'harishgoswami23/jspark-forge' };
const FROM_GITHUB = { source: SOURCE, lastUpdated: '2026-11-20T00:00:00.000Z' };
// settings: an object (written as 2-space JSON), a string (written as is), or null (no file)
function home(marketplaces, settings = { statusLine: { type: 'command', command: 'mine' } }) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-autoup-'));
  fs.mkdirSync(path.join(h, 'plugins'), { recursive: true });
  if (settings !== null) fs.writeFileSync(path.join(h, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2) + '\n');
  if (marketplaces) fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), JSON.stringify(marketplaces, null, 2));
  return h;
}
const line = msgs => msgs.find(m => /auto-update/.test(m));
const settingsOf = h => path.join(h, 'settings.json');
const read = f => fs.readFileSync(f, 'utf8');
function withEnv(name, value, fn) {
  const old = process.env[name];
  process.env[name] = value;
  try { return fn(); } finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
}

test('switches it on once: settings.json gains the entry; the line is MESSAGE; a second run leaves the file alone', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const l = line(setup.machineMessages(h));
  assert.equal(l, autoupdate.MESSAGE);
  const obj = JSON.parse(read(settingsOf(h)));
  assert.deepEqual(obj.extraKnownMarketplaces['jspark-forge'], { source: SOURCE, autoUpdate: true });
  assert.deepEqual(obj.statusLine, { type: 'command', command: 'mine' });
  const bytes = read(settingsOf(h));
  assert.equal(line(setup.machineMessages(h)), undefined);
  assert.equal(read(settingsOf(h)), bytes);
  assert.equal(autoupdate.state(h), 'on');
});

test('the message is exact', () => {
  assert.equal(autoupdate.MESSAGE, 'JSPARK Forge switched on its own auto-update; new versions load when Claude Code starts. Undo: /plugin → Marketplaces → jspark-forge.');
});

test('existing entry without autoUpdate: only autoUpdate is added, source untouched', () => {
  const own = { source: { source: 'github', repo: 'someone/else' } };
  const h = home({ 'jspark-forge': FROM_GITHUB }, { extraKnownMarketplaces: { 'jspark-forge': own, other: { source: { source: 'github', repo: 'a/b' } } } });
  assert.ok(line(setup.machineMessages(h)));
  const mk = JSON.parse(read(settingsOf(h))).extraKnownMarketplaces;
  assert.deepEqual(mk['jspark-forge'], { source: own.source, autoUpdate: true });
  assert.deepEqual(mk.other, { source: { source: 'github', repo: 'a/b' } });
});

for (const v of [true, false]) {
  test(`never when the settings entry already has autoUpdate: ${v}`, () => {
    const h = home({ 'jspark-forge': FROM_GITHUB }, { extraKnownMarketplaces: { 'jspark-forge': { source: SOURCE, autoUpdate: v } } });
    const bytes = read(settingsOf(h));
    assert.equal(line(setup.machineMessages(h)), undefined);
    assert.equal(read(settingsOf(h)), bytes);
    assert.equal(autoupdate.state(h), v ? 'on' : 'off');
  });
}

test('never when known_marketplaces says autoUpdate:false; nothing to do when it says true', () => {
  const off = home({ 'jspark-forge': Object.assign({ autoUpdate: false }, FROM_GITHUB) });
  const bytes = read(settingsOf(off));
  assert.equal(line(setup.machineMessages(off)), undefined);
  assert.equal(read(settingsOf(off)), bytes);
  assert.equal(autoupdate.state(off), 'off');
  const on = home({ 'jspark-forge': Object.assign({ autoUpdate: true }, FROM_GITHUB) });
  const bytes2 = read(settingsOf(on));
  assert.equal(line(setup.machineMessages(on)), undefined);
  assert.equal(read(settingsOf(on)), bytes2);
  assert.equal(autoupdate.state(on), 'on');
});

test('state: the settings entry wins over known_marketplaces when they differ', () => {
  const h = home({ 'jspark-forge': Object.assign({ autoUpdate: true }, FROM_GITHUB) }, { extraKnownMarketplaces: { 'jspark-forge': { source: SOURCE, autoUpdate: false } } });
  assert.equal(autoupdate.state(h), 'off');
});

test('never when settings.json is not valid JSON: file untouched, no line, no flag', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB }, '{ not json');
  assert.equal(line(setup.machineMessages(h)), undefined);
  assert.equal(read(settingsOf(h)), '{ not json');
  const stateFile = path.join(h, 'jspark-forge', 'state.json');
  const st = fs.existsSync(stateFile) ? JSON.parse(read(stateFile)) : {};
  assert.equal(st.autoUpdateSet, undefined);
  fs.writeFileSync(settingsOf(h), '{}\n');
  assert.ok(line(setup.machineMessages(h)), 'switched on once the file is fixed');
});

test('not from the marketplace: nothing, no flag; switched on later once the marketplace is added', () => {
  const h = home({ 'claude-plugins-official': { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } } });
  const bytes = read(settingsOf(h));
  assert.equal(line(setup.machineMessages(h)), undefined);
  assert.equal(read(settingsOf(h)), bytes);
  assert.equal(autoupdate.state(h), 'not-from-marketplace');
  fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'jspark-forge': FROM_GITHUB }));
  assert.ok(line(setup.machineMessages(h)));
});

test('no marketplace file, or an unreadable one: nothing and no error', () => {
  assert.equal(line(setup.machineMessages(home())), undefined);
  const h = home();
  fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), '{not json');
  assert.equal(line(setup.machineMessages(h)), undefined);
});

test('keeps every other key, tab indent, and a missing final newline', () => {
  const start = { theme: 'dark', permissions: { allow: ['Bash(ls)'] }, extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'a/b' } } } };
  const h = home({ 'jspark-forge': FROM_GITHUB }, JSON.stringify(start, null, '\t'));
  assert.ok(line(setup.machineMessages(h)));
  const expected = JSON.parse(JSON.stringify(start));
  expected.extraKnownMarketplaces['jspark-forge'] = { source: SOURCE, autoUpdate: true };
  assert.equal(read(settingsOf(h)), JSON.stringify(expected, null, '\t'));
});

test('a missing settings.json is created with 2-space indent and a final newline', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB }, null);
  assert.ok(line(setup.machineMessages(h)));
  assert.equal(read(settingsOf(h)), JSON.stringify({ extraKnownMarketplaces: { 'jspark-forge': { source: SOURCE, autoUpdate: true } } }, null, 2) + '\n');
});

test('a UTF-8 BOM file: left alone', () => {
  const text = String.fromCharCode(0xFEFF) + '{ "theme": "dark" }\n';
  const h = home({ 'jspark-forge': FROM_GITHUB }, text);
  assert.equal(line(setup.machineMessages(h)), undefined);
  assert.equal(read(settingsOf(h)), text);
});

test('JSPARK_FORGE_AUTO_SETUP=off: nothing', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const bytes = read(settingsOf(h));
  withEnv('JSPARK_FORGE_AUTO_SETUP', 'off', () => assert.equal(line(setup.machineMessages(h)), undefined));
  assert.equal(read(settingsOf(h)), bytes);
});

test('known_marketplaces.json is never changed', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const file = path.join(h, 'plugins', 'known_marketplaces.json');
  const before = read(file);
  setup.machineMessages(h);
  assert.equal(read(file), before);
});

test('two runs at the same time write one valid file', async () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const code = `require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'lib', 'setup.js'))}).machineMessages(${JSON.stringify(h)})`;
  const run = () => new Promise(res => spawn(process.execPath, ['-e', code], { stdio: 'ignore' }).on('exit', res));
  await Promise.all([run(), run()]);
  const obj = JSON.parse(read(settingsOf(h)));
  assert.deepEqual(obj.extraKnownMarketplaces['jspark-forge'], { source: SOURCE, autoUpdate: true });
  assert.equal(JSON.parse(read(path.join(h, 'jspark-forge', 'state.json'))).autoUpdateSet, true);
  assert.equal(obj.statusLine.command, 'mine');
});
