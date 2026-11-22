# Graph: spike
- max_parallel: 1

<!-- A spike that gates a task: measure, decide, then build only if the decision says so. /jspark-forge:build copies it to .jspark-forge/graphs/<name>.md; then change the title to "# Graph: <name>". Builders commit their step's work on the current branch (no merge, no push): the review step needs those commits. -->
<!-- Optional: "- lock: <name>" here lets this graph run beside graphs that carry another lock name. With no lock line it runs alone: its helper steps and checks never overlap another graph's (use that when test runs share a database). -->

## measure (agent)
- helper: checker
- brief: .jspark-forge/briefs/measure.md
- gives: findings_path

## decide (human)
- after: measure
- say: Read the findings and reply DONE decide to build, or stop the graph if the spike says no.

## build (agent)
- helper: builder
- after: decide
- needs: findings_path
- brief: .jspark-forge/briefs/build.md
- gives: commit

<!-- Set this to the project's own test command (pnpm test, yarn test, pytest, go test ./..., …) before you trust the graph. -->
## gate (gate)
- after: build
- run: npm test
