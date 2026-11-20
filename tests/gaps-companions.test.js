'use strict';
// v0.5.1 gaps, item 10 (spec 793-794): the doctor's UI companions line names each installed companion's version when
// installed_plugins.json records one. The file's shape is not documented, so it is read defensively.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const companions = require('../scripts/lib/companions');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
const cfg = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gc-cfg-'));
const writeIn = (home, rel, text) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); };
const plugins = (home, obj) => writeIn(home, 'plugins/installed_plugins.json', obj);
const E = (version, extra = {}) => Object.assign({ scope: 'user', installPath: 'x', version, installedAt: 'a', lastUpdated: 'b', gitCommitSha: 'c' }, extra);
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gc-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
const doctor = (dir, home) => spawnSync(process.execPath, [FORGE, 'doctor'], { cwd: dir, encoding: 'utf8', timeout: 120000,
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home, JSPARK_FORGE_CODE_MAP: '', JSPARK_FORGE_PLAYWRIGHT: '', JSPARK_FORGE_NODE_MAJOR: '20' }) }).stdout;

test('versionOf: reads the version of the entry named <name>@<marketplace>, and nothing else', () => {
  const home = cfg();
  plugins(home, { version: 2, plugins: { 'frontend-design@claude-plugins-official': [E('1.4.0')], 'chrome-devtools-mcp@claude-plugins-official': [E('0.9.1', { auto: true })] } });
  assert.equal(companions.versionOf(home, 'frontend-design'), '1.4.0');
  assert.equal(companions.versionOf(home, 'chrome-devtools-mcp'), '0.9.1');
  assert.equal(companions.versionOf(home, 'frontend'), null, 'a name is not a prefix match');
});

test('versionOf: defensive about every other shape', () => {
  const home = cfg();
  for (const body of [
    '', 'not json', '[]', 'null', '{}', '{"plugins":[]}', '{"plugins":{"frontend-design@m":"1.0"}}',
    '{"plugins":{"frontend-design@m":[]}}', '{"plugins":{"frontend-design@m":[null,{"version":5}]}}',
    '{"plugins":{"frontend-design@m":[{"version":"1.0\\nx; rm"}]}}', '{"plugins":{"frontend-design@m":[{"version":"' + 'v'.repeat(80) + '"}]}}',
  ]) {
    plugins(home, body);
    assert.equal(companions.versionOf(home, 'frontend-design'), null, body.slice(0, 40));
  }
  assert.equal(companions.versionOf(path.join(home, 'nope'), 'frontend-design'), null);
  plugins(home, { frontend: 1, 'frontend-design@m': [E('2.0.0')] }); // a flat map of name -> entries
  assert.equal(companions.versionOf(home, 'frontend-design'), '2.0.0');
  plugins(home, { plugins: { 'frontend-design@m': [E('1.0.0'), E('1.1.0')] } });
  assert.equal(companions.versionOf(home, 'frontend-design'), '1.1.0', 'the last entry is the newest');
});

test('doctor: the companions line names the versions that are recorded', () => {
  const dir = project();
  let home = cfg();
  plugins(home, { plugins: { 'frontend-design@claude-plugins-official': [E('1.4.0')], 'chrome-devtools-mcp@claude-plugins-official': [E('0.9.1')] } });
  assert.match(doctor(dir, home), /^ok\s+UI companions: frontend-design 1\.4\.0 and chrome-devtools-mcp 0\.9\.1 installed$/m);
  home = cfg();
  plugins(home, { plugins: { 'frontend-design@claude-plugins-official': [E('1.4.0')], 'chrome-devtools-mcp@claude-plugins-official': [{}] } });
  assert.match(doctor(dir, home), /^ok\s+UI companions: frontend-design 1\.4\.0 and chrome-devtools-mcp installed$/m, 'one without a recorded version');
  home = cfg();
  plugins(home, { plugins: { 'frontend-design@claude-plugins-official': [{}], 'chrome-devtools-mcp@claude-plugins-official': [{}] } });
  assert.match(doctor(dir, home), /^ok\s+UI companions: frontend-design and chrome-devtools-mcp installed$/m, 'none recorded: as before');
});
