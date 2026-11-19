# Learnings 2026-11-07: a multi-model review council, and a work dashboard computed from git

Source: code review of two small public repos by Andrej Karpathy (llm-council: a three-stage "several models answer, rank each other, a chair writes the final"; gitstats: a git-derived summary page). Ideas only, no dependency; both have real pitfalls that became the rules below.

## Review gate, council mode (for high-stakes reviews: security, go-live)
| # | Rule | Test |
|---|---|---|
| C1 | Shuffle the labels of the answers per evaluator; never a fixed order | same inputs, two runs, different label orders |
| C2 | No reviewer ranks its own answer | no evaluator sees a label that maps to itself |
| C3 | The chair (decider) is not a voter and gets the label-to-model map; it refuses unmapped labels | the chair prompt holds every label with its author |
| C4 | A ranking counts only if it lists every label exactly once; a verdict needs a quorum (2 of 3 clean); a failed chair never stores a placeholder as the verdict | a ranking with a missing label is discarded; 1 of 3 clean blocks the verdict |
| C5 | Aggregate = mean position over complete rankings only; store the label map, each ranking and the aggregate with the verdict; fixed seed/temperature; bounded retry; per-call timeout; atomic writes | reload shows the same rankings; a second run reproduces the aggregate |

## Dashboard, "what was built" from git alone (spec 5.8)
| # | Rule | Test |
|---|---|---|
| G1 | Escape every commit field (message, author, email) before rendering | a message holding an img onerror renders as text |
| G2 | Count each SHA once; attribute it to the first ref that reaches it; bucket by authored date; draw the newest commit | a commit on two branches appears once; the max-date commit is drawn |
| G3 | A time window on authored date; an explicit, configurable "substantial" threshold (lines changed); contributor key = email local part; per-file numstat; one diff per commit, cached | window of N days returns only those; threshold change moves a commit in/out |
| G4 | Quote every link; vendor or pin third-party scripts; no CDN fonts (offline first) | page renders with the network off |
| G5 | Guard degenerate cases (one timestamp, empty window) with a plain message | no crash on a one-commit repo |
Plus the kit's own groupings: commits per task label, per day, per model (from the ledger), with test-run ids beside each.

## Also kept from the earlier files (nanochat skill, autoresearch program)
Skill template: name + trigger description; numbered parts each input -> action -> output path; skip-if-exists; non-overwriting output names; a verification step. Brief template: CAN/CANNOT file lists; one definition of done; a setup handshake; a fixed-schema append log; bounded retries; simplicity tie-break. Never "never stop": every loop has a stop condition and a human gate.
