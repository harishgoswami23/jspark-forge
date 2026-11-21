'use strict';
// Replace likely secrets with ‹redacted› before anything is written (design section 6).
// Best effort, imperfect by nature: it knows common shapes (key prefixes, JWTs, passwords in URLs, "password: x"), not
// every secret. The log never leaves the machine and is git-ignored; quoted text in the crash check is redacted the same way.

const R = '‹redacted›';

const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,                              // OpenAI / Anthropic-style keys
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,                      // GitHub fine-grained tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                        // GitHub classic tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                // AWS access key ids
  /\bxox[bpas]-[A-Za-z0-9-]{6,}/g,                        // Slack tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT-shaped: three base64url parts, the first starting eyJ
];

// Keep the label, hide the value.
const LABELLED = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi,
  // password=x, pwd=x, token: x, "password is: x", {"password":"x"}
  /(\b(?:password|passwd|pwd|token|secret|api[_-]?key)["']?(?:\s+is)?\s*[:=]\s*["']?)[^\s&;'",]+/gi,
  /((?:^|\s)(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(?=\S)(?!ort\b)[^\s'"]+/gi, // mysql -p<password>
  // scheme://user:password@host: keep scheme, user and host (the scheme's length is bounded: unbounded is quadratic on a.a.a.…)
  /(\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi,
];

const MIN_EXTRA = 6; // shorter .env values would mask ordinary words

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function redact(text, extra = []) {
  let s = String(text);
  for (const v of extra) {
    if (typeof v === 'string' && v.length >= MIN_EXTRA) s = s.replace(new RegExp(escapeRe(v), 'g'), R);
  }
  for (const re of PATTERNS) s = s.replace(re, R);
  for (const re of LABELLED) s = s.replace(re, (m, a, b) => `${a}${R}${typeof b === 'string' ? b : ''}`);
  return s;
}

// A URL quoted from a tool call keeps no query string (it can carry a signature or a token the patterns do not know).
function stripQuery(text) {
  return String(text).replace(/(\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s?#'"<>]+)\?[^\s#'"<>]*/gi, '$1');
}

// For text that is cut to a few hundred characters afterwards: redact only its start (redaction is not free on 100 KB).
const REDACT_MAX = 4000;
const redactHead = (text, extra) => redact(String(text).slice(0, REDACT_MAX), extra);

module.exports = { redact, redactHead, stripQuery, R, REDACT_MAX };
