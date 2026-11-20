'use strict';
// v0.5.1 crash recovery, Part D: what Claude was saying when it was cut off (the tail of the session transcript).
// The transcript is JSON lines. Shape seen on this machine (structure only): a line has `type`; `type: "assistant"` lines
// carry message.role "assistant" and message.content, a list of blocks ({type:"thinking"}, {type:"text",text},
// {type:"tool_use",id,name,input}), one block per line; `type: "user"` lines carry tool results as
// {type:"tool_result",tool_use_id,content}; many other line types exist (mode, attachment, api-request-blob ...).
// The tests use small made-up transcripts of that shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const transcript = require('../scripts/lib/transcript');
const fx = require('./helpers/crashfix');
const { A, repo, start, ctxOf, died, readSessionFile, run } = fx;

const asText = text => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const asTool = (id, name, input) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const asThink = () => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'x' }] } });
const result = (id) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const userText = text => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const write = (lines, tail = '\n') => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tr-')), 'session.jsonl'); fs.writeFileSync(f, lines.join('\n') + tail); return f; };

test('the last assistant text is returned, cut to its last 60 words', () => {
  const long = Array.from({ length: 100 }, (_, i) => `w${i + 1}`).join(' ');
  const f = write([userText('go on with the report'), asText('an early thing'), asThink(), asText(long), asThink()]);
  const s = transcript.summary(f);
  const words = s.lastWords.replace(/^…\s*/, '').split(' ');
  assert.equal(words.length, 60);
  assert.equal(words[0], 'w41');
  assert.equal(words[59], 'w100');
  assert.match(s.lastWords, /^…/);
});

test('a short last text is returned whole, without the cut mark', () => {
  const f = write([asText('Running the tests now.')]);
  assert.equal(transcript.summary(f).lastWords, 'Running the tests now.');
});

test('a tool call with no result at the end of the tail is reported; one with a result is not', () => {
  const open = write([asText('I will build it.'), asTool('t1', 'Bash', { command: 'npm run build', description: 'Build it' })]);
  const s = transcript.summary(open);
  assert.match(s.lastTool, /Bash/);
  assert.match(s.lastTool, /npm run build/);
  assert.equal(s.lastWords, 'I will build it.');
  const done = write([asTool('t1', 'Bash', { command: 'npm run build' }), result('t1'), asText('Built.')]);
  assert.equal(transcript.summary(done).lastTool, null);
});

test('a file tool call and an agent call are described by their path or type', () => {
  assert.match(transcript.summary(write([asTool('t2', 'Write', { file_path: 'src/a.js', content: 'secret body' })])).lastTool, /Write.*src\/a\.js/);
  assert.doesNotMatch(transcript.summary(write([asTool('t2', 'Write', { file_path: 'src/a.js', content: 'secret body' })])).lastTool, /secret body/);
  assert.match(transcript.summary(write([asTool('t3', 'Agent', { subagent_type: 'jspark-forge:builder', prompt: 'long' })])).lastTool, /jspark-forge:builder/);
});

test('lines that do not parse, a cut last line, other line types and helper (sidechain) lines are skipped', () => {
  const f = write([
    '{not json', asText('Real words here.'),
    JSON.stringify({ type: 'api-request-blob', message: { role: 'assistant', content: [{ type: 'text', text: 'WRONG blob text' }] } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'WRONG helper text' }] } }),
    JSON.stringify({ type: 'mode', mode: 'x' }), 'null', '[]', '"str"',
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'string content' } }),
    JSON.stringify({ type: 'assistant', message: null }),
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cut off half'], '');
  const s = transcript.summary(f);
  assert.equal(s.lastWords, 'Real words here.');
});

test('an empty, missing or unreadable transcript gives nothing and never throws', () => {
  assert.deepEqual(transcript.summary(write([], '')), { lastWords: null, lastTool: null });
  assert.deepEqual(transcript.summary(path.join(os.tmpdir(), 'no-such-dir', 'x.jsonl')), { lastWords: null, lastTool: null });
  assert.deepEqual(transcript.summary(undefined), { lastWords: null, lastTool: null });
  assert.deepEqual(transcript.summary(os.tmpdir()), { lastWords: null, lastTool: null });
  assert.deepEqual(transcript.summary(write(['\0\0\0\0'])), { lastWords: null, lastTool: null });
});

test('only the last 256 KB are read: a big transcript is never loaded whole', () => {
  const filler = asTool('f', 'Bash', { command: 'x'.repeat(2000) });
  const lines = [asText('EARLY words only at the start')];
  for (let i = 0; i < 300; i++) lines.push(filler, result('f'));
  lines.push(asText('Late words at the end.'));
  const f = write(lines);
  assert.ok(fs.statSync(f).size > 600 * 1024);
  const realRead = fs.readSync; let bytes = 0;
  fs.readSync = (fd, buf, ...rest) => { const n = realRead(fd, buf, ...rest); bytes += n; return n; };
  let s; try { s = transcript.summary(f); } finally { fs.readSync = realRead; }
  assert.equal(s.lastWords, 'Late words at the end.');
  assert.ok(bytes <= 256 * 1024, `read ${bytes} bytes`);
  // and when the only text is before the tail, there are no words rather than a wrong one
  const g = write([asText('EARLY words only at the start'), ...Array.from({ length: 300 }, () => asTool('f', 'Bash', { command: 'x'.repeat(2000) }))]);
  assert.equal(transcript.summary(g).lastWords, null);
});

test('words and commands are redacted like log lines', () => {
  const f = write([asText('I set the key sk-abcdefghijkl123456 and Bearer abcdefghijklmnopqrstuv in the header'), asTool('t', 'Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"' })]);
  const s = transcript.summary(f);
  assert.doesNotMatch(s.lastWords, /sk-abcdefghijkl|abcdefghijklmnopqrstuv/);
  assert.doesNotMatch(s.lastTool, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(s.lastWords + s.lastTool, /redacted/);
});

test('transcript_path is stored in the session file at SessionStart and UserPromptSubmit, when it changes', () => {
  const dir = repo();
  const t1 = path.join(os.tmpdir(), 'one.jsonl'), t2 = path.join(os.tmpdir(), 'two.jsonl');
  run(dir, 'SessionStart', { source: 'startup', transcript_path: t1 }, A);
  assert.equal(readSessionFile(dir).transcriptPath, t1);
  const f = fx.stateFile(dir, `session-${A}.json`);
  const before = fs.statSync(f).mtimeMs;
  run(dir, 'UserPromptSubmit', { prompt: 'a first real request to do something useful', transcript_path: t1 }, A);
  assert.equal(readSessionFile(dir).transcriptPath, t1);
  run(dir, 'UserPromptSubmit', { prompt: 'a second real request to do something else', transcript_path: t2 }, A);
  assert.equal(readSessionFile(dir).transcriptPath, t2);
  assert.ok(fs.statSync(f).mtimeMs >= before);
});

test('the crash check shows Claude\'s last words and the unfinished tool call from that session\'s transcript', () => {
  const dir = repo();
  const f = write([userText('build it'), asText('I am about to run the build and then the tests.'), asTool('t9', 'Bash', { command: 'npm run build:all', description: 'Build everything' })]);
  died(dir, { transcriptPath: f, inflight: [{ tool: 'Bash', what: 'Build everything :: npm run build:all' }], log: [[250, 'BASH', 'Build everything :: npm run build:all']] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /Claude's last words before the cutoff: "I am about to run the build and then the tests\."/);
  assert.match(ctx, /The last tool call it had started: Bash[^\n]*npm run build:all/);
  assert.ok(ctx.indexOf("Claude's last words") < ctx.indexOf('Before you continue:'));
});

test('a missing transcript file leaves the rest of the crash check intact', () => {
  const dir = repo();
  died(dir, { transcriptPath: path.join(os.tmpdir(), 'gone', 'x.jsonl'), inflight: [{ tool: 'Bash', what: 'npm test' }] });
  const ctx = ctxOf(start(dir));
  assert.match(ctx, /crash check/);
  assert.doesNotMatch(ctx, /last words/);
});

test('a transcript path that is not a .jsonl file is not read', () => {
  const dir = repo();
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tr-')), 'notes.txt');
  fs.writeFileSync(other, asText('do not read me'));
  died(dir, { transcriptPath: other, inflight: [{ tool: 'Bash', what: 'npm test' }] });
  assert.doesNotMatch(ctxOf(start(dir)), /do not read me/);
});
