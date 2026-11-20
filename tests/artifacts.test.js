'use strict';
// Spec principle 9 (owner 2026-11-03, asked for again 2026-11-20 after an account switch): local-first,
// account-independent. A published Artifact is only a view; its page is kept as a file in the project, listed in
// .jspark-forge/artifacts.md, so a change of account or a cleared temp folder loses nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-art-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
function hook(dir, event, input = {}) {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 's1', cwd: dir, hook_event_name: event }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, JSPARK_FORGE_AUTO_STATUSLINE: 'off', JSPARK_FORGE_AUTO_SETUP: 'off' }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const ctx = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';
const scratchPage = (name, title) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-art-scratch-'));
  const f = path.join(d, name);
  fs.writeFileSync(f, `<!doctype html><html><head><title>${title}</title></head><body>hello</body></html>`);
  return f;
};
const publish = (dir, file, url = 'https://claude.ai/code/artifact/1b4e28ba-2fa1-11d2-883f-0016d3cca427') =>
  hook(dir, 'PostToolUse', { tool_name: 'Artifact', tool_input: { file_path: file, icon: 'chart' }, tool_response: { content: `Published to ${url} (private).` } });
const list = dir => fs.readFileSync(path.join(dir, '.jspark-forge', 'artifacts.md'), 'utf8');

test('a published page from a temp folder is copied into the project and listed with its link', () => {
  const dir = project();
  const src = scratchPage('launch-plan.html', 'Launch Plan');
  const o = publish(dir, src);
  const copy = path.join(dir, '.jspark-forge', 'artifacts', 'launch-plan.html');
  assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(src, 'utf8'));
  const text = list(dir);
  assert.match(text, /Launch Plan/);
  assert.match(text, /\.jspark-forge\/artifacts\/launch-plan\.html/);
  assert.match(text, /https:\/\/claude\.ai\/code\/artifact\/1b4e28ba-2fa1-11d2-883f-0016d3cca427/);
  assert.match(text, /\d{4}-\d{2}-\d{2}/);
  assert.match(ctx(o), /local copy/);
  assert.match(ctx(o), /\.jspark-forge\/artifacts\/launch-plan\.html/, 'Claude is told the path, to pass on to the user');
});

test('publishing the same page again updates the copy and keeps one line in the list', () => {
  const dir = project();
  const src = scratchPage('plan.html', 'Plan');
  publish(dir, src);
  fs.writeFileSync(src, '<html><head><title>Plan</title></head><body>second version</body></html>');
  publish(dir, src);
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', 'artifacts', 'plan.html'), 'utf8'), /second version/);
  assert.equal((list(dir).match(/plan\.html/g) || []).length, 1);
});

test('a page that already lives in the project is listed where it is, not copied', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'spec.html'), '<html><head><title>Spec</title></head></html>');
  publish(dir, path.join(dir, 'docs', 'spec.html'));
  assert.match(list(dir), /docs\/spec\.html/);
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'artifacts', 'spec.html')));
});

test('reading, listing or deleting an artifact records nothing', () => {
  const dir = project();
  hook(dir, 'PostToolUse', { tool_name: 'Artifact', tool_input: { action: 'read', url: 'https://claude.ai/artifact/abc' }, tool_response: {} });
  hook(dir, 'PostToolUse', { tool_name: 'Artifact', tool_input: { action: 'list' }, tool_response: {} });
  assert.ok(!fs.existsSync(path.join(dir, '.jspark-forge', 'artifacts.md')));
});

test('a listed page whose local file has gone is flagged at session start', () => {
  const dir = project();
  const src = scratchPage('gone.html', 'Gone');
  publish(dir, src);
  assert.equal(((hook(dir, 'SessionStart', { source: 'startup' }) || {}).systemMessage || '').includes('no local copy'), false);
  fs.unlinkSync(path.join(dir, '.jspark-forge', 'artifacts', 'gone.html'));
  const msg = (hook(dir, 'SessionStart', { source: 'startup' }) || {}).systemMessage || '';
  assert.match(msg, /Gone/);
  assert.match(msg, /no local copy/);
});

test('every session start tells Claude to keep a local file of anything it publishes or shows', () => {
  assert.match(ctx(hook(project(), 'SessionStart', { source: 'startup' })), /JSPARK Forge local-first rule:/);
});

test('the PostToolUse hook is registered for the Artifact tool', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.match(hooks.PostToolUse[0].matcher, /(^|\|)Artifact(\||$)/);
});
