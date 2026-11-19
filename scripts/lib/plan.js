'use strict';
// A checkbox plan file ("- [ ] step" / "- [x] step") as the source of Task / Step n of m / Next
// (design 16, deviation 7: this Claude Code version has no todo tool by default).

const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/;
const TASK = /^#{2,4}\s+Task\s+(\d+)\s*[:.]\s*(.*?)\s*$/; // superpowers: "### Task N: [Component Name]"

function clean(s) {
  return s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function parsePlan(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  const tasks = [];
  let title = null;
  for (const line of lines) {
    if (title === null) { const h = line.match(/^#\s+(.+?)\s*$/); if (h) title = clean(h[1]); }
    const t = line.match(TASK);
    if (t) tasks.push({ n: Number(t[1]), title: clean(t[2]) });
    const m = line.match(BOX);
    if (m) items.push({ done: m[1] !== ' ', text: clean(m[2]) });
  }
  if (items.length < 2) return null;
  const done = items.filter(i => i.done).length;
  const firstOpen = items.findIndex(i => !i.done);
  return {
    title,
    total: items.length,
    done,
    stepIndex: firstOpen < 0 ? items.length : firstOpen + 1,
    next: firstOpen < 0 ? null : items[firstOpen].text,
    tasks,
  };
}

module.exports = { parsePlan };
