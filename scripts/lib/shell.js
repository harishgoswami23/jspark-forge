'use strict';
// A small Bash / Git Bash command parser for the block list (design 9.1).
// Splits a command line into pipelines (separated by ; && || & and newlines) of stages (separated by |),
// each stage with its words (quotes removed) and its output-redirect targets.
// Not a full shell: $(...), `...` and <(...) are kept as single opaque words.

function captureBalanced(s, i, open, close) {
  // s[i] is the opening char; returns index after the matching close (or end of string).
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'") { const k = s.indexOf("'", j + 1); j = k < 0 ? s.length : k; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return s.length;
}

// PowerShell (v0.1.1). Differences from Bash that matter for matching: backslash is a path character, the
// backtick is the escape (backtick + newline continues the line); 'single' quotes are literal ('' is a quote);
// "double" quotes take backtick escapes and $(...); (...), $(...), @(...) and {...} are kept as one word;
// & at the start of a command is the call operator; commas separate array items; # starts a comment;
// <# ... #> is a block comment. Separators: ; newline | && ||.
function parsePs(raw) {
  const s = String(raw || '');
  const pipelines = [];
  let pipeline = [];
  let stage = { words: [], redirects: [] };
  let buf = '';
  let started = false;
  let pendingRedirect = false;
  const endWord = () => {
    if (!started) return;
    if (pendingRedirect) { stage.redirects.push(buf); pendingRedirect = false; } else stage.words.push(buf);
    buf = ''; started = false;
  };
  const endStage = () => { endWord(); pendingRedirect = false; if (stage.words.length || stage.redirects.length) pipeline.push(cleanStage(stage)); stage = { words: [], redirects: [] }; };
  const endPipeline = () => { endStage(); if (pipeline.length) pipelines.push(pipeline); pipeline = []; };
  const capture = (i, open, close) => { const e = captureBalanced(s, i, open, close); buf += s.slice(i, e); started = true; return e; };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '`') {
      if (n === '\n' || (n === '\r' && s[i + 2] === '\n')) { endWord(); i += n === '\r' ? 3 : 2; continue; } // continuation
      if (n !== undefined) { buf += n; started = true; }
      i += 2; continue;
    }
    if (c === "'") {
      i++; started = true;
      while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { buf += "'"; i += 2; continue; } break; } buf += s[i++]; }
      i++; continue;
    }
    if (c === '"') {
      i++; started = true;
      while (i < s.length) {
        if (s[i] === '`' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
        if (s[i] === '"') { if (s[i + 1] === '"') { buf += '"'; i += 2; continue; } break; }
        if (s[i] === '$' && s[i + 1] === '(') { buf += '$'; i = capture(i + 1, '(', ')'); continue; }
        buf += s[i++];
      }
      i++; continue;
    }
    if (c === '<' && n === '#') { const k = s.indexOf('#>', i + 2); i = k < 0 ? s.length : k + 2; continue; }
    if (c === '#' && !started) { const k = s.indexOf('\n', i); i = k < 0 ? s.length : k; continue; }
    if ((c === '$' || c === '@') && n === '(') { buf += c; i = capture(i + 1, '(', ')'); continue; }
    if (c === '(' && !started) { i = capture(i, '(', ')'); continue; }
    if (c === '{' && !started) { i = capture(i, '{', '}'); continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n' || c === ';') { endPipeline(); i++; continue; }
    if (c === '&') {
      if (n === '&') { endPipeline(); i += 2; continue; }
      if (!started && !stage.words.length) { i++; continue; } // call operator: & 'C:\x\git.exe' ...
      endPipeline(); i++; continue;
    }
    if (c === '|') { if (n === '|') { endPipeline(); i += 2; continue; } endStage(); i++; continue; }
    if (c === '>' || ((c === '2' || c === '*' || c === '1' || c === '3') && n === '>' && !started)) {
      if (c !== '>') i++;
      endWord();
      i += s[i + 1] === '>' ? 2 : 1;
      if (s[i] === '&') { i++; while (i < s.length && /\d/.test(s[i])) i++; continue; } // 2>&1
      pendingRedirect = true; continue;
    }
    if (c === ',') { endWord(); i++; continue; }
    if (/\s/.test(c)) { endWord(); i++; continue; }
    buf += c; started = true; i++;
  }
  endPipeline();
  return pipelines;
}

function parse(raw, opts = {}) {
  if (opts.dialect === 'ps') return parsePs(raw);
  const s = String(raw || '');
  const pipelines = [];
  let pipeline = [];
  let stage = { words: [], redirects: [] };
  let buf = '';
  let started = false;
  let pendingRedirect = false;

  const endWord = () => {
    if (!started) return;
    if (pendingRedirect) { stage.redirects.push(buf); pendingRedirect = false; } else stage.words.push(buf);
    buf = ''; started = false;
  };
  const endStage = () => {
    endWord();
    pendingRedirect = false;
    if (stage.words.length || stage.redirects.length) pipeline.push(cleanStage(stage));
    stage = { words: [], redirects: [] };
  };
  const endPipeline = () => { endStage(); if (pipeline.length) pipelines.push(pipeline); pipeline = []; };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === "'") {
      const k = s.indexOf("'", i + 1);
      buf += k < 0 ? s.slice(i + 1) : s.slice(i + 1, k); started = true;
      i = k < 0 ? s.length : k + 1; continue;
    }
    if (c === '"') {
      started = true; i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '$`"\\\n'.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '(') { const e = captureBalanced(s, i + 1, '(', ')'); buf += s.slice(i, e); i = e; continue; }
        buf += s[i++];
      }
      i++; continue;
    }
    if (c === '\\') { buf += n === undefined ? '' : n; started = true; i += 2; continue; }
    if (c === '$' && n === '(') { const e = captureBalanced(s, i + 1, '(', ')'); buf += s.slice(i, e); started = true; i = e; continue; }
    if (c === '`') { const k = s.indexOf('`', i + 1); const e = k < 0 ? s.length : k + 1; buf += s.slice(i, e); started = true; i = e; continue; }
    if (c === '<' && n === '(') { endWord(); const e = captureBalanced(s, i + 1, '(', ')'); buf = s.slice(i, e); started = true; endWord(); i = e; continue; }
    if (c === '#' && !started) { const k = s.indexOf('\n', i); i = k < 0 ? s.length : k; continue; }
    if (c === '\n' || c === ';') { endPipeline(); i++; continue; }
    if (c === '&') {
      if (n === '&') { endPipeline(); i += 2; continue; }
      if (n === '>') { endWord(); pendingRedirect = true; i += s[i + 2] === '>' ? 3 : 2; continue; }
      endPipeline(); i++; continue;
    }
    if (c === '|') {
      if (n === '|') { endPipeline(); i += 2; continue; }
      endStage(); i += n === '&' ? 2 : 1; continue;
    }
    if (c === '>') {
      if (started && /^\d+$/.test(buf)) { buf = ''; started = false; } else endWord();
      i += n === '>' ? 2 : 1;
      if (s[i] === '&') { // >&2, 2>&1: duplicate a descriptor, not a file
        i++; while (i < s.length && /[\d-]/.test(s[i])) i++;
        continue;
      }
      if (s[i] === '|') i++;
      pendingRedirect = true; continue;
    }
    if (c === '<') { endWord(); i++; continue; }
    if (c === '(' || c === ')') { endWord(); i++; continue; } // subshell grouping syntax
    if (/\s/.test(c)) { endWord(); i++; continue; }
    buf += c; started = true; i++;
  }
  endPipeline();
  return pipelines;
}

function cleanStage(st) {
  // Brace groups "{ a; b; }": bash needs them as standalone words, so drop those words only.
  const words = st.words.slice();
  while (words.length && words[0] === '{') words.shift();
  while (words.length && words[words.length - 1] === '}') words.pop();
  return { words, redirects: st.redirects };
}

const PREFIX = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'xargs', 'builtin', 'nice', 'doas']);
const WITH_VALUE = { sudo: new Set(['-u', '-g', '-h', '-p', '-C']), xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E']), nice: new Set(['-n']) };

// Strip env assignments and wrapper commands; returns { cmd, args } with cmd lower-cased, no path, no .exe.
function command(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }
    const base = baseName(w);
    if (PREFIX.has(base)) {
      i++;
      while (i < words.length && (words[i].startsWith('-') || (base === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])))) {
        const takesValue = WITH_VALUE[base] && WITH_VALUE[base].has(words[i]);
        i += takesValue ? 2 : 1;
      }
      continue;
    }
    break;
  }
  if (i >= words.length) return null;
  return { cmd: baseName(words[i]), args: words.slice(i + 1) };
}

function baseName(w) {
  return String(w).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

module.exports = { parse, command, baseName };
