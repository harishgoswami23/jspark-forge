<!--
JSPARK Forge brief template. One job for one helper. Copy to .jspark-forge/briefs/<name>.md, then replace the example.
Keep the fields in this order. Run `forge.js lint` on the file before you hand it over.

- Goal: one sentence.
- CAN change: the files the helper may change, as globs.
- CANNOT change: the files it must not touch, as globs.
- Done: one definition of done, or one named metric with a direction ("p95_ms, lower wins").
- Setup: what to read and check first, then wait for "go" before any autonomous work (optional).
- Log: a fixed-schema, append-only table; rows are never reset or rewritten (optional).
- Retries: a number; after that many retries, log and skip (default 2, optional).
- Tie-break: when two versions pass, the simpler one wins (optional).
- Stop: an explicit stop condition (attempts, budget or time) plus a human gate. Never "never stop".
- Outputs: the fields the next step consumes, as a comma list of names (optional).
-->
Goal: make the import step idempotent.
CAN change: src/import/**, tests/import/**
CANNOT change: src/db/schema.*, scripts/measure-import, package manifests
Done: tests/import pass and `scripts/measure-import` reports duplicates = 0
Setup: read docs/plans/import.md; run the test suite once; report the baseline; wait for "go"
Log: .jspark-forge/briefs/import-idempotent.tsv (attempt, commit, duplicates, status keep|discard|crash, note)
Retries: 2, then log and skip
Tie-break: simpler wins
Stop: after 3 kept attempts or 90 minutes; hand back and wait
Outputs: commit, test_totals, leftovers
