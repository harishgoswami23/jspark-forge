'use strict';
// File helpers (design section 11): UTF-8, LF, atomic writes via temp file + rename,
// retrying the rename up to 3 times on Windows when an editor or antivirus holds the file.
const fs = require('fs');
const path = require('path');

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 3) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      sleepSync(20 * (i + 1));
    }
  }
}

module.exports = { writeAtomic };
