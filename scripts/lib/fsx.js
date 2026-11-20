'use strict';
// File helpers (design section 11): UTF-8, LF, atomic writes via temp file + rename,
// retrying the rename up to 3 times on Windows when an editor or antivirus holds the file.
// v0.5.1 (crash recovery): the temp file is flushed to the disk (fsync) before the rename, so a power cut leaves the old
// file or the new one, never an empty or half-written one. { sync: false } skips the flush (small, rewritable files).
const fs = require('fs');
const path = require('path');

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function writeAtomic(file, text, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const flush = !(opts && opts.sync === false);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text, null, 'utf8');
    if (flush) { try { fs.fsyncSync(fd); } catch { /* some file systems refuse it: carry on */ } }
  } finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 3) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      sleepSync(20 * (i + 1));
    }
  }
}

module.exports = { writeAtomic };
