'use strict';
// Spec principle 9: local-first, account-independent. A published Artifact is only a view of a file; the file is kept
// in the project. When Claude publishes a page (the Artifact tool), its source is copied into
// <forge folder>/artifacts/ unless it already lives in the project, and listed in <forge folder>/artifacts.md
// (date | title | local path | link). At session start a listed page whose local file has gone is flagged.
// Reason: pages and their watches stop working when the signed-in account changes (owner, 2026-11-03 and 2026-11-20).
// Every function fails open: a hook never breaks because of this.
const fs = require('fs');
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

// A publish by the Artifact tool. -> text for Claude (where the local copy is), or null when nothing was recorded.
function onPublish(dir, toolInput, toolResponse, now = new Date()) {
  try {
    const ti = toolInput || {};
    if ((ti.action && ti.action !== 'publish') || !ti.file_path || ti.asset) return null;
    const src = path.resolve(String(ti.file_path));
    if (!fs.statSync(src).isFile()) return null;
    const rel = path.relative(dir, src);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    const url = clean((JSON.stringify(toolResponse || '').match(/https:\/\/claude\.ai\/[A-Za-z0-9/_-]*artifact[A-Za-z0-9/_-]*/) || [])[0] || ti.url || 'no link recorded');
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
    const items = listed.filter(i => i.file !== shown);
    items.push({ date: today(now), title: clean(title || ti.title || path.basename(src)), file: shown, url });
    write(dir, items);
    return `JSPARK Forge: a local copy of this page is kept at ${shown} (listed in ${paths.display(dir, listFile(dir))}). ` +
      'Tell the user that path together with the link; the link may stop working if they change account.';
  } catch { return null; }
}

// Listed pages whose local file has gone. -> one line for the user, or null.
function missing(dir) {
  try {
    const gone = read(dir).filter(i => !fs.existsSync(path.resolve(dir, i.file)));
    if (!gone.length) return null;
    return `JSPARK Forge: ${gone.length === 1 ? 'a listed page has' : `${gone.length} listed pages have`} no local copy any more: ` +
      `${gone.map(i => `"${i.title}" (${i.file}; ${i.url})`).join(', ')}. Open the link while its account is signed in and ask Claude to save it as a file again, or delete its line in ${paths.display(dir, listFile(dir))}.`;
  } catch { return null; }
}

module.exports = { onPublish, missing, read, RULE };
