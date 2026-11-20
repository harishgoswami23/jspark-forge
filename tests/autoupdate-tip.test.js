'use strict';
// v0.4.2: Claude Code does not auto-update plugins from third-party marketplaces by default, and a marketplace cannot
// switch it on for its users (Claude Code docs, plugins: "Keep plugins updated"; host-marketplace: "marketplace.json
// has no field to turn it on"). So once per machine, when JSPARK Forge came from its marketplace and auto-update is
// off, one line says how to turn it on. Claude Code's own files are only read, never written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const setup = require('../scripts/lib/setup');

function home(marketplaces) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-autoup-'));
  fs.mkdirSync(path.join(h, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(h, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  if (marketplaces) fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), JSON.stringify(marketplaces, null, 2));
  return h;
}
const FROM_GITHUB = { source: { source: 'github', repo: 'harishgoswami23/jspark-forge' }, lastUpdated: '2026-11-20T00:00:00.000Z' };
const tipIn = msgs => msgs.find(m => /auto-update/.test(m));

test('auto-update off for the jspark-forge marketplace: the tip says once how to turn it on', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const tip = tipIn(setup.machineMessages(h));
  assert.ok(tip, 'the tip is shown');
  assert.match(tip, /\/plugin/);
  assert.match(tip, /Marketplaces/);
  assert.match(tip, /jspark-forge/);
  assert.match(tip, /auto-update/);
  assert.equal(tipIn(setup.machineMessages(h)), undefined, 'once per machine');
});

test('auto-update already on: no tip', () => {
  const h = home({ 'jspark-forge': Object.assign({ autoUpdate: true }, FROM_GITHUB) });
  assert.equal(tipIn(setup.machineMessages(h)), undefined);
});

test('not installed from the marketplace (a local copy): no tip, and it still comes once the marketplace is added', () => {
  const h = home({ 'claude-plugins-official': { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } } });
  assert.equal(tipIn(setup.machineMessages(h)), undefined);
  fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'jspark-forge': FROM_GITHUB }));
  assert.ok(tipIn(setup.machineMessages(h)), 'shown after the marketplace is added');
});

test('no marketplace file, or an unreadable one: no tip and no error', () => {
  assert.equal(tipIn(setup.machineMessages(home())), undefined);
  const h = home();
  fs.writeFileSync(path.join(h, 'plugins', 'known_marketplaces.json'), '{not json');
  assert.equal(tipIn(setup.machineMessages(h)), undefined);
});

test('Claude Code\'s marketplace file is only read, never changed', () => {
  const h = home({ 'jspark-forge': FROM_GITHUB });
  const file = path.join(h, 'plugins', 'known_marketplaces.json');
  const before = fs.readFileSync(file, 'utf8');
  setup.machineMessages(h);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
