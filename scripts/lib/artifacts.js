'use strict';
// Spec principle 9: local-first, account-independent. A published Artifact is only a view of a file; the file is kept
// in the project. When Claude publishes a page (the Artifact tool), its source is copied into
// <forge folder>/artifacts/ unless it already lives in the project, and listed in <forge folder>/artifacts.md
// (date | title | local path | link). At session start, and in /jspark-forge:check, a listed page whose local file has
// gone is flagged. A page published with no file to copy is listed with local path "none" and flagged the same way (v0.5.1).
// Reason: pages and their watches stop working when the signed-in account changes (owner, 2026-11-03 and 2026-11-20).
// Every function fails open: a hook never breaks because of this.
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./paths');
const { writeAtomic } = require('./fsx');

const listFile = dir => path.join(paths.forgeDir(dir), 'artifacts.md');
const HEAD = '# Pages and documents kept locally\n\nEach line: date | title | local file | link (a view of the file; the link may stop working when the account changes).\n\n';
const RULE = 'JSPARK Forge local-first rule: nothing in this project may live only in a Claude account or a temp folder. ' +
  'Any page, report, mock-up or document you make for the user is saved as a file in the project first (HTML for a page), ' +
  'and you tell the user its path; a published Artifact or an online document is only a view of that file.';

const pad2 = n => String(n).padStart(2, '0');
const today = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const clean = s => String(s || '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

function read(dir) { // -> [{ date, title, file, url }]
  let text = '';
  try { text = fs.readFileSync(listFile(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^- (\d{4}-\d{2}-\d{2}) \| (.*?) \| (.*?) \| (.*)$/);
    if (m) out.push({ date: m[1], title: clean(m[2]), file: clean(m[3]), url: clean(m[4]) }); // cleaned on read too: the file can come with git
  }
  return out;
}
const write = (dir, items) => writeAtomic(listFile(dir), HEAD + items.map(i => `- ${i.date} | ${i.title} | ${i.file} | ${i.url}`).join('\n') + '\n');

const NO_COPY = 'none'; // the local path of a page that was published but never kept (v0.5.1)
const LINK_RE = /https:\/\/claude\.ai\/[A-Za-z0-9/_-]*artifact[A-Za-z0-9/_-]*/;
const linkOf = toolResponse => { const m = JSON.stringify(toolResponse || '').match(LINK_RE); return m ? clean(m[0]) : null; }; // the artifact link in the tool's reply, or null

// A page that was published but whose file could not be kept: listed with local path "none" (once per link).
function recordUnkept(dir, ti, url, now) {
  const listed = read(dir);
  const title = clean(ti.title || (ti.file_path ? path.basename(String(ti.file_path)) : '') || 'unnamed page');
  const items = listed.filter(i => !(i.file === NO_COPY && (url !== 'no link recorded' ? i.url === url : i.title === title)));
  items.push({ date: today(now), title, file: NO_COPY, url });
  write(dir, items);
  return 'JSPARK Forge: this page was published but no local copy of it exists (its source file was missing or unreadable, or the call named none). ' +
    `It is listed in ${paths.display(dir, listFile(dir))} with local path none. Save the page as a file in the project now (HTML for a page), ` +
    'and tell the user its path together with the link; the link may stop working if they change account.';
}

// A publish by the Artifact tool. Only a real publish counts: the action is missing or "publish", it is not an asset
// upload, and the reply holds an artifact link (a list, read, quickstart or a failed call records nothing).
// -> { text, kept, unkept } (text for Claude; kept: the local path shown; unkept: the link of a page with no copy), or null.
function publish(dir, toolInput, toolResponse, now = new Date()) {
  try {
    const ti = toolInput || {};
    if ((ti.action && ti.action !== 'publish') || ti.asset) return null;
    const link = linkOf(toolResponse);
    // A publish with a real source file is kept even when no link can be read from the reply (the reply's shape is not
    // documented): losing the copy is the worse mistake. With no link and no file there is no sign of a publish.
    let hasFile = false;
    try { hasFile = !!ti.file_path && fs.statSync(path.resolve(String(ti.file_path))).isFile(); } catch { /* no file */ }
    if (!link && !hasFile) return null;
    const url = link || 'no link recorded';
    const unkept = () => (link ? { text: recordUnkept(dir, ti, url, now), kept: null, unkept: url } : null);
    try {
      if (!ti.file_path) return unkept();
      const src = path.resolve(String(ti.file_path));
      if (!fs.statSync(src).isFile()) return unkept();
      const rel = path.relative(dir, src);
      const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      const listed = read(dir);
      let local = src;
      if (!inside) { // a temp or scratch file: keep a copy in the project's forge folder
        const folder = path.join(paths.forgeDir(dir), 'artifacts');
        fs.mkdirSync(folder, { recursive: true });
        const ext = path.extname(src);
        const stem = path.basename(src, ext);
        // Another page with the same file name keeps its own copy (second review S1): report.html, report-2.html, ...
        for (let n = 1; ; n++) {
          local = path.join(folder, n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`);
          const other = listed.find(i => i.file === paths.display(dir, local));
          if (!fs.existsSync(local) || !other || other.url === url || n > 200) break;
        }
        fs.copyFileSync(src, local);
      }
      const shown = paths.display(dir, local);
      let title = '';
      try { // the first 20 KB only: a page can be very large (second review N6)
        const fd = fs.openSync(src, 'r');
        const buf = Buffer.alloc(20000);
        const got = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        title = (buf.toString('utf8', 0, got).match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
      } catch { /* unreadable */ }
      const items = listed.filter(i => i.file !== shown && !(i.file === NO_COPY && url !== 'no link recorded' && i.url === url));
      items.push({ date: today(now), title: clean(title || ti.title || path.basename(src)), file: shown, url });
      write(dir, items);
      return { kept: shown, unkept: null, text: `JSPARK Forge: a local copy of this page is kept at ${shown} (listed in ${paths.display(dir, listFile(dir))}). ` +
        'Tell the user that path together with the link; the link may stop working if they change account.' };
    } catch { return unkept(); } // the source could not be read or copied
  } catch { return null; }
}
const onPublish = (...a) => { const r = publish(...a); return r ? r.text : null; }; // the text only

// Listed pages with no local file: gone, or never kept. -> [{ date, title, file, url, never }]
function gone(dir) {
  return read(dir).filter(i => i.file === NO_COPY || !fs.existsSync(path.resolve(dir, i.file)))
    .map(i => Object.assign({ never: i.file === NO_COPY }, i));
}
const describe = i => `"${i.title}" (${i.never ? 'never kept' : i.file}; ${i.url})`;

// One line per page for /jspark-forge:check (the same style as its other lines).
function checkLines(dir) {
  try {
    return gone(dir).map(i => `the page ${describe(i)} has no local copy${i.never ? ' (it was published but never saved as a file)' : ' any more'}: ask Claude to save it as a file in the project, or delete its line in ${paths.display(dir, listFile(dir))}`);
  } catch { return []; }
}

// Listed pages with no local copy. -> one line for the user, or null.
function missing(dir) {
  try {
    const g = gone(dir);
    if (!g.length) return null;
    return `JSPARK Forge: ${g.length === 1 ? 'a listed page has' : `${g.length} listed pages have`} no local copy: ` +
      `${g.map(describe).join(', ')}. Open the link while its account is signed in and ask Claude to save it as a file in the project, or delete its line in ${paths.display(dir, listFile(dir))}.`;
  } catch { return null; }
}

// ---------- documents that were never listed (principle 9, v0.5.1 gaps) ----------
// The action log keeps the absolute path of a file written outside the project (forge.js `rel`). At session start (the
// caller limits it to once a day): EDIT/WRITE lines of the last two days for an html, md or pdf file under the OS
// temp folder or a scratchpad folder of the Claude home, that still exists, with no file of the same name anywhere in
// the project (its forge folder included, where kept copies live). -> one line for the user, or null.
const DOC_EXT = /\.(html?|md|pdf)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);
const under = (base, p) => { const r = path.relative(base, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
function projectNames(dir, wanted) { // the wanted names (lower case) that exist somewhere in the project; a bounded walk
  const found = new Set();
  let budget = 20000;
  const walk = d => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (budget-- <= 0 || found.size === wanted.size) return;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name)); }
      else if (wanted.has(e.name.toLowerCase())) found.add(e.name.toLowerCase());
    }
  };
  walk(dir);
  return found;
}
function unlisted(dir, now = new Date(), claudeHome = '') {
  try {
    const stamps = [0, 1].map(n => { const d = new Date(now.getTime() - n * 86400000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; });
    const roots = [os.tmpdir()];
    try { roots.push(fs.realpathSync.native(os.tmpdir())); } catch { /* as given */ }
    const homes = claudeHome ? [path.resolve(claudeHome)] : [];
    try { if (homes[0]) homes.push(fs.realpathSync.native(homes[0])); } catch { /* as given */ }
    const seen = new Map();
    for (const s of stamps) {
      let text = '';
      try { text = fs.readFileSync(path.join(paths.forgeDir(dir), 'log', `${s}.log`), 'utf8'); } catch { continue; }
      for (const l of text.split(/\r?\n/)) {
        const m = l.match(/^\d\d:\d\d:\d\d \[[^\]]*\]\s+(EDIT|WRITE)\s+(.+)$/);
        if (!m) continue;
        let p = m[2].trim();
        if (process.platform === 'win32') p = p.replace(/^\/([a-zA-Z])\//, '$1:/'); // /c/Users/... as git bash shows it
        if (!path.isAbsolute(p) || !DOC_EXT.test(p)) continue;
        const abs = path.resolve(p);
        if (abs === path.resolve(dir) || under(dir, abs)) continue;
        const scratch = abs.split(/[\\/]/).some(seg => seg.toLowerCase() === 'scratchpad') && homes.some(b => under(b, abs));
        if (!scratch && !roots.some(b => under(b, abs))) continue;
        seen.set(process.platform === 'win32' ? abs.toLowerCase() : abs, abs);
      }
    }
    const existing = [...seen.values()].filter(a => { try { return fs.statSync(a).isFile(); } catch { return false; } });
    if (!existing.length) return null;
    const have = projectNames(dir, new Set(existing.map(a => path.basename(a).toLowerCase())));
    const todo = existing.filter(a => !have.has(path.basename(a).toLowerCase()));
    if (!todo.length) return null;
    const shown = todo.slice(0, 5).map(a => a.replace(/\\/g, '/')).join(', ');
    return `JSPARK Forge: These documents were written to a temporary folder and are not in the project: ${shown}${todo.length > 5 ? ` (+${todo.length - 5} more)` : ''}. Ask Claude to save the ones you need.`;
  } catch { return null; }
}

module.exports = { publish, onPublish, missing, checkLines, read, unlisted, RULE };
