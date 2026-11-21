'use strict';
// v0.5.1 (owner 2026-11-20): after signing in again in the middle of a session (a change of account), Claude Code
// warns on every turn that it cannot use thinking from another organization. A hook cannot see which account is signed
// in, but Claude Code sends a notification when a sign-in completes (hooks reference, Notification: auth_success). On
// it JSPARK Forge saves the handoff at once and says how to carry on cleanly. Not proven yet that /login sends it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-signin-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  return dir;
}
function hook(dir, event, input = {}) {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 's1', cwd: dir, hook_event_name: event }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, JSPARK_FORGE_AUTO_STATUSLINE: 'off', JSPARK_FORGE_AUTO_SETUP: 'off' }) });
  return { out: r.stdout ? JSON.parse(r.stdout) : null, status: r.status };
}
const logText = dir => { const d = path.join(dir, '.jspark-forge', 'log'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };

test('a sign-in during a session with work: the handoff is saved at once and the user is told how to carry on', () => {
  const dir = project();
  hook(dir, 'UserPromptSubmit', { prompt: 'add the invoice chart export to the reports page' });
  hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'x.ts') } });
  const r = hook(dir, 'Notification', { notification_type: 'auth_success', message: 'Authentication completes' });
  assert.equal(r.status, 0);
  assert.match(r.out.systemMessage, /You signed in again/);
  assert.match(r.out.systemMessage, /start a new session .* say "resume"/);
  assert.match(fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8'), /saved because: sign-in/);
  assert.match(logText(dir), /SIGNIN/);
});

test('a sign-in with no work to resume, or another kind of notification: nothing is said and nothing is saved', () => {
  const dir = project();
  assert.equal(hook(dir, 'Notification', { notification_type: 'auth_success' }).out, null);
  hook(dir, 'UserPromptSubmit', { prompt: 'add the invoice chart export to the reports page' });
  hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'x.ts') } });
  const before = fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8');
  assert.equal(hook(dir, 'Notification', { notification_type: 'permission_prompt', message: 'x' }).out, null);
  assert.equal(hook(dir, 'Notification', { notification_type: 'idle_prompt' }).out, null);
  assert.equal(fs.readFileSync(path.join(dir, '.jspark-forge', 'handoff.md'), 'utf8'), before);
});

test('the Notification hook is registered for sign-in only, in exec form with a short limit', () => {
  const n = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.Notification;
  assert.equal(n.length, 1);
  assert.equal(n[0].matcher, 'auth_success');
  const h = n[0].hooks[0];
  assert.equal(h.command, 'node');
  assert.deepEqual(h.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/forge.js', 'Notification']);
  assert.ok(h.timeout <= 10);
});
