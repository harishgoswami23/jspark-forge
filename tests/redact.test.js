'use strict';
// Design section 6 "Redaction": likely secrets are replaced with ‹redacted› before anything is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, R } = require('../scripts/lib/redact');

const cases = [
  ['OpenAI/Anthropic-style key', 'curl -H "x-api-key: sk-ant-api03-AbCdEf1234567890xyz" https://x', 'sk-ant-api03-AbCdEf1234567890xyz'],
  ['GitHub classic token', 'git clone https://ghp_ABCDEFabcdef1234567890ABCDEFabcdef12@github.com/o/r', 'ghp_ABCDEFabcdef1234567890ABCDEFabcdef12'],
  ['GitHub fine-grained token', 'export GH=github_pat_11ABCDEFG0123456789_abcdefXYZ', 'github_pat_11ABCDEFG0123456789_abcdefXYZ'],
  ['AWS access key id', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['Slack bot token', 'SLACK=xoxb-1234-5678-abcdefghij', 'xoxb-1234-5678-abcdefghij'],
  ['Slack user token', 'xoxp-9999-8888-zyxwvu', 'xoxp-9999-8888-zyxwvu'],
  ['Bearer header', 'curl -H "Authorization: Bearer eyJhbGciOi.abc.def" x', 'eyJhbGciOi.abc.def'],
  ['password=', 'psql "host=db password=hunter2 user=me"', 'hunter2'],
  ['pwd=', 'connect pwd=s3cr3t;', 's3cr3t'],
  ['token=', 'https://api.example.com/?token=abc123def&x=1', 'abc123def'],
  ['mysql -p<password>', 'mysql -u root -pS3cretPass mydb', 'S3cretPass'],
];

for (const [name, input, secret] of cases) {
  test(`redacts ${name}`, () => {
    const out = redact(input);
    assert.ok(!out.includes(secret), `secret still present: ${out}`);
    assert.ok(out.includes(R), `no marker: ${out}`);
  });
}

test('keeps ordinary command text untouched', () => {
  const s = 'npm test -- save_chart && git commit -m "add chart model"';
  assert.equal(redact(s), s);
});

test('does not treat mysql -p without a value, or -port flags, as a password', () => {
  assert.equal(redact('mysql -u root -p mydb'), 'mysql -u root -p mydb');
  assert.equal(redact('node server.js --port 3000'), 'node server.js --port 3000');
});

test('redacts extra secret values given by the caller (values from .env files)', () => {
  const out = redact('curl -d "key=Zq9-long-value-77" https://x', ['Zq9-long-value-77']);
  assert.ok(!out.includes('Zq9-long-value-77'));
});

test('ignores very short extra values so ordinary words are not masked', () => {
  assert.equal(redact('echo yes', ['yes']), 'echo yes');
});

// ---- crash review S7: more secret shapes (best effort) ----
const more = [
  ['a password inside a URL', 'git clone https://deploy:Tr0ub4dor-and-3@git.example.com/org/repo.git', 'Tr0ub4dor-and-3'],
  ['a password inside a postgres URL', 'psql postgres://admin:s3cretP4ss@db.internal:5432/app', 's3cretP4ss'],
  ['a JWT', 'the cookie is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U ok', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
  ['"password is: X"', 'The database password is: Hunter2-Hunter2 and it works', 'Hunter2-Hunter2'],
  ['"password: X"', 'password: correct-horse-battery', 'correct-horse-battery'],
  ['"token: X"', 'token: abc123XYZ789', 'abc123XYZ789'],
  ['"pwd=X"', 'run with pwd=Zebra99', 'Zebra99'],
  ['a JSON password', '{"user":"me","password":"p4ssw0rd-json"}', 'p4ssw0rd-json'],
];
for (const [name, input, secret] of more) {
  test(`S7: redacts ${name}`, () => {
    const out = redact(input);
    assert.ok(!out.includes(secret), `secret still present: ${out}`);
    assert.ok(out.includes(R), `no marker: ${out}`);
  });
}

test('S7: the scheme, user and host of a URL with credentials are kept', () => {
  assert.equal(redact('https://deploy:Tr0ub4dor@git.example.com/x.git'), `https://deploy:${R}@git.example.com/x.git`);
});

test('S7: ordinary text with these words is not mangled beyond the value', () => {
  assert.equal(redact('see https://example.com/docs and the keyboard token economy'), 'see https://example.com/docs and the keyboard token economy');
  assert.equal(redact('ssh://git@host/repo.git'), 'ssh://git@host/repo.git', 'a user without a password stays');
});

test('S7: stripQuery removes the query string of any URL and leaves the rest', () => {
  const { stripQuery } = require('../scripts/lib/redact');
  assert.equal(stripQuery('curl "https://api.example.com/v1/items?id=42&sig=abc" -o out'), 'curl "https://api.example.com/v1/items" -o out');
  assert.equal(stripQuery('open http://localhost:3000/a?x=1#top now'), 'open http://localhost:3000/a#top now');
  assert.equal(stripQuery('no url here ? really'), 'no url here ? really');
});
