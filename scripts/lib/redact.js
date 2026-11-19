'use strict';
// Replace likely secrets with ‹redacted› before anything is written (design section 6).
// Imperfect by nature: the log never leaves the machine and is git-ignored.

const R = '‹redacted›';

const PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,                              // OpenAI / Anthropic-style keys
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,                      // GitHub fine-grained tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                        // GitHub classic tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                                // AWS access key ids
  /\bxox[bpas]-[A-Za-z0-9-]{6,}/g,                        // Slack tokens
];

// Keep the label, hide the value.
const LABELLED = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi,
  /(\b(?:password|passwd|pwd|token|secret|api[_-]?key)\s*=\s*)[^\s&;'"]+/gi,
  /((?:^|\s)(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(?=\S)(?!ort\b)[^\s'"]+/gi, // mysql -p<password>
];

const MIN_EXTRA = 6; // shorter .env values would mask ordinary words

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function redact(text, extra = []) {
  let s = String(text);
  for (const v of extra) {
    if (typeof v === 'string' && v.length >= MIN_EXTRA) s = s.replace(new RegExp(escapeRe(v), 'g'), R);
  }
  for (const re of PATTERNS) s = s.replace(re, R);
  for (const re of LABELLED) s = s.replace(re, `$1${R}`);
  return s;
}

module.exports = { redact, R };
