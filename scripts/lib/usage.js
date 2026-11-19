'use strict';
// Usage bands (design 7.2). The status-line wrapper writes .jspark-forge/usage/<session>.json; hooks read it.
// Figures older than 2 minutes are ignored. The highest available figure (context, five-hour, seven-day) decides:
// >= 95 -> band 95, >= 80 -> band 80. A band fires once when it is first reached; it re-arms when the figure drops
// (after compaction or a window reset). The fired band is kept in the session state.
const fs = require('fs');
const path = require('path');
const state = require('./state');

const STALE_MS = 2 * 60 * 1000;
const bandOf = p => (p >= 95 ? 95 : p >= 80 ? 80 : 0);

function highest(dir, sid, now = Date.now()) {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'usage', `${String(sid).replace(/[^A-Za-z0-9-]/g, '')}.json`), 'utf8'));
    if (!u || typeof u.ts !== 'number' || now - u.ts > STALE_MS) return null;
    const figs = [u.context_pct, u.five_hour_pct, u.seven_day_pct].filter(v => typeof v === 'number' && Number.isFinite(v));
    return figs.length ? Math.max(...figs) : null;
  } catch { return null; }
}

// -> 80 | 95 when a band is newly reached, else null. Updates the session state.
function crossed(dir, sid, now = Date.now()) {
  const pct = highest(dir, sid, now);
  if (pct === null) return null;
  const band = bandOf(pct);
  const sess = state.readSession(dir, sid);
  const prev = sess.usageBand || 0;
  if (band === prev) return null;
  sess.usageBand = band;
  state.writeSession(dir, sid, sess);
  return band > prev ? band : null;
}

module.exports = { crossed, highest, bandOf };
