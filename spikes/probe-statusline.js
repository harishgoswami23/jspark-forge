#!/usr/bin/env node
// Spike A status-line probe (throw-away). Appends one line per status-line run to
// $FORGE_SPIKE_STATUSLINE_LOG (default ~/forge-spike/statusline.jsonl) and prints "probe".
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const LOG = process.env.FORGE_SPIKE_STATUSLINE_LOG || path.join(os.homedir(), 'forge-spike', 'statusline.jsonl');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try {
    const d = JSON.parse(raw || '{}');
    const rl = d.rate_limits;
    const rec = {
      ts: Date.now(), iso: new Date().toISOString(), session_id: d.session_id || null,
      context_pct: d.context_window ? d.context_window.used_percentage ?? null : null,
      five_hour_pct: rl && rl.five_hour ? rl.five_hour.used_percentage ?? null : null,
      seven_day_pct: rl && rl.seven_day ? rl.seven_day.used_percentage ?? null : null,
      five_resets_at: rl && rl.five_hour ? rl.five_hour.resets_at ?? null : null,
      seven_resets_at: rl && rl.seven_day ? rl.seven_day.resets_at ?? null : null,
      has_rate_limits: !!rl, keys: Object.keys(d),
    };
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
  } catch { /* never break the status line */ }
  process.stdout.write('probe');
});
