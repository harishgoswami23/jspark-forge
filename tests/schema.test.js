'use strict';
// v0.3 design 1.3: the database layout read from migration files (never the live database), and `forge.js schema`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const schema = require('../scripts/lib/schema');

const FORGE = path.join(__dirname, '..', 'scripts', 'forge.js');

function mk(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-schema-'));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return dir;
}
// One migration file with this SQL in migrations/; returns the one root.
const one = sql => schema.read(mk({ 'migrations/001_init.sql': sql })).roots[0];
const tbl = (root, name) => root.tables.find(t => t.name.toLowerCase() === name.toLowerCase());
const col = (root, t, c) => tbl(root, t).columns.find(x => x.name.toLowerCase() === c.toLowerCase());
const names = (root, t) => tbl(root, t).columns.map(c => c.name);

test('create: columns with type, NOT NULL, DEFAULT, inline PRIMARY KEY, and file:line', () => {
  const r = one('CREATE TABLE users (\n  id integer PRIMARY KEY,\n  email varchar(255) NOT NULL,\n  active boolean NOT NULL DEFAULT true,\n  note text\n);\n');
  const t = tbl(r, 'users');
  assert.equal(t.file, 'migrations/001_init.sql');
  assert.equal(t.line, 1);
  assert.deepEqual(names(r, 'users'), ['id', 'email', 'active', 'note']);
  assert.equal(col(r, 'users', 'id').pk, true);
  assert.equal(col(r, 'users', 'id').notNull, true);
  assert.equal(col(r, 'users', 'email').type, 'varchar(255)');
  assert.equal(col(r, 'users', 'email').notNull, true);
  assert.equal(col(r, 'users', 'active').default, 'true');
  assert.equal(col(r, 'users', 'note').notNull, false);
  assert.equal(col(r, 'users', 'note').line, 5);
  assert.equal(col(r, 'users', 'note').file, 'migrations/001_init.sql');
  assert.equal(t.uncertain, false);
});

test('create: a table-level composite PRIMARY KEY marks its columns', () => {
  const r = one('CREATE TABLE member (org_id int, user_id int, role text, PRIMARY KEY (org_id, user_id));');
  assert.equal(col(r, 'member', 'org_id').pk, true);
  assert.equal(col(r, 'member', 'user_id').pk, true);
  assert.equal(col(r, 'member', 'role').pk, false);
});

test('foreign keys: inline REFERENCES', () => {
  const r = one('CREATE TABLE orders (\n id int PRIMARY KEY,\n user_id int NOT NULL REFERENCES users (id) ON DELETE CASCADE\n);');
  const fk = tbl(r, 'orders').fks[0];
  assert.deepEqual(fk.columns, ['user_id']);
  assert.equal(fk.refTable, 'users');
  assert.deepEqual(fk.refColumns, ['id']);
  assert.equal(fk.line, 3);
  assert.equal(col(r, 'orders', 'user_id').notNull, true);
});

test('foreign keys: table-level FOREIGN KEY, with and without CONSTRAINT name', () => {
  const r = one('CREATE TABLE line (a int, b int, CONSTRAINT fk_a FOREIGN KEY (a) REFERENCES t1(id), FOREIGN KEY (b) REFERENCES t2 (id));');
  const fks = tbl(r, 'line').fks;
  assert.equal(fks.length, 2);
  assert.equal(fks[0].name, 'fk_a');
  assert.equal(fks[0].refTable, 't1');
  assert.equal(fks[1].refTable, 't2');
});

test('foreign keys: ALTER TABLE ADD CONSTRAINT FOREIGN KEY', () => {
  const r = one('CREATE TABLE a (id int, b_id int);\nALTER TABLE a ADD CONSTRAINT a_b FOREIGN KEY (b_id) REFERENCES b (id);');
  const fk = tbl(r, 'a').fks[0];
  assert.equal(fk.name, 'a_b');
  assert.deepEqual(fk.columns, ['b_id']);
  assert.equal(fk.line, 2);
  assert.equal(tbl(r, 'a').uncertain, false);
});

test('alter: ADD COLUMN (with and without the word COLUMN, IF NOT EXISTS) keeps its own line', () => {
  const r = one('CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN x text NOT NULL DEFAULT \'n\';\nALTER TABLE a ADD y int;\nALTER TABLE a ADD COLUMN IF NOT EXISTS z int;');
  assert.deepEqual(names(r, 'a'), ['id', 'x', 'y', 'z']);
  assert.equal(col(r, 'a', 'x').line, 2);
  assert.equal(col(r, 'a', 'x').default, "'n'");
  assert.equal(col(r, 'a', 'z').line, 4);
});

test('alter: several actions in one statement', () => {
  const r = one('CREATE TABLE a (id int, old int);\nALTER TABLE a ADD COLUMN p int, DROP COLUMN old, ADD COLUMN q int;');
  assert.deepEqual(names(r, 'a'), ['id', 'p', 'q']);
});

test('alter: DROP COLUMN removes the column and any foreign key on it', () => {
  const r = one('CREATE TABLE a (id int, b_id int REFERENCES b(id));\nALTER TABLE a DROP COLUMN b_id;');
  assert.deepEqual(names(r, 'a'), ['id']);
  assert.equal(tbl(r, 'a').fks.length, 0);
  assert.equal(tbl(r, 'a').uncertain, false);
});

test('alter: RENAME COLUMN follows the column, its key and its foreign key', () => {
  const r = one('CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b(id));\nALTER TABLE a RENAME COLUMN b_id TO parent_id;\nALTER TABLE a RENAME id TO a_id;');
  assert.deepEqual(names(r, 'a'), ['a_id', 'parent_id']);
  assert.equal(col(r, 'a', 'a_id').pk, true);
  assert.deepEqual(tbl(r, 'a').fks[0].columns, ['parent_id']);
});

test('alter: ALTER COLUMN type, NOT NULL and DEFAULT (Postgres)', () => {
  const r = one('CREATE TABLE a (n int, m text DEFAULT \'x\');\nALTER TABLE a ALTER COLUMN n TYPE bigint;\nALTER TABLE a ALTER COLUMN n SET NOT NULL;\nALTER TABLE a ALTER COLUMN m DROP DEFAULT;');
  assert.equal(col(r, 'a', 'n').type, 'bigint');
  assert.equal(col(r, 'a', 'n').notNull, true);
  assert.equal(col(r, 'a', 'm').default, null);
});

test('rename table: ALTER TABLE RENAME TO updates foreign keys that point at it', () => {
  const r = one('CREATE TABLE person (id int PRIMARY KEY);\nCREATE TABLE pet (owner int REFERENCES person(id));\nALTER TABLE person RENAME TO human;');
  assert.equal(tbl(r, 'person'), undefined);
  assert.ok(tbl(r, 'human'));
  assert.equal(tbl(r, 'pet').fks[0].refTable, 'human');
  assert.equal(tbl(r, 'human').line, 1);
});

test('rename table: MySQL RENAME TABLE a TO b, c TO d', () => {
  const r = one('CREATE TABLE a (x int);\nCREATE TABLE c (y int);\nRENAME TABLE a TO b, c TO d;');
  assert.deepEqual(r.tables.map(t => t.name).sort(), ['b', 'd']);
});

test('drop table: removes it; IF EXISTS on a missing table is fine', () => {
  const r = one('CREATE TABLE a (x int);\nCREATE TABLE b (x int);\nDROP TABLE a;\nDROP TABLE IF EXISTS nothing, b CASCADE;');
  assert.equal(r.tables.length, 0);
  assert.equal(r.unknown, 0);
});

test('quoted identifiers: "x", `x` and [x] keep their spelling and spaces', () => {
  const r = one('CREATE TABLE "Order Items" ("Item Id" int PRIMARY KEY);\nCREATE TABLE `mysql_t` (`a b` int);\nCREATE TABLE [dbo].[Mssql T] ([col one] int, tags text[]);');
  assert.deepEqual(names(r, 'Order Items'), ['Item Id']);
  assert.deepEqual(names(r, 'mysql_t'), ['a b']);
  assert.deepEqual(names(r, 'Mssql T'), ['col one', 'tags']);
  assert.equal(col(r, 'Mssql T', 'tags').type, 'text[]');
});

test('schema-qualified names: public.users is users, in create, alter, references and drop', () => {
  const r = one('CREATE TABLE public.users (id int PRIMARY KEY);\nCREATE TABLE "public"."posts" (u int REFERENCES public.users(id));\nALTER TABLE ONLY public.users ADD COLUMN n text;\nDROP TABLE public.posts;');
  assert.deepEqual(r.tables.map(t => t.name), ['users']);
  assert.deepEqual(names(r, 'users'), ['id', 'n']);
});

test('Postgres forms: serial, timestamptz, arrays, numeric(10, 2), casts and function defaults', () => {
  const r = one("CREATE TABLE IF NOT EXISTS pg (\n id bigserial PRIMARY KEY,\n at timestamp with time zone NOT NULL DEFAULT now(),\n price numeric(10, 2) DEFAULT 0.00,\n tags text[] DEFAULT '{}'::text[],\n uid uuid DEFAULT gen_random_uuid()\n);");
  assert.equal(col(r, 'pg', 'at').type, 'timestamp with time zone');
  assert.equal(col(r, 'pg', 'at').default, 'now()');
  assert.equal(col(r, 'pg', 'price').type, 'numeric(10, 2)');
  assert.equal(col(r, 'pg', 'tags').default, "'{}'::text[]");
  assert.equal(col(r, 'pg', 'uid').default, 'gen_random_uuid()');
});

test('MySQL forms: backticks, AUTO_INCREMENT, unsigned, KEY lines, ENGINE tail, MODIFY and CHANGE', () => {
  const r = one('CREATE TABLE `t` (\n `id` int unsigned NOT NULL AUTO_INCREMENT,\n `name` varchar(50) NOT NULL,\n `p` int,\n PRIMARY KEY (`id`),\n KEY `idx_name` (`name`),\n UNIQUE KEY `u` (`name`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nALTER TABLE `t` MODIFY COLUMN `name` varchar(100) NULL;\nALTER TABLE `t` CHANGE `p` `q` bigint NOT NULL;');
  assert.deepEqual(names(r, 't'), ['id', 'name', 'q']);
  assert.equal(col(r, 't', 'id').type, 'int unsigned');
  assert.equal(col(r, 't', 'id').pk, true);
  assert.equal(col(r, 't', 'name').type, 'varchar(100)');
  assert.equal(col(r, 't', 'name').notNull, false);
  assert.equal(col(r, 't', 'q').type, 'bigint');
  assert.equal(tbl(r, 't').uncertain, false);
});

test('SQLite forms: AUTOINCREMENT, columns without a type, WITHOUT ROWID', () => {
  const r = one('CREATE TABLE s (id INTEGER PRIMARY KEY AUTOINCREMENT, data, n INT NOT NULL);\nCREATE TABLE w (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;');
  assert.equal(col(r, 's', 'id').pk, true);
  assert.equal(col(r, 's', 'data').type, '');
  assert.deepEqual(names(r, 'w'), ['k', 'v']);
  assert.equal(tbl(r, 's').uncertain, false);
});

test('comments with semicolons do not split statements; line numbers stay right after them', () => {
  const r = one('-- first; second; third\n/* block; with ; semicolons\n   over lines */\nCREATE TABLE a (\n  id int, -- an id; really\n  /* x; */ n int\n);\nCREATE TABLE b (id int);');
  assert.equal(r.unknown, 0);
  assert.deepEqual(r.tables.map(t => t.name).sort(), ['a', 'b']);
  assert.equal(tbl(r, 'a').line, 4);
  assert.equal(col(r, 'a', 'n').line, 6);
  assert.equal(tbl(r, 'b').line, 8);
});

test('string literals with semicolons, doubled quotes and comment marks do not split or hide statements', () => {
  const r = one("INSERT INTO t VALUES ('a;b', 'it''s; -- not a comment');\nCREATE TABLE c (id int DEFAULT 0, label text DEFAULT 'x;y');");
  assert.ok(tbl(r, 'c'));
  assert.equal(col(r, 'c', 'label').default, "'x;y'");
  assert.equal(r.unknown, 0);
});

test('$$ function bodies with semicolons are one statement and are not read as tables', () => {
  const r = one('CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  DROP TABLE a;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\nCREATE TABLE a (id int);');
  assert.ok(tbl(r, 'a'));
  assert.equal(r.unknown, 0);
  assert.equal(tbl(r, 'a').line, 7);
});

test('$tag$ bodies are skipped the same way, including ones with a $$ inside', () => {
  const r = one('DO $body$ BEGIN EXECUTE $$ DROP TABLE a; $$; END $body$;\nCREATE TABLE a (id int);');
  assert.ok(tbl(r, 'a'));
});

test('down migrations: *.down.sql is skipped', () => {
  const dir = mk({ 'migrations/001_a.up.sql': 'CREATE TABLE a (id int);', 'migrations/001_a.down.sql': 'DROP TABLE a;' });
  const r = schema.read(dir).roots[0];
  assert.ok(tbl(r, 'a'));
  assert.equal(r.files.length, 1);
});

test('down migrations: files under a down folder are skipped', () => {
  const dir = mk({ 'db/migrations/001_a.sql': 'CREATE TABLE a (id int);', 'db/migrations/down/001_a.sql': 'DROP TABLE a;' });
  const r = schema.read(dir).roots[0];
  assert.ok(tbl(r, 'a'));
});

test('down migrations: goose and dbmate sections are skipped, and up sections after them are read', () => {
  const goose = one('-- +goose Up\nCREATE TABLE a (id int);\n-- +goose Down\nDROP TABLE a;\n-- +goose Up\nCREATE TABLE b (id int);');
  assert.deepEqual(goose.tables.map(t => t.name).sort(), ['a', 'b']);
  const dbmate = one('-- migrate:up\nCREATE TABLE a (id int);\n\n-- migrate:down\nDROP TABLE a;\n');
  assert.deepEqual(dbmate.tables.map(t => t.name), ['a']);
});

test('numeric order: V10__ comes after V2__, 0010_ after 0002_', () => {
  const dir = mk({
    'migrations/V10__c.sql': 'ALTER TABLE a ADD c int;', 'migrations/V2__b.sql': 'ALTER TABLE a ADD b int;', 'migrations/V1__a.sql': 'CREATE TABLE a (id int);' });
  const r = schema.read(dir).roots[0];
  assert.deepEqual(r.files, ['migrations/V1__a.sql', 'migrations/V2__b.sql', 'migrations/V10__c.sql']);
  assert.deepEqual(names(r, 'a'), ['id', 'b', 'c']);
  const dir2 = mk({ 'migrations/0010_x.sql': 'ALTER TABLE a ADD x int;', 'migrations/0002_y.sql': 'ALTER TABLE a ADD y int;', 'migrations/0001_a.sql': 'CREATE TABLE a (id int);' });
  assert.deepEqual(names(schema.read(dir2).roots[0], 'a'), ['id', 'y', 'x']);
});

test('numeric order: timestamps and folder names (Prisma) sort in time order', () => {
  const dir = mk({
    'prisma/migrations/20240102000000_b/migration.sql': 'ALTER TABLE a ADD b int;',
    'prisma/migrations/20231230235959_a/migration.sql': 'CREATE TABLE a (id int);',
    'prisma/migrations/migration_lock.toml': 'provider = "postgresql"' });
  const r = schema.read(dir).roots[0];
  assert.equal(r.root, 'prisma/migrations');
  assert.deepEqual(names(r, 'a'), ['id', 'b']);
  assert.equal(tbl(r, 'a').file, 'prisma/migrations/20231230235959_a/migration.sql');
});

test('two roots are read apart and never merged', () => {
  const dir = mk({ 'migrations/001.sql': 'CREATE TABLE a (id int);', 'supabase/migrations/20240101_x.sql': 'CREATE TABLE a (other int);\nCREATE TABLE s (id int);' });
  const { roots } = schema.read(dir);
  assert.deepEqual(roots.map(r => r.root), ['migrations', 'supabase/migrations']);
  assert.deepEqual(names(roots[0], 'a'), ['id']);
  assert.deepEqual(names(roots[1], 'a'), ['other']);
  assert.equal(tbl(roots[0], 's'), undefined);
});

test('an unreadable statement about a table marks that table uncertain, and only that table', () => {
  const r = one('CREATE TABLE a (id int);\nCREATE TABLE b (id int);\nALTER TABLE a FROBNICATE WIDELY;');
  assert.equal(tbl(r, 'a').uncertain, true);
  assert.equal(tbl(r, 'a').uncertainAt[0].line, 3);
  assert.equal(tbl(r, 'b').uncertain, false);
  assert.equal(r.unknown, 1);
});

test('uncertain: CREATE TABLE ... AS SELECT, LIKE, and a dropped column that was never there', () => {
  const r = one('CREATE TABLE a (id int);\nCREATE TABLE b AS SELECT * FROM a;\nCREATE TABLE c (LIKE a);\nALTER TABLE a DROP COLUMN ghost;');
  assert.equal(tbl(r, 'b').uncertain, true);
  assert.equal(tbl(r, 'c').uncertain, true);
  assert.equal(tbl(r, 'a').uncertain, true);
});

test('an ALTER on a table created outside these files gives an uncertain table with what is known', () => {
  const r = one('ALTER TABLE legacy ADD COLUMN extra int;');
  assert.equal(tbl(r, 'legacy').uncertain, true);
  assert.deepEqual(names(r, 'legacy'), ['extra']);
});

test('unknown statements are counted, never guessed; known non-table statements are not counted', () => {
  const r = one('CREATE TABLE a (id int);\nCREATE INDEX i ON a (id);\nINSERT INTO a VALUES (1);\nCREATE EXTENSION pgcrypto;\nGRANT ALL ON a TO bob;\nWIBBLE THE DATABASE;\nSET search_path = public;');
  assert.equal(r.unknown, 1);
  assert.equal(r.unknownAt[0].line, 6);
  assert.deepEqual(names(r, 'a'), ['id']);
  assert.equal(tbl(r, 'a').uncertain, false);
});

test('CREATE TABLE IF NOT EXISTS keeps the first definition; plain CREATE TABLE replaces', () => {
  const r = one('CREATE TABLE a (x int);\nCREATE TABLE IF NOT EXISTS a (y int);\nCREATE TABLE b (x int);\nCREATE TABLE b (z int);');
  assert.deepEqual(names(r, 'a'), ['x']);
  assert.deepEqual(names(r, 'b'), ['z']);
});

test('a root with only JavaScript, TypeScript or Python migrations says "no SQL migrations here"', () => {
  const dir = mk({ 'db/migrations/001_init.js': 'exports.up = () => {};', 'db/migrations/002_more.ts': 'export {}' });
  const r = schema.read(dir).roots[0];
  assert.equal(r.sql, false);
  assert.equal(r.note, 'no SQL migrations here');
  assert.equal(r.tables.length, 0);
  assert.match(schema.run(dir, []), /no SQL migrations here/);
});

test('no migration folder, or an empty one: no roots at all', () => {
  assert.deepEqual(schema.read(mk({ 'src/a.js': '' })).roots, []);
  assert.deepEqual(schema.read(mk({ 'migrations/.gitkeep': '' })).roots, []);
  assert.match(schema.run(mk({ 'src/a.js': '' }), []), /No migration folder/);
});

test('speed: 300 migration files read in under 200 ms (2 s on Windows)', () => {
  const files = {};
  for (let i = 1; i <= 300; i++) files[`migrations/${String(i).padStart(4, '0')}_m.sql`] = i === 1 ? 'CREATE TABLE a (id int);' : `ALTER TABLE a ADD COLUMN c${i} text NOT NULL DEFAULT 'x';\nCREATE TABLE t${i} (id int PRIMARY KEY, a_id int REFERENCES a (id));\n`;
  const dir = mk(files);
  let ms = Infinity;
  let r;
  for (let k = 0; k < 3; k++) { // best of three: other tests run at the same time
    const t0 = process.hrtime.bigint();
    r = schema.read(dir).roots[0];
    ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.equal(tbl(r, 'a').columns.length, 300);
  const limit = process.platform === 'win32' ? 2000 : 200; // Windows file opens cost ~0.6 ms each here (virus scanning); the parser itself is ~10 ms
  assert.ok(ms < limit, `took ${ms} ms`);
});

// ---- the command ----

function project(files) {
  const dir = mk(files);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}
const forge = (dir, ...args) => spawnSync(process.execPath, [FORGE, 'schema', ...args], { cwd: dir, encoding: 'utf8', timeout: 60000,
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir }) }).stdout;
const DECISIONS = '# Decisions\n\n## D-012 Prices are stored in cents\n- Kind: decision\n- Why: avoids rounding\n- Touches: migrations/**\n- Status: active\n\n## D-020 Unrelated\n- Kind: decision\n- Touches: src/**\n- Status: active\n\n## D-021 Retired one\n- Kind: decision\n- Touches: migrations/**\n- Status: retired\n';

test('forge.js schema: tables with columns, keys, foreign keys, file:line, "as of", and the decisions on each file', () => {
  const dir = project({
    'migrations/001_init.sql': 'CREATE TABLE users (\n  id integer PRIMARY KEY,\n  email text NOT NULL\n);\n',
    'migrations/002_orders.sql': 'CREATE TABLE orders (\n  id int PRIMARY KEY,\n  user_id int NOT NULL REFERENCES users (id)\n);\n',
    '.jspark-forge/decisions.md': DECISIONS });
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const out = forge(dir);
  assert.match(out, new RegExp(`as of ${sha}`));
  assert.match(out, /migrations\/001_init\.sql:1/);
  assert.match(out, /email\s+text\s+NOT NULL.*migrations\/001_init\.sql:3/);
  assert.match(out, /primary key/i);
  assert.match(out, /foreign key \(user_id\) -> users\(id\).*migrations\/002_orders\.sql:3/);
  assert.match(out, /migrations\/001_init\.sql: D-012 Prices are stored in cents/);
  assert.match(out, /migrations\/002_orders\.sql: D-012 Prices are stored in cents/);
  assert.doesNotMatch(out, /D-020/);
  assert.doesNotMatch(out, /D-021/);
  assert.doesNotMatch(out, /\bForge\b(?! )/);
});

test('forge.js schema <table>: one table only, case-insensitive; an unknown table lists the known ones', () => {
  const dir = project({ 'migrations/001.sql': 'CREATE TABLE users (id int);\nCREATE TABLE orders (id int);\n' });
  const one = forge(dir, 'Users');
  assert.match(one, /users/);
  assert.doesNotMatch(one, /orders/);
  const none = forge(dir, 'nope');
  assert.match(none, /No table named "nope"/);
  assert.match(none, /orders, users/);
});

test('forge.js schema: notes uncertain tables and unreadable statements, and a JS-only root', () => {
  const dir = project({
    'migrations/001.sql': 'CREATE TABLE a (id int);\nALTER TABLE a FROBNICATE;\nWIBBLE;\n',
    'db/migrations/001.js': 'module.exports = {};' });
  const out = forge(dir);
  assert.match(out, /a .*uncertain/i);
  assert.match(out, /2 statements[^\n]*not understood/);
  assert.match(out, /db\/migrations: no SQL migrations here/);
});

test('forge.js schema: read-only (nothing in the project changes) and no "as of" when git cannot answer', () => {
  const dir = mk({ 'migrations/001.sql': 'CREATE TABLE a (id int);\n' });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'state'), { recursive: true });
  require('../scripts/lib/paths').markOwn(dir);
  const snap = () => fs.readdirSync(dir, { recursive: true }).sort().map(n => `${n}:${fs.statSync(path.join(dir, n)).mtimeMs}`).join('\n');
  const before = snap();
  const out = forge(dir);
  assert.match(out, /a\b/);
  assert.doesNotMatch(out, /as of/);
  assert.equal(snap(), before);
});

test('skill: runs forge.js schema, never connects to a database', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'skills', 'schema', 'SKILL.md'), 'utf8');
  assert.match(t, /^description: Use when /m);
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/forge\.js" schema/);
  assert.match(t, /never connect/i);
});
