'use strict';
// v0.2.1 database guard (spec 5.2c): MCP tool calls, the "database dev:" relaxation (the user's own rules.md only),
// reads never blocked, and the CONFIRM db-write flow through the PreToolUse hook. Bash and PowerShell client forms
// are in tests/blocklist.test.js and tests/blocklist-ps.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { check } = require('../scripts/lib/blocklist');
const { loadRules, parseRules } = require('../scripts/lib/rules');

const PROJECT = os.tmpdir();
const mcp = (tool, input) => ({ tool_name: tool, tool_input: input, cwd: PROJECT });
const rulesWith = dbDev => ({ confirm: [], never: [], disabled: [], readonly: [], settings: {}, dbDev });
const ctx = (rules = null) => ({ projectDir: PROJECT, home: os.homedir(), rules, branchOf: () => 'x' });
const id = (input, rules) => { const r = check(input, ctx(rules)); return r ? r.id : null; };

const SUPA = 'mcp__claude_ai_Supabase__';
const WRITES = [
  mcp(`${SUPA}apply_migration`, { project_id: 'p', name: 'add_x', query: 'create table x (id int)' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'UPDATE users SET admin = true WHERE id = 1' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'select 1; insert into t values (1)' }),
  mcp(`${SUPA}merge_branch`, { branch_id: 'b' }),
  mcp(`${SUPA}reset_branch`, { branch_id: 'b' }),
  mcp(`${SUPA}restore_project`, { project_id: 'p' }),
  mcp('mcp__postgres__query', { sql: 'INSERT INTO t VALUES (1)' }),
  mcp('mcp__plugin_db_mysql__execute', { query: 'ALTER TABLE t ADD c int' }),
  mcp('mcp__mongodb__insert-many', { database: 'app', collection: 'users', documents: [{ a: 1 }] }),
];
const READS = [
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'SELECT * FROM users' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'WITH x AS (SELECT 1 a) SELECT a FROM x' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'EXPLAIN SELECT * FROM users' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'show server_version' }),
  mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'select 1; select 2' }),
  mcp(`${SUPA}list_tables`, { project_id: 'p' }),
  mcp(`${SUPA}list_migrations`, { project_id: 'p' }),
  mcp(`${SUPA}get_project`, { id: 'p' }),
  mcp('mcp__postgres__query', { sql: 'describe users' }),
  mcp('mcp__mongodb__find', { database: 'app', collection: 'users' }),
  mcp('mcp__github__create_issue', { title: 'x', body: 'we should insert into the users table and update users set a = 1' }),
  mcp('mcp__slack__post_message', { text: 'ship the plan, then update users set a = 1' }),
];

test('MCP: writes to a database MCP server are held for CONFIRM db-write', () => {
  for (const w of WRITES) assert.equal(id(w), 'db-write', `${w.tool_name} ${JSON.stringify(w.tool_input)}`);
});

test('MCP: reads and other servers are never blocked', () => {
  for (const r of READS) assert.equal(id(r), null, `${r.tool_name} ${JSON.stringify(r.tool_input)}`);
});

test('MCP: a write is a confirm, not a hard deny, and the reason names the confirm', () => {
  const r = check(WRITES[0], ctx());
  assert.equal(r.hard, false);
  assert.match(r.reason, /CONFIRM db-write/);
  assert.match(r.reason, /Do not try an equivalent command; tell the user and stop\./);
});

test('MCP: sql-destroy stays as it is (DROP, TRUNCATE, DELETE without WHERE)', () => {
  assert.equal(id(mcp('mcp__postgres__query', { sql: 'DROP TABLE x' })), 'sql-destroy');
  assert.equal(id(mcp('mcp__db__execute', { query: 'delete from audit' })), 'sql-destroy');
  const all = check(mcp('mcp__postgres__query', { sql: 'DROP TABLE x' }), ctx(), { all: true }).map(h => h.id);
  assert.deepEqual(all, ['sql-destroy'], 'sql-destroy covers db-write: one CONFIRM');
});

test('dev line: a write passes for the server it names, and only that server', () => {
  const rules = rulesWith(['Supabase']);
  assert.equal(id(WRITES[0], rules), null);
  assert.equal(id(WRITES[3], rules), null);
  assert.equal(id(mcp('mcp__postgres__query', { sql: 'INSERT INTO t VALUES (1)' }), rules), 'db-write');
});

test('dev line: a glob works, a host pattern works for clients, and sql-destroy still applies', () => {
  assert.equal(id(mcp('mcp__pg_local__query', { sql: 'insert into t values (1)' }), rulesWith(['pg_*'])), null);
  const psql = c => ({ tool_name: 'Bash', tool_input: { command: c }, cwd: PROJECT });
  assert.equal(id(psql('psql -h dev.db.example.com -c "insert into t values (1)"'), rulesWith(['*.db.example.com'])), null);
  assert.equal(id(psql('psql -h prod.example.com -c "insert into t values (1)"'), rulesWith(['*.db.example.com'])), 'db-write');
  assert.equal(id(mcp('mcp__postgres__query', { sql: 'DROP TABLE x' }), rulesWith(['postgres'])), 'sql-destroy');
});

test('parseRules reads "database dev:" lines under Settings', () => {
  const r = parseRules('## Settings\n- database dev: Supabase\n- database dev: *.dev.example.com, staging-db\n- notes: off\n');
  assert.deepEqual(r.dbDev, ['Supabase', '*.dev.example.com', 'staging-db']);
  assert.deepEqual(r.errors, []);
});

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');
function setup({ repoRules, userRules } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-db-'));
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  if (repoRules) fs.writeFileSync(path.join(dir, '.jspark-forge', 'rules.md'), repoRules);
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-db-cfg-'));
  if (userRules) { fs.mkdirSync(path.join(cfg, 'jspark-forge')); fs.writeFileSync(path.join(cfg, 'jspark-forge', 'rules.md'), userRules); }
  return { dir, cfg };
}
const hook = (s, event, input) => {
  const r = spawnSync(process.execPath, [FORGE, event], { encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: 'db-1', cwd: s.dir }, input)),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: s.dir, CLAUDE_CONFIG_DIR: s.cfg }) });
  return r.stdout ? JSON.parse(r.stdout) : null;
};
const decision = o => (o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision) || null;

test('trust: a repo "database dev:" line is ignored and reported; the user file honours it', () => {
  const line = '## Settings\n- database dev: Supabase\n';
  const repo = setup({ repoRules: line });
  assert.deepEqual(loadRules(repo.dir, { claudeHome: repo.cfg }).dbDev, []);
  assert.equal(decision(hook(repo, 'PreToolUse', WRITES[1])), 'deny');
  const msg = hook(repo, 'SessionStart', { source: 'startup' }).systemMessage;
  assert.match(msg, /\.jspark-forge\/rules\.md line 2.*cannot mark a database as dev/);
  assert.match(msg, /~\/\.claude\/jspark-forge\/rules\.md/);

  const user = setup({ userRules: line });
  assert.deepEqual(loadRules(user.dir, { claudeHome: user.cfg }).dbDev, ['Supabase']);
  assert.equal(decision(hook(user, 'PreToolUse', WRITES[1])), null);
});

test('trust: a repo dev line does not weaken a user file, and the user file still applies alongside a repo file', () => {
  const s = setup({ repoRules: '## Settings\n- database dev: postgres\n', userRules: '## Settings\n- database dev: Supabase\n' });
  assert.deepEqual(loadRules(s.dir, { claudeHome: s.cfg }).dbDev, ['Supabase']);
  assert.equal(decision(hook(s, 'PreToolUse', mcp('mcp__postgres__query', { sql: 'insert into t values (1)' }))), 'deny');
});

test('hook: deny, then CONFIRM db-write turns it into a one-time ask', () => {
  const s = setup();
  const w = WRITES[1];
  const first = hook(s, 'PreToolUse', w);
  assert.equal(decision(first), 'deny');
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /CONFIRM db-write/);
  hook(s, 'UserPromptSubmit', { prompt: 'CONFIRM db-write' });
  assert.equal(decision(hook(s, 'PreToolUse', w)), 'ask');
  assert.equal(decision(hook(s, 'PreToolUse', w)), 'deny', 'one-shot');
});

test('hook: a Bash psql write is held and confirmed the same way; a SELECT passes untouched', () => {
  const s = setup();
  const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(decision(hook(s, 'PreToolUse', bash('psql -h prod.example.com -c "select count(*) from users"'))), null);
  assert.equal(decision(hook(s, 'PreToolUse', bash('psql -h prod.example.com -c "update users set a = 1 where id = 2"'))), 'deny');
  hook(s, 'UserPromptSubmit', { prompt: 'CONFIRM db-write' });
  assert.equal(decision(hook(s, 'PreToolUse', bash('psql -h prod.example.com -c "update users set a = 1 where id = 2"'))), 'ask');
});

test('a destructive statement on a production database needs one CONFIRM, not two (sql-destroy covers it)', () => {
  const all = input => check(input, ctx(), { all: true }).map(h => h.id);
  assert.deepEqual(all(mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'DROP TABLE users' })), ['sql-destroy']);
  assert.deepEqual(all({ tool_name: 'Bash', tool_input: { command: 'psql -h db.example.com -c "TRUNCATE orders"' }, cwd: PROJECT }), ['sql-destroy']);
  assert.deepEqual(all(mcp(`${SUPA}execute_sql`, { project_id: 'p', query: 'UPDATE t SET a = 1 WHERE id = 2' })), ['db-write']);
});
