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
