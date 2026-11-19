'use strict';
// Typed confirmation (design 9.2). Only the UserPromptSubmit hook, which sees the user's own prompts, grants tokens.
// A token is one-shot, valid 5 minutes, bound to its session and its block id.
// File: .jspark-forge/state/confirm.json = { tokens: [{ id, session, expires }] }
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./fsx');

const TTL_MS = 5 * 60 * 1000;
const fileOf = dir => path.join(dir, '.jspark-forge', 'state', 'confirm.json');

function read(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return Array.isArray(j.tokens) ? j.tokens : null;
  } catch (e) {
    return e && e.code === 'ENOENT' ? [] : null; // null = unreadable: never treat as a valid token
  }
}
const write = (dir, tokens) => writeAtomic(fileOf(dir), JSON.stringify({ tokens }, null, 2) + '\n');

function grantFromPrompt(dir, session, prompt, knownIds, now = Date.now()) {
  const known = new Set(knownIds);
  const granted = [];
  for (const m of String(prompt || '').matchAll(/\bconfirm\s+([A-Za-z0-9][A-Za-z0-9-]*)/gi)) {
    if (known.has(m[1]) && !granted.includes(m[1])) granted.push(m[1]);
  }
  if (!granted.length) return granted;
  const tokens = (read(dir) || []).filter(t => t.expires >= now && !(t.session === session && granted.includes(t.id)));
  for (const id of granted) tokens.push({ id, session, expires: now + TTL_MS });
  write(dir, tokens);
  return granted;
}

function consume(dir, session, id, now = Date.now()) {
  const tokens = read(dir);
  if (!tokens) return false;
  const i = tokens.findIndex(t => t.id === id && t.session === session && t.expires >= now);
  if (i < 0) return false;
  tokens.splice(i, 1);
  write(dir, tokens.filter(t => t.expires >= now));
  return true;
}

module.exports = { grantFromPrompt, consume, TTL_MS };
