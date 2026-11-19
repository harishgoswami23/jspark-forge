# Graph: spike
- max_parallel: 1

<!-- A spike that gates a task: measure, decide, then build only if the decision says so. Copy with /jspark-forge:new-graph spike <name>. -->

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

## gate (gate)
- after: build
- run: npm test
