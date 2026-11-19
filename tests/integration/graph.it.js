'use strict';
// design-v0.4 section 7, integration: real Claude runs a small build graph end to end through /jspark-forge:build: a
// checker helper step with a declared output, then a gate whose command Claude runs and whose exit code JSPARK Forge
// records. Human steps are left out on purpose: DONE <step> counts only in an attended session
// (CLAUDE_CODE_SESSION_ATTENDED=1), which `claude -p` is not; the unit tests cover them. The trust a user would type is
// written by the test, as the user would have, in the protected trust format: `graph start` records the hash of the
// commands it showed (asked) and TRUST GRAPH moves that same hash to trusted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { project, claude } = require('./lib');

const GRAPH = `# Graph: tiny
## look (agent)
- helper: checker
- gives: readme_path

## gate (gate)
- after: look
- run: node --version
`;

test('a small build graph runs end to end: helper step, then a gate judged by its exit code', { timeout: 900000 }, () => {
  const dir = project('graph', { files: { 'README.md': '# Tiny\n' } });
  fs.mkdirSync(path.join(dir, '.jspark-forge', 'graphs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'graphs', 'tiny.md'), GRAPH);
  // The user's TRUST GRAPH tiny, recorded as the UserPromptSubmit hook would.
  const L = require('../../scripts/lib/graph').parse(GRAPH);
  const runs = L.steps.filter(s => s.kind === 'gate').flatMap(s => s.run);
  const crypto = require('node:crypto');
  fs.writeFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-trust.json'),
    JSON.stringify({ asked: {}, trusted: { tiny: crypto.createHash('sha1').update(runs.join('\n')).digest('hex') } }));
  const r = claude(dir, 'Run the build graph "tiny" with /jspark-forge:build: start it, then follow every step that `graph next` prints until it says the graph finished. For the look step, the checker helper should find the path of README.md and return it as readme_path. Reply with the final `graph status tiny` output.',
    ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Agent,Write,Read,Skill']);
  assert.equal(r.status, 0, r.err);
  const st = JSON.parse(fs.readFileSync(path.join(dir, '.jspark-forge', 'state', 'graph-tiny.json'), 'utf8'));
  assert.equal(st.steps.look.state, 'done', `look: ${JSON.stringify(st.steps.look)}\n${r.out}`);
  // Relative or absolute, it must name this project's README.md.
  assert.equal(path.resolve(dir, st.steps.look.outputs.readme_path).toLowerCase(), path.join(dir, 'README.md').toLowerCase());
  assert.equal(st.steps.gate.state, 'done', `gate: ${JSON.stringify(st.steps.gate)}\n${r.out}`);
  assert.ok(st.finished, 'the run finished');
});
