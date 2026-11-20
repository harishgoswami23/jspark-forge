'use strict';
// The model map (spec 5.12, design-v0.2 section 4): rules/model-tiers.json names the tiers and their models; each
// helper file in agents/ names its model. Read-only helpers for lint and for the tier shown when a helper starts.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HELPERS = ['builder', 'checker', 'planner', 'reviewer']; // JSPARK Forge's own four
const PREFIX = 'jspark-forge:';

function tiers() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'model-tiers.json'), 'utf8')) || {}; } catch { return {}; }
}
const tierNames = () => Object.keys(tiers());
const models = () => Object.values(tiers()).map(t => t && t.model).filter(Boolean);

// The `model:` value of an agent file's frontmatter, or null.
function modelOfText(text) {
  const m = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const l = m && m[1].split(/\r?\n/).map(x => x.match(/^model:\s*(.*?)\s*$/)).find(Boolean);
  return l ? l[1] : null;
}

// "jspark-forge:builder" -> "standard" (the tier whose model the helper's file names); anything else -> null.
function tierOfAgent(type) {
  const t = String(type || '');
  if (!t.startsWith(PREFIX) || !HELPERS.includes(t.slice(PREFIX.length))) return null;
  try {
    const model = modelOfText(fs.readFileSync(path.join(ROOT, 'agents', `${t.slice(PREFIX.length)}.md`), 'utf8'));
    return tierNames().find(n => tiers()[n].model === model) || null;
  } catch { return null; }
}

module.exports = { tiers, tierNames, models, modelOfText, tierOfAgent, HELPERS };
