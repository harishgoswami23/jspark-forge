#!/usr/bin/env node
'use strict';
// A stand-in for codebase-memory-mcp in tests: `cli … index_repository {json}` appends one line to FAKE_CBM_LOG,
// waits FAKE_CBM_MS milliseconds, and exits with FAKE_CBM_EXIT (default 0).
const fs = require('fs');
const log = process.env.FAKE_CBM_LOG;
const line = JSON.stringify({ at: Date.now(), pid: process.pid, args: process.argv.slice(2) });
if (log) fs.appendFileSync(log, `${line}\n`);
setTimeout(() => process.exit(Number(process.env.FAKE_CBM_EXIT || 0)), Number(process.env.FAKE_CBM_MS || 50));
