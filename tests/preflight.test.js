'use strict';
// v0.7 gate checks (before: lines): read one line's value, check a list of them on this machine, and say in plain words
// what is missing. Fixed checks only: nothing from the file is ever run, and no text goes to a shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parse, check, failures, describe, realProbes } = require('../scripts/lib/preflight');

test('parse reads memory in GB and MB, any case, extra spaces, one decimal for GB', () => {
  assert.deepEqual(parse('free memory 4 GB'), { kind: 'memory', mb: 4096 });
  assert.deepEqual(parse('FREE   MEMORY  500   mb'), { kind: 'memory', mb: 500 });
  assert.deepEqual(parse('free memory 1.5 GB'), { kind: 'memory', mb: 1536 });
  assert.deepEqual(parse('Free Memory 300 MB'), { kind: 'memory', mb: 300 });
});

test('parse refuses bad memory values with a plain sentence', () => {
  for (const v of ['free memory 0 GB', 'free memory -4 GB', 'free memory abc GB', 'free memory 1.25 GB',
    'free memory 2000000 MB', 'free memory 4 TB', 'free memory 4', 'free memory 1.5 MB']) {
    const r = parse(v);
    assert.equal(typeof r.error, 'string', v);
    assert.ok(r.error.length > 10, v);
    assert.equal(r.kind, undefined, v);
  }
  assert.match(parse('free memory 0 GB').error, /more than 0/);
});

test('parse reads ports open and free', () => {
  assert.deepEqual(parse('port 5432 open'), { kind: 'port', port: 5432, want: 'open' });
  assert.deepEqual(parse('PORT  3000   Free'), { kind: 'port', port: 3000, want: 'free' });
  assert.deepEqual(parse('port 65535 open'), { kind: 'port', port: 65535, want: 'open' });
  assert.deepEqual(parse('port 1 free'), { kind: 'port', port: 1, want: 'free' });
});

test('parse refuses bad ports', () => {
  for (const v of ['port 0 open', 'port 65536 open', 'port 80.5 open', 'port abc open', 'port -1 free', 'port 80 closed',
    'port 80']) {
    const r = parse(v);
    assert.equal(typeof r.error, 'string', v);
  }
  assert.match(parse('port 70000 open').error, /whole number from 1 to 65535/);
});

test('parse reads container names', () => {
  assert.deepEqual(parse('container opsvision-db running'), { kind: 'container', name: 'opsvision-db' });
  assert.deepEqual(parse('CONTAINER  My_db.1  RUNNING'), { kind: 'container', name: 'My_db.1' });
  assert.deepEqual(parse('container a running'), { kind: 'container', name: 'a' });
  const n63 = 'a'.repeat(63);
  assert.deepEqual(parse(`container ${n63} running`), { kind: 'container', name: n63 });
});

test('parse refuses hostile container names', () => {
  const bad = ['db; rm -rf /', '$(whoami)', 'my db', 'a'.repeat(64), '', '--help', '-x', 'db&&x', 'db|x', '`id`', '_x', '.x'];
  for (const name of bad) {
    const r = parse(`container ${name} running`);
    assert.equal(typeof r.error, 'string', JSON.stringify(name));
    assert.equal(r.kind, undefined, JSON.stringify(name));
  }
  assert.match(parse('container -x running').error, /name/);
});

test('parse gives the list of allowed forms for anything else', () => {
  const want = 'a "before:" line must be one of: free memory <n> GB|MB; port <n> open|free; container <name> running';
  for (const v of ['', 'hello', 'disk 5 GB', 'run rm -rf /', 'memory 4 GB']) assert.deepEqual(parse(v), { error: want }, v);
});

test('check words for memory', () => {
  const p = mb => ({ freeMb: () => mb });
  const need4 = { kind: 'memory', mb: 4096 };
  assert.deepEqual(check([need4], p(6349)), [{ ok: true, text: 'free memory is 6.2 GB (needs 4 GB)' }]);
  assert.deepEqual(check([need4], p(2150)), [{ ok: false, text: 'free memory is 2.1 GB, needs 4 GB' }]);
  assert.deepEqual(check([{ kind: 'memory', mb: 500 }], p(300)), [{ ok: false, text: 'free memory is 300 MB, needs 500 MB' }]);
  assert.deepEqual(check([{ kind: 'memory', mb: 500 }], p(900)), [{ ok: true, text: 'free memory is 900 MB (needs 500 MB)' }]);
  assert.equal(check([{ kind: 'memory', mb: 1536 }], p(1000))[0].text, 'free memory is 1.0 GB, needs 1.5 GB');
  assert.equal(check([need4], p(4096))[0].ok, true);
});

test('check words for ports', () => {
  const open = { kind: 'port', port: 5432, want: 'open' };
  const free = { kind: 'port', port: 3000, want: 'free' };
  const probe = v => ({ portOpen: () => v });
  assert.deepEqual(check([open], probe(true)), [{ ok: true, text: 'port 5432 is open' }]);
  assert.deepEqual(check([open], probe(false)), [{ ok: false, text: 'nothing is listening on port 5432' }]);
  assert.deepEqual(check([open], probe(null)), [{ ok: false, text: 'could not check port 5432' }]);
  assert.deepEqual(check([free], probe(false)), [{ ok: true, text: 'port 3000 is free' }]);
  assert.deepEqual(check([free], probe(true)), [{ ok: false, text: 'port 3000 is already in use' }]);
  assert.deepEqual(check([free], probe(null)), [{ ok: false, text: 'could not check port 3000' }]);
});

test('check words for containers', () => {
  const c = { kind: 'container', name: 'opsvision-db' };
  const probe = v => ({ containerRunning: () => v });
  assert.deepEqual(check([c], probe(true)), [{ ok: true, text: 'container opsvision-db is running' }]);
  assert.deepEqual(check([c], probe(false)), [{ ok: false, text: 'container opsvision-db is not running' }]);
  assert.deepEqual(check([c], probe(null)),
    [{ ok: false, text: 'could not check container opsvision-db (docker did not answer)' }]);
});

test('check keeps the order, treats a throwing probe as could not tell, and flags unknown kinds', () => {
  const items = [
    { kind: 'port', port: 1, want: 'open' },
    { kind: 'memory', mb: 100 },
    { kind: 'container', name: 'x' },
    { kind: 'weird' },
    { kind: 'port', port: 2, want: 'free' },
  ];
  const r = check(items, {
    freeMb: () => { throw new Error('boom'); },
    portOpen: port => { if (port === 1) throw new Error('boom'); return false; },
    containerRunning: () => true,
  });
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], { ok: false, text: 'could not check port 1' });
  assert.equal(r[1].ok, false);
  assert.match(r[1].text, /could not/);
  assert.deepEqual(r[2], { ok: true, text: 'container x is running' });
  assert.deepEqual(r[3], { ok: false, text: 'unknown check' });
  assert.deepEqual(r[4], { ok: true, text: 'port 2 is free' });
});

test('check never throws on odd input', () => {
  assert.deepEqual(check([], {}), []);
  assert.doesNotThrow(() => check([null, undefined, 5], {}));
  assert.deepEqual(check([null], {}), [{ ok: false, text: 'unknown check' }]);
});

test('failures lists only what is not met, in order', () => {
  const r = [{ ok: true, text: 'a' }, { ok: false, text: 'b' }, { ok: true, text: 'c' }, { ok: false, text: 'd' }];
  assert.deepEqual(failures(r), ['b', 'd']);
  assert.deepEqual(failures([{ ok: true, text: 'a' }]), []);
  assert.deepEqual(failures([]), []);
});

test('describe writes the line the way a person would', () => {
  const lines = ['free memory 4 GB', 'free memory 1.5 GB', 'free memory 500 MB', 'port 5432 open', 'port 3000 free',
    'container db running'];
  for (const l of lines) assert.equal(describe(parse(l)), l);
  assert.equal(describe(parse('FREE MEMORY  2   gb')), 'free memory 2 GB');
  assert.equal(describe(parse('PORT 80 FREE')), 'port 80 free');
});

test('the real memory probe gives a positive whole number', () => {
  const mb = realProbes.freeMb();
  assert.ok(Number.isInteger(mb) && mb > 0);
});

test('the real port probe sees a listener in another process, then sees it gone', async () => {
  const child = spawn(process.execPath, ['-e',
    "const s=require('net').createServer(c=>c.end()).listen(0,'127.0.0.1',()=>console.log(s.address().port))"]);
  let exited = false;
  const gone = new Promise(res => child.on('exit', () => { exited = true; res(); }));
  let port;
  try {
    port = await new Promise((res, rej) => {
      child.stdout.once('data', d => res(Number(String(d).trim())));
      child.once('error', rej);
    });
    assert.ok(port > 0);
    assert.equal(realProbes.portOpen(port), true);
  } finally {
    child.kill();
    if (!exited) await gone;
  }
  assert.notEqual(realProbes.portOpen(port), true);
});

test('the real container probe refuses a hostile name without starting anything', () => {
  for (const name of ['db; rm -rf /', '$(whoami)', 'a b', '--help', '-x', '', 'a'.repeat(64)]) {
    const t = Date.now();
    assert.equal(realProbes.containerRunning(name), null, JSON.stringify(name));
    assert.ok(Date.now() - t < 500, 'must return fast');
  }
});

test('the real container probe answers true, false or null for a good name', () => {
  assert.ok([true, false, null].includes(realProbes.containerRunning('jspark-no-such-container')));
});

test('the module never hands a string to a shell', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'preflight.js'), 'utf8');
  assert.ok(!src.includes('shell: true'));
  assert.ok(!src.includes('exec('));
  assert.ok(!src.includes('execSync('));
});
