#!/usr/bin/env node
// Spike C analyzer. Usage: node spikes/analyze-spike-c.js <log-dir>
// For each run log c-<type>-<n>.jsonl prints: SubagentStart fired (agent_type), canary text found in the helper's
// transcript, report ends with CANARY-7731-SEEN, FORGE_BLOCK_TEST call seen inside the helper and denied.
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const rows = [];
for (const f of fs.readdirSync(dir).filter(f => /^c-.*\.jsonl$/.test(f)).sort()) {
  const recs = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const starts = recs.filter(r => r.event === 'SubagentStart');
  const stops = recs.filter(r => r.event === 'SubagentStop');
  const blockCalls = recs.filter(r => r.event === 'PreToolUse' && /FORGE_BLOCK_TEST/.test(JSON.stringify(r.input.tool_input || {})));
  const inHelper = blockCalls.filter(r => r.input.agent_id);
  const denied = inHelper.filter(r => r.response && r.response.hookSpecificOutput && r.response.hookSpecificOutput.permissionDecision === 'deny');
  let canaryInTranscript = false;
  for (const s of stops) {
    const p = s.input.agent_transcript_path;
    if (p && fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('FORGE-CANARY-7731')) canaryInTranscript = true;
  }
  let reportSeen = false;
  for (const s of stops) if (/CANARY-7731-SEEN/.test(s.input.last_assistant_message || '')) reportSeen = true;
  const out = path.join(dir, f.replace('.jsonl', '.out.json'));
  let result = '';
  try { result = JSON.parse(fs.readFileSync(out, 'utf8')).result || ''; } catch { result = '(no json output)'; }
  if (/CANARY-7731-SEEN/.test(result)) reportSeen = true;
  rows.push({
    run: f.replace(/^c-|\.jsonl$/g, ''),
    subagentStart: starts.map(s => s.input.agent_type || '?').join('|') || 'none',
    canaryInTranscript, reportSeen,
    blockInHelper: inHelper.length ? `${denied.length}/${inHelper.length} denied` : (blockCalls.length ? 'only in main' : 'not attempted'),
  });
}
console.table(rows);
