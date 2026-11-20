'use strict';
// Design v0.2 section 3: lint for skills and briefs. Each function returns [{ file, line, message }].
const fs = require('fs');
const path = require('path');

// Blank out HTML comments but keep their line breaks, so line numbers stay true.
const stripComments = text => text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''));
const linesOf = text => stripComments(String(text)).replace(/\r/g, '').split('\n');

function lintSkill(text, file) {
  const errs = [];
  const err = (line, message) => errs.push({ file, line, message });
  const lines = linesOf(text);
  let bodyStart = 0;
  if (lines[0].trim() !== '---') {
    err(1, 'frontmatter missing (the file must start with ---, then name and description)');
  } else {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end < 0) err(1, 'frontmatter is not closed with ---');
    else {
      bodyStart = end + 1;
      const fm = {};
      lines.slice(1, end).forEach((l, i) => {
        const m = l.match(/^([A-Za-z-]+):\s*(.*)$/);
        if (m) fm[m[1]] = { value: m[2].trim(), line: i + 2 };
      });
      if (!fm.name || !fm.name.value) err(fm.name ? fm.name.line : 1, 'frontmatter field name is missing or empty');
      if (!fm.description || !fm.description.value) err(fm.description ? fm.description.line : 1, 'frontmatter field description is missing or empty');
      else if (!/^Use when\b/.test(fm.description.value)) err(fm.description.line, 'description must start with "Use when" (it states the trigger)');
    }
  }
  const starts = [];
  for (let i = bodyStart; i < lines.length; i++) if (/^\d+\.\s/.test(lines[i])) starts.push(i);
  const parts = starts.map((s, k) => ({ line: s + 1, text: lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length).join('\n') }));
  if (parts.some(p => /\bInput:/.test(p.text))) {
    let verify = false;
    for (const p of parts) {
      if (/\bVerify:/.test(p.text)) {
        verify = true;
        if (!/\bEvidence:/.test(p.text)) err(p.line, 'the Verify: part is missing Evidence: (what check ran and what output proves it)');
      } else {
        for (const f of ['Input:', 'Action:', 'Output:']) {
          if (!new RegExp(`\\b${f}`).test(p.text)) err(p.line, `part is missing ${f}`);
        }
      }
    }
    if (!verify) err(parts[0].line, 'no Verify: part (the last part must verify, with Evidence:)');
  }
  return errs;
}

const REQUIRED = ['Goal', 'CAN change', 'CANNOT change', 'Done', 'Stop'];
const FIELDS = REQUIRED.concat(['Setup', 'Log', 'Retries', 'Tie-break', 'Outputs']);

function lintBrief(text, file) {
  const errs = [];
  const err = (line, message) => errs.push({ file, line, message });
  const lines = linesOf(text);
  const found = {};
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.match(/^([A-Za-z][A-Za-z -]*):\s*(.*)$/);
    if (m && FIELDS.includes(m[1])) {
      if (!found[m[1]]) found[m[1]] = cur = { line: i + 1, value: m[2].trim() };
      else cur = null;
    } else if (cur && /^\s+\S/.test(l)) cur.value += ' ' + l.trim();
    else cur = null;
  });
  for (const f of REQUIRED) {
    if (!found[f]) err(1, `field ${f} is missing`);
    else if (!found[f].value) err(found[f].line, `field ${f} is empty`);
  }
  if (found.Retries && !/^\d+\b/.test(found.Retries.value)) err(found.Retries.line, 'Retries must be a number (e.g. "2, then log and skip")');
  if (found.Outputs && !/^[A-Za-z_][\w-]*(\s*,\s*[A-Za-z_][\w-]*)*$/.test(found.Outputs.value)) {
    err(found.Outputs.line, 'Outputs must be a comma list of names (e.g. "commit, test_totals")');
  }
  if (found.Stop && /\bnever\b/i.test(found.Stop.value)) err(found.Stop.line, 'Stop must be an explicit condition (attempts, budget or time), never "never stop"');
  return errs;
}

// A build graph (design-v0.4 2): the graph's own validation, with its line numbers.
const lintGraph = (text, f) => { const G = require('./graph'); return G.validate(G.parse(text)).map(e => ({ file: f, line: e.line, message: e.message })); };
const isGraph = f => /[\\/]graphs[\\/][^\\/]+\.md$/i.test(f) && /^\S*#\s+Graph:/m.test(fs.readFileSync(f, 'utf8').slice(0, 2000));
const lintFile = f => (path.basename(f) === 'SKILL.md' ? lintSkill : isGraph(f) ? lintGraph : lintBrief)(fs.readFileSync(f, 'utf8'), f);

function defaultPaths(dir) {
  const out = [];
  const skills = path.join(dir, 'skills');
  if (fs.existsSync(skills)) {
    for (const n of fs.readdirSync(skills).sort()) {
      const f = path.join(skills, n, 'SKILL.md');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  const briefs = path.join(require('./paths').forgeDir(dir), 'briefs');
  if (fs.existsSync(briefs)) {
    for (const n of fs.readdirSync(briefs).sort()) if (n.endsWith('.md')) out.push(path.join(briefs, n));
  }
  const graphs = path.join(require('./paths').repoForgeDir(dir), 'graphs');
  if (fs.existsSync(graphs)) {
    for (const n of fs.readdirSync(graphs).sort()) if (n.endsWith('.md')) out.push(path.join(graphs, n));
  }
  return out;
}

// `forge.js lint [paths...]`: returns the text to print; sets process.exitCode to 1 when anything fails.
function run(dir, args) {
  const files = args.length ? args : defaultPaths(dir || process.cwd());
  if (!files.length) return 'No skills or briefs found to lint.\n';
  const out = [];
  let problems = 0;
  let good = 0;
  for (const f of files) {
    let errs;
    try { errs = lintFile(f); } catch (e) { errs = [{ file: f, line: 1, message: `cannot read: ${e.message}` }]; }
    if (!errs.length) { out.push(`ok ${f}`); good++; } else for (const e of errs) { out.push(`${e.file}:${e.line}: ${e.message}`); problems++; }
  }
  const files_ = n => `${n} file${n === 1 ? '' : 's'}`;
  out.push(problems ? `${problems} problem${problems === 1 ? '' : 's'} in ${files_(files.length - good)} (${good} ok)` : `${files_(good)} ok`);
  if (problems) process.exitCode = 1;
  return out.join('\n') + '\n';
}

module.exports = { lintSkill, lintBrief, run, defaultPaths };
