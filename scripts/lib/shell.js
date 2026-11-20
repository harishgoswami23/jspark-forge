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
  let stage = { words: [], redirects: [], subs: [] };
  let buf = '';
  let started = false;
  let pendingRedirect = false;
  const endWord = () => {
    if (!started) return;
    if (pendingRedirect) { stage.redirects.push(buf); pendingRedirect = false; } else stage.words.push(buf);
    buf = ''; started = false;
  };
  const endStage = () => { endWord(); pendingRedirect = false; if (stage.words.length || stage.redirects.length || stage.subs.length) pipeline.push(cleanStage(stage)); stage = { words: [], redirects: [], subs: [] }; };
  const endPipeline = () => { endStage(); if (pipeline.length) pipelines.push(pipeline); pipeline = []; };
  const capture = (i, open, close) => { const e = captureBalanced(s, i, open, close); buf += s.slice(i, e); started = true; return e; };
  // (...), $(...), @(...) and {...} run commands: their text is checked as commands too (stage.subs).
  const block = (i, open, close) => { const e = capture(i, open, close); stage.subs.push(s.slice(i + 1, s[e - 1] === close ? e - 1 : e)); return e; };
  const subsIn = text => { // $( ) inside an expanding here-string
    for (let k = text.indexOf('$('); k >= 0; k = text.indexOf('$(', k + 1)) {
      const e = captureBalanced(text, k + 1, '(', ')');
      stage.subs.push(text.slice(k + 2, text[e - 1] === ')' ? e - 1 : e)); k = e - 1;
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    // Here-strings: @'<newline> ... <newline>'@ is literal data; @" ... "@ expands $( ).
    if (c === '@' && (n === "'" || n === '"') && /^\r?\n/.test(s.slice(i + 2, i + 4))) {
      const close = s.slice(i + 2).search(n === "'" ? /\r?\n'@/ : /\r?\n"@/);
      const bodyEnd = close < 0 ? s.length : i + 2 + close;
      const body = s.slice(i + 2, bodyEnd).replace(/^\r?\n/, '');
      if (n === '"') subsIn(body);
      buf += body; started = true;
      i = close < 0 ? s.length : s.indexOf('@', bodyEnd + 1) + 1; continue;
    }
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
        if (s[i] === '$' && s[i + 1] === '(') { buf += '$'; i = block(i + 1, '(', ')'); continue; }
        buf += s[i++];
      }
      i++; continue;
    }
    if (c === '<' && n === '#') { const k = s.indexOf('#>', i + 2); i = k < 0 ? s.length : k + 2; continue; }
    if (c === '#' && !started) { const k = s.indexOf('\n', i); i = k < 0 ? s.length : k; continue; }
    if ((c === '$' || c === '@') && n === '(') { buf += c; i = block(i + 1, '(', ')'); continue; }
    if (c === '(' && !started) { i = block(i, '(', ')'); continue; }
    if (c === '{' && !started) { i = block(i, '{', '}'); continue; }
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

// Bash. Each stage also lists the command texts it runs inside $( ), `...`, <( ) and >( ) (stage.subs), found by
// one left-to-right pass that knows quoting: nothing inside 'single quotes' or a quoted heredoc body is a command
// (a commit message is data; Fable verification N1). Nesting deeper than MAX_NEST sets pipelines.overflow and is
// not followed (N2: the caller denies it); every character is read once, so the cost is linear.
const MAX_NEST = 8;

// Line continuations. Bash removes a backslash-newline before it splits words: outside quotes and inside "double
// quotes" ("git push --fo\<newline>rce" is --force), but not inside 'single quotes', a comment or a heredoc body.
// Git Bash also takes backslash-CRLF; Linux and macOS bash do not. A text without one is returned unchanged.
const CONT_CRLF = process.platform === 'win32';
function unfold(s) {
  if (!(CONT_CRLF ? /\\\r?\n/ : /\\\n/).test(s)) return s;
  const cont = i => (s[i] !== '\\' ? 0 : s[i + 1] === '\n' ? 2 : CONT_CRLF && s[i + 1] === '\r' && s[i + 2] === '\n' ? 3 : 0);
  const stack = []; // 'dq' (double quotes), 'bt' (backticks) or { depth } for a $( )
  const heredocs = [];
  let out = '';
  let last = ''; // the last character written: reading out[out.length - 1] re-flattens a long string (review H1)
  const put = t => { if (t) { out += t; last = t[t.length - 1]; } };
  let i = 0;
  while (i < s.length) {
    const k = cont(i);
    if (k) { i += k; continue; }
    const c = s[i];
    const top = stack[stack.length - 1];
    if (c === '\\') { put(s.slice(i, i + 2)); i += 2; continue; }
    if (c === '$' && s[i + 1] === '(') { stack.push({ depth: 1 }); put('$('); i += 2; continue; }
    if (c === '`') { if (top === 'bt') stack.pop(); else stack.push('bt'); put(c); i++; continue; }
    if (top === 'dq') { if (c === '"') stack.pop(); put(c); i++; continue; }
    if (c === '"') { stack.push('dq'); put(c); i++; continue; }
    if (c === "'") { const e = s.indexOf("'", i + 1); const end = e < 0 ? s.length : e + 1; put(s.slice(i, end)); i = end; continue; }
    if (c === '#' && (!last || /[\s;&|()<>]/.test(last))) {
      const e = s.indexOf('\n', i); const end = e < 0 ? s.length : e; put(s.slice(i, end)); i = end; continue;
    }
    if (typeof top === 'object') {
      if (c === '(') top.depth++;
      else if (c === ')' && --top.depth === 0) stack.pop();
    }
    if (c === '<' && s[i + 1] === '<') {
      if (s[i + 2] === '<') { put('<<<'); i += 3; continue; }
      put('<<'); i += 2;
      const strip = s[i] === '-'; if (strip) { put('-'); i++; }
      while (s[i] === ' ' || s[i] === '\t') put(s[i++]);
      let delim = '';
      let quoted = false; // any quoting in the delimiter word: the body is taken literally
      while (i < s.length) { // the same word rules as lexBash, continuations removed
        const kk = cont(i);
        if (kk) { i += kk; continue; }
        if (/[\s;|&<>()]/.test(s[i])) break;
        if (s[i] === "'" || s[i] === '"') {
          quoted = true;
          const e = s.indexOf(s[i], i + 1); const end = e < 0 ? s.length : e + 1;
          delim += s.slice(i + 1, e < 0 ? s.length : e); put(s.slice(i, end)); i = end; continue;
        }
        if (s[i] === '\\') { quoted = true; delim += s[i + 1] || ''; put(s.slice(i, i + 2)); i += 2; continue; }
        delim += s[i]; put(s[i++]);
      }
      if (delim) heredocs.push({ delim, strip, quoted });
      continue;
    }
    put(c); i++;
    if (c === '\n' && heredocs.length) { // heredoc bodies are data, up to their delimiter line
      for (const h of heredocs.splice(0)) {
        while (i < s.length) {
          // One body line. With an unquoted delimiter bash removes backslash-newline in the body too, so a line can
          // continue onto the next, also the delimiter line (review of v0.2, M1); a quoted one keeps the body as is.
          let line = '';
          let j = i;
          while (j < s.length && s[j] !== '\n') {
            if (!h.quoted && s[j] === '\\') { const kk = cont(j); if (kk) { j += kk; continue; } line += s.slice(j, j + 2); j += 2; continue; }
            line += s[j++];
          }
          const cmp = (h.strip ? line.replace(/^\t+/, '') : line).replace(/\r$/, '');
          if (typeof top === 'object' && cmp === `${h.delim})`) { put(line.slice(0, line.lastIndexOf(')'))); i = s.lastIndexOf(')', j); break; }
          const nl = j < s.length;
          put(nl ? `${line}\n` : line); i = nl ? j + 1 : j;
          if (cmp === h.delim) break;
        }
      }
    }
  }
  return out;
}

function parse(raw, opts = {}) {
  if (opts.dialect === 'ps') return parsePs(raw);
  const s = unfold(String(raw || ''));
  const st = { depth: 0, overflow: false };
  const r = lexBash(s, 0, false, st);
  r.pipelines.overflow = st.overflow;
  return r.pipelines;
}

// One substitution starting at s[i] === '(' (after $, < or >): returns { text, end }.
function subAt(s, i, st) {
  if (st.depth >= MAX_NEST) {
    st.overflow = true;
    const e = captureBalanced(s, i, '(', ')');
    return { text: s.slice(i + 1, e), end: e };
  }
  st.depth++;
  const r = lexBash(s, i + 1, true, st);
  st.depth--;
  return { text: s.slice(i + 1, r.found ? r.end - 1 : r.end), end: r.end };
}

// The substitutions in the body of an unquoted heredoc (it expands $( ) and backticks).
function bodySubs(body, st) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { i++; continue; }
    if (body[i] === '$' && body[i + 1] === '(') { const r = subAt(body, i + 1, st); out.push(r.text); i = r.end - 1; continue; }
    if (body[i] === '`') { const k = body.indexOf('`', i + 1); if (k < 0) break; out.push(body.slice(i + 1, k)); i = k; }
  }
  return out;
}

function lexBash(s, start, nested, st) {
  const pipelines = [];
  let pipeline = [];
  let stage = { words: [], redirects: [], subs: [] };
  let buf = '';
  let started = false;
  let pendingRedirect = false;
  let parens = 0;
  const heredocs = [];

  const endWord = () => {
    if (!started) return;
    if (pendingRedirect) { stage.redirects.push(buf); pendingRedirect = false; } else stage.words.push(buf);
    buf = ''; started = false;
  };
  const endStage = () => {
    endWord();
    pendingRedirect = false;
    if (stage.words.length || stage.redirects.length || stage.subs.length) pipeline.push(cleanStage(stage));
    stage = { words: [], redirects: [], subs: [] };
  };
  const endPipeline = () => { endStage(); if (pipeline.length) pipelines.push(pipeline); pipeline = []; };
  const sub = (i, from) => { const r = subAt(s, i, st); stage.subs.push(r.text); buf += s.slice(from, r.end); started = true; return r.end; };
  const tick = i => { // `...` (no nesting followed)
    const k = s.indexOf('`', i + 1); const e = k < 0 ? s.length : k + 1;
    stage.subs.push(s.slice(i + 1, k < 0 ? s.length : k)); buf += s.slice(i, e); started = true; return e;
  };

  let i = start;
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
        if (s[i] === '$' && s[i + 1] === '(') { i = sub(i + 1, i); continue; }
        if (s[i] === '`') { i = tick(i); continue; }
        buf += s[i++];
      }
      i++; continue;
    }
    // Line continuation. Backslash-CR-LF continues only in Git Bash on Windows; Linux / macOS bash reads "\<CR>" as an
    // escaped character and the newline ends the command (third review L1).
    if (c === '\\' && (n === '\n' || (n === '\r' && s[i + 2] === '\n' && process.platform === 'win32'))) { i += n === '\n' ? 2 : 3; continue; }
    if (c === '\\') { buf += n === undefined ? '' : n; started = true; i += 2; continue; }
    if (c === '$' && n === '(') { i = sub(i + 1, i); continue; }
    if (c === '`') { i = tick(i); continue; }
    if ((c === '<' || c === '>') && n === '(') { endWord(); i = sub(i + 1, i); endWord(); continue; }
    if (c === '<' && n === '<') {
      endWord();
      stage.input = true; // the stage reads stdin from a heredoc or here-string (database guard)
      if (s[i + 2] === '<') { i += 3; continue; } // here-string: the next word is data on stdin
      i += 2;
      const strip = s[i] === '-'; if (strip) i++;
      while (s[i] === ' ' || s[i] === '\t') i++;
      let delim = ''; let quoted = false;
      while (i < s.length && !/[\s;|&<>()]/.test(s[i])) {
        if (s[i] === "'" || s[i] === '"') { quoted = true; const k = s.indexOf(s[i], i + 1); delim += s.slice(i + 1, k < 0 ? s.length : k); i = k < 0 ? s.length : k + 1; continue; }
        if (s[i] === '\\') { quoted = true; delim += s[i + 1] || ''; i += 2; continue; }
        delim += s[i++];
      }
      if (delim) heredocs.push({ delim, quoted, strip, subs: stage.subs });
      continue;
    }
    if (c === '#' && !started) { const k = s.indexOf('\n', i); i = k < 0 ? s.length : k; continue; }
    if (c === '\n' && heredocs.length) {
      endPipeline(); i++;
      // Heredoc bodies start on the next line and end at a line holding only the delimiter (data, not commands).
      for (const h of heredocs.splice(0)) {
        const body = [];
        while (i < s.length) {
          const k = s.indexOf('\n', i);
          const line = s.slice(i, k < 0 ? s.length : k).replace(/\r$/, '');
          const cmp = h.strip ? line.replace(/^\t+/, '') : line;
          if (nested && cmp === `${h.delim})`) { i += line.lastIndexOf(')'); break; } // "EOF)" closes the $( too
          i = k < 0 ? s.length : k + 1;
          if (cmp === h.delim) break;
          body.push(line);
        }
        if (!h.quoted) h.subs.push(...bodySubs(body.join('\n'), st));
      }
      continue;
    }
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
    if (c === '<') { endWord(); stage.input = true; i++; continue; } // "< file": the file word stays a word
    if (c === ')' && nested && parens === 0) { endPipeline(); return { pipelines, end: i + 1, found: true }; }
    if (c === '(') { parens++; endWord(); i++; continue; } // subshell grouping syntax
    if (c === ')') { if (parens) parens--; endWord(); i++; continue; }
    if (/\s/.test(c)) { endWord(); i++; continue; }
    buf += c; started = true; i++;
  }
  endPipeline();
  return { pipelines, end: s.length, found: false };
}

function cleanStage(st) {
  // Brace groups "{ a; b; }": bash needs them as standalone words, so drop those words only.
  const words = st.words.slice();
  while (words.length && words[0] === '{') words.shift();
  while (words.length && words[words.length - 1] === '}') words.pop();
  // same subs array: heredoc bodies add to it later; input: the stage reads stdin from a file, heredoc or here-string
  return { words, redirects: st.redirects, subs: st.subs || [], input: !!st.input };
}

// Wrappers and shell keywords that run the command after them ("then npm install", "timeout 60 make", "! npm test").
const PREFIX = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'xargs', 'builtin', 'nice', 'doas', 'timeout', 'winpty',
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!']);
const WITH_VALUE = { sudo: new Set(['-u', '-g', '-h', '-p', '-C']), xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-s', '-E']), nice: new Set(['-n']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']) };
const NEEDS_ARG = new Set(['timeout']); // its first plain word is a duration, not the command

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
      if (NEEDS_ARG.has(base)) i++;
      continue;
    }
    break;
  }
  if (i >= words.length) return null;
  return { cmd: baseName(words[i]), args: words.slice(i + 1), word: words[i] };
}

function baseName(w) {
  return String(w).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

module.exports = { parse, command, baseName, unfold };
