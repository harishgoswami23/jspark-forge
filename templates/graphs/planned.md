# Graph: planned
- max_parallel: 2

<!-- A build whose spec and plan are already written. No spec or plan step: each build brief names the plan file and the tasks it covers. /jspark-forge:build copies it to .jspark-forge/graphs/<name>.md; then change the title to "# Graph: <name>" and edit the briefs and checks. For work with no plan yet, use the software template. Builders commit their step's work on the current branch (no merge, no push): the review step needs those commits. -->

## approve-plan (human)
- say: Check that the plan named in the build briefs is the one to build, and which of its tasks this run covers. Reply DONE approve-plan when it is right (or ask for changes first).

## build-core (agent)
- helper: builder
- after: approve-plan
- brief: .jspark-forge/briefs/build-core.md
- gives: core_commit, core_tests

## build-ui (agent)
- helper: builder
- after: approve-plan
- brief: .jspark-forge/briefs/build-ui.md
- gives: ui_commit

## tasks (parallel)
- steps: build-core, build-ui

<!-- Set this to the project's own test command (pnpm test, yarn test, pytest, go test ./..., …) before you trust the graph. -->
## gate (gate)
- after: tasks
- run: npm test

## review (agent)
- helper: reviewer
- after: gate
- needs: core_commit, ui_commit
- gives: verdict

## release (human)
- after: review
- say: Read the review, merge the branch into main and tag the release, then reply DONE release.
