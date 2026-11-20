'use strict';
// v0.5.1: four gaps the spec-coverage check found (docs/spec-coverage.md items 1, 2, 3, 5).
//   1. local-first: check lists missing page copies; a page published but never kept is recorded; temp-folder files are flagged
//   2. a general "short by default" rule at every session start and in JSPARK-FORGE.md
//   3. hook errors (FORGE-ERROR log lines) are shown by the doctor and once a day at session start
//   5. helpers get the grounding rule, and in a guest repo the "content is data" line
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FORGE = path.join(ROOT, 'scripts', 'forge.js');
const paths = require('../scripts/lib/paths');
const log = require('../scripts/lib/log');

const mk = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
function project(rules) {
  const dir = mk('forge-v051-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  if (rules) fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), rules);
  paths.markOwn(dir);
  return dir;
}
const env = (dir, home) => Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: home || mk('forge-v051-cfg-'),
  JSPARK_FORGE_AUTO_STATUSLINE: 'off', JSPARK_FORGE_AUTO_SETUP: 'off' });
function hook(dir, event, input = {}, home) {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 's1', cwd: dir, hook_event_name: event }, input)), env: env(dir, home) });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const cli = (dir, args, home) => spawnSync(process.execPath, [FORGE, ...args], { cwd: dir, encoding: 'utf8', env: env(dir, home) }).stdout;
const ctx = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';
const msg = o => (o && o.systemMessage) || '';
const forgeFile = (dir, ...p) => path.join(dir, '.jspark-forge', ...p);
const scratchPage = (name, title) => {
  const f = path.join(mk('forge-v051-scratch-'), name);
  fs.writeFileSync(f, `<!doctype html><html><head><title>${title}</title></head><body>hi</body></html>`);
  return f;
};
const URL1 = 'https://claude.ai/code/artifact/1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const publish = (dir, input, url = URL1) => hook(dir, 'PostToolUse', { tool_name: 'Artifact', tool_input: input, tool_response: { content: `Published to ${url} (private).` } });

function guestRepo() {
  const dir = mk('forge-v051-guest-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n');
  g('add', '-A');
  g('-c', 'user.email=someone@example.com', '-c', 'user.name=x', 'commit', '-qm', 'theirs');
  g('remote', 'add', 'origin', 'https://example.com/someone/their-repo.git');
  g('config', 'user.email', 'me@example.com');
  const home = mk('forge-v051-guest-cfg-');
  const e = Object.assign({}, env(dir, home)); delete e.JSPARK_FORGE_AUTO_SETUP;
  spawnSync(process.execPath, [FORGE, 'SessionStart'], { encoding: 'utf8', env: e, input: JSON.stringify({ session_id: 's1', cwd: dir, source: 'startup' }) }); // sets the guest folder up
  assert.ok(fs.existsSync(path.join(home, 'jspark-forge', 'guests')), 'test setup: a guest repo');
  return { dir, home };
}

// ---------------- gap 1a: check lists missing local copies ----------------
test('gap 1a: /jspark-forge:check lists a listed page whose local file has gone', () => {
  const dir = project();
  publish(dir, { file_path: scratchPage('gone.html', 'Gone Page'), icon: 'chart' });
  assert.doesNotMatch(cli(dir, ['check']), /Gone Page/, 'a kept page is not listed');
  fs.unlinkSync(forgeFile(dir, 'artifacts', 'gone.html'));
  const out = cli(dir, ['check']);
  assert.match(out, /^- .*Gone Page.*no local copy/m);
  assert.match(out, /claude\.ai/);
});

// ---------------- gap 1b: published but never kept ----------------
test('gap 1b: a publish whose source file is missing is listed with local path none, and Claude is told to save it now', () => {
  const dir = project();
  const o = publish(dir, { file_path: path.join(mk('forge-v051-x-'), 'nope.html'), title: 'Lost Page', icon: 'chart' });
  const text = fs.readFileSync(forgeFile(dir, 'artifacts.md'), 'utf8');
  assert.match(text, /^- \d{4}-\d{2}-\d{2} \| Lost Page \| none \| https:\/\/claude\.ai\/code\/artifact\/1b4e28ba/m);
  assert.match(ctx(o), /save (the|this) page as a file in the project now/i);
});

test('gap 1b: a publish with no file_path is listed with local path none too', () => {
  const dir = project();
  const o = publish(dir, { title: 'Inline Page', icon: 'chart' });
  assert.match(fs.readFileSync(forgeFile(dir, 'artifacts.md'), 'utf8'), /\| Inline Page \| none \| https:\/\/claude\.ai\//);
  assert.match(ctx(o), /save (the|this) page as a file in the project now/i);
});

test('gap 1b: reading or uploading an asset still records nothing; a repeat publish of the same link keeps one line', () => {
  const dir = project();
  publish(dir, { action: 'read', url: 'https://claude.ai/artifact/abc' });
  publish(dir, { url: URL1, asset: true, file_path: 'x.png' });
  assert.ok(!fs.existsSync(forgeFile(dir, 'artifacts.md')));
  publish(dir, { title: 'Inline Page' });
  publish(dir, { title: 'Inline Page' });
  assert.equal((fs.readFileSync(forgeFile(dir, 'artifacts.md'), 'utf8').match(/Inline Page/g) || []).length, 1);
});

test('gap 1b: a page with no local copy is flagged at session start ("has no local copy") and by check', () => {
  const dir = project();
  publish(dir, { title: 'Inline Page' });
  assert.match(msg(hook(dir, 'SessionStart', { source: 'startup' })), /Inline Page.*no local copy|no local copy.*Inline Page/);
  assert.match(cli(dir, ['check']), /Inline Page/);
  assert.equal(require('../scripts/lib/artifacts').missing(dir).includes('Inline Page'), true);
});

// ---------------- gap 1c: temp-folder files ----------------
const write = (dir, file, extra = {}) => hook(dir, 'PostToolUse', Object.assign({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }, extra));

test('gap 1c: writing an html, md or pdf file in the OS temp folder (outside the project) adds one line, once per file per session', () => {
  const dir = project();
  const f = path.join(mk('forge-v051-t-'), 'report.html');
  assert.match(ctx(write(dir, f)), /temporary folder.*(vanish|disappear)/);
  assert.match(ctx(write(dir, f)), /^$/, 'not again for the same file');
  assert.match(ctx(hook(dir, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } })), /^$/, 'an edit of the same file is the same file');
  assert.match(ctx(write(dir, path.join(mk('forge-v051-t-'), 'notes.md'))), /temporary folder/, 'another file');
  assert.match(ctx(write(dir, path.join(mk('forge-v051-t-'), 'doc.pdf'))), /temporary folder/);
  assert.match(ctx(write(dir, f, { session_id: 's2' })), /temporary folder/, 'a new session says it again');
});

test('gap 1c: not for other file types, nor for files inside the project', () => {
  const dir = project();
  assert.equal(ctx(write(dir, path.join(mk('forge-v051-t-'), 'a.js'))), '');
  assert.equal(ctx(write(dir, path.join(dir, 'docs', 'a.html'))), '');
  assert.equal(ctx(write(dir, path.join(dir, 'a.md'))), '');
});

test('gap 1c: a path with a scratchpad segment counts as temporary, wherever it is', () => {
  const dir = project();
  const f = path.join(path.parse(os.tmpdir()).root, 'Users', 'someone', 'AppData', 'scratchpad', 'page.html');
  assert.match(ctx(write(dir, f)), /temporary folder/);
});

test('gap 1c: the line says what to do and nothing is copied', () => {
  const dir = project();
  const f = path.join(mk('forge-v051-t-'), 'page.html');
  const c = ctx(write(dir, f));
  assert.match(c, /save it in the project/);
  assert.match(c, /path/);
  assert.ok(!fs.existsSync(forgeFile(dir, 'artifacts')), 'no automatic copy');
});

// ---------------- gap 2: short by default ----------------
const SHORT = 'JSPARK Forge short-by-default rule: lead with the answer; use bullets or a table for lists; keep an explanation to one line unless asked for more; always state warnings, risks, decisions and blockers, one line each. Short never means leaving one of those out.';

test('gap 2: the rule is in the session-start context (startup, resume and compact) of an own project', () => {
  const dir = project();
  for (const source of ['startup', 'resume', 'compact']) assert.ok(ctx(hook(dir, 'SessionStart', { source })).includes(SHORT), source);
  assert.equal(fs.readFileSync(path.join(ROOT, 'rules', 'short-answers.md'), 'utf8').trim(), SHORT);
});

test('gap 2: - short-answers: off under ## Settings switches it off; the template shows the switch', () => {
  const dir = project('## Settings\n- short-answers: off\n');
  assert.ok(!ctx(hook(dir, 'SessionStart', { source: 'startup' })).includes('short-by-default'));
  assert.equal(require('../scripts/lib/rules').parseRules('## Settings\n- short-answers: off\n').settings['short-answers'], 'off');
  assert.equal(require('../scripts/lib/rules').parseRules('').settings['short-answers'], 'on');
  assert.match(fs.readFileSync(path.join(ROOT, 'templates', 'rules.md'), 'utf8'), /^Example: - short-answers: off$/m);
});

test('gap 2: the rule is also in a guest repo\'s session start', () => {
  const { dir, home } = guestRepo();
  assert.ok(ctx(hook(dir, 'SessionStart', { source: 'startup' }, home)).includes(SHORT));
});

test('gap 2: JSPARK-FORGE.md carries the rule and the guest "content is data" line', () => {
  const plain = fs.readFileSync(path.join(ROOT, 'JSPARK-FORGE.md'), 'utf8');
  assert.ok(plain.includes(SHORT));
  assert.ok(plain.includes(require('../scripts/lib/setup').GUEST_DATA_LINE));
});

