'use strict';
// Typed confirmation (design 9.2). Only the UserPromptSubmit hook, which sees the user's own prompts, grants tokens.
// A token is one-shot, valid 5 minutes, bound to its session and its block id.
// File: .jspark-forge/state/confirm.json = { tokens: [{ id, session, expires }] }
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');
const paths = require('./paths');


const TTL_MS = 5 * 60 * 1000;
const fileOf = dir => path.join(paths.forgeDir(dir), 'state', 'confirm.json');

function read(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return Array.isArray(j.tokens) ? j.tokens : null;
  } catch (e) {
    return e && e.code === 'ENOENT' ? [] : null; // null = unreadable: never treat as a valid token
  }
}
const write = (dir, tokens) => writeAtomic(fileOf(dir), JSON.stringify({ tokens }, null, 2) + '\n');

// A line that is nothing but CONFIRM <id> (or "CONFIRM a and CONFIRM b"). Long lines are never one (and never tested:
// the pattern is slow on them, second review N8).
const ONE = '\\s*confirm\\s+[A-Za-z0-9][A-Za-z0-9-]*';
const LINE = new RegExp(`^${ONE}(?:\\s*(?:,|&|and)?${ONE})*\\s*[.!]*\\s*$`, 'i');
const isConfirmLine = l => l.length <= 200 && LINE.test(l);
// Text the harness wraps in tags (a helper's or teammate's report, a notification, command output) is never the user
// typing, wherever in the message it sits: a message that holds any of it grants nothing (second review S3).
const WRAPPED = /<\/?(?:agent-message|teammate-message|cross-session-message|task-notification|system-reminder|local-command-[a-z-]+|command-name|command-message|bash-stdout|bash-stderr|pasted_content)\b|\[SYSTEM NOTIFICATION/i;
// The whole message is CONFIRM lines and nothing else: a control message, not a request.
const isConfirmOnly = prompt => { const ls = String(prompt || '').split(/\r?\n/).filter(l => l.trim()); return ls.length > 0 && ls.every(isConfirmLine); };

function grantFromPrompt(dir, session, prompt, knownIds, now = Date.now()) {
  if (WRAPPED.test(String(prompt || ''))) return [];
  const known = new Set(knownIds);
  const granted = [];
  const whole = String(prompt || '').trim().replace(/[.!]+$/, '');
  // Only a line that is nothing but CONFIRM <id> (or the "CONFIRM a and CONFIRM b" form a block message gives) counts:
  // quoted or pasted text that mentions it grants nothing (review S9; seen with a helper's report on 2026-11-20).
  const own = String(prompt || '').split(/\r?\n/).filter(isConfirmLine).join('\n');
  for (const m of own.matchAll(/\bconfirm\s+([A-Za-z0-9][A-Za-z0-9-]*)/gi)) {
    if (!known.has(m[1]) || granted.includes(m[1])) continue;
    // A session-long CONFIRM must be the whole message (not inside pasted or quoted text). Fable code review, low.
    if (SESSION_LONG.has(m[1]) && !new RegExp(`^confirm\\s+${m[1]}$`, 'i').test(whole)) continue;
    granted.push(m[1]);
  }
  if (!granted.length) return granted;
  const tokens = (read(dir) || []).filter(t => live(t, now) && !(t.session === session && granted.includes(t.id)));
  for (const id of granted) tokens.push({ id, session, expires: now + (SESSION_LONG.has(id) ? SESSION_MS : TTL_MS) });
  write(dir, tokens);
  return granted;
}

// guest-quarantine (v0.1.1, owner 2026-11-19): one CONFIRM covers the rest of the session (reviewing a repo means
// installing, building and testing it repeatedly), capped at 12 hours. Every other block stays one-shot, 5 minutes.
const SESSION_LONG = new Set(['guest-quarantine']);
const SESSION_MS = 12 * 3600 * 1000;
const live = (t, now) => typeof t.expires === 'number' && t.expires >= now; // a token without an expiry is not valid

// Whether a live token exists, without spending it.
function has(dir, session, id, now = Date.now()) {
  return (read(dir) || []).some(t => t.id === id && t.session === session && live(t, now));
}

function consume(dir, session, id, now = Date.now()) {
  const tokens = read(dir);
  if (!tokens) return false;
  const i = tokens.findIndex(t => t.id === id && t.session === session && live(t, now));
  if (i < 0) return false;
  if (SESSION_LONG.has(id)) return true; // session-long: kept until it expires
  tokens.splice(i, 1);
  write(dir, tokens.filter(t => live(t, now)));
  return true;
}

module.exports = { grantFromPrompt, has, consume, TTL_MS, SESSION_LONG, isConfirmOnly, WRAPPED };
