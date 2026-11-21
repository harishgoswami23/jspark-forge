# Graph: software
- max_parallel: 2

<!-- A feature from spec to release. /jspark-forge:build copies it to .jspark-forge/graphs/<name>.md; then change the title to "# Graph: <name>" and edit the briefs and checks. Builders commit their step's work on the current branch (no merge, no push): the review step needs those commits. -->

## spec (agent)
- helper: planner
- brief: .jspark-forge/briefs/spec.md
- gives: spec_path

## plan (agent)
- helper: planner
- needs: spec_path
- brief: .jspark-forge/briefs/plan.md
- gives: plan_path

## approve-plan (human)
- after: plan
- say: Read the plan and reply DONE approve-plan when it is right (or ask for changes first).

## build-core (agent)
- helper: builder
- after: approve-plan
- needs: plan_path
- brief: .jspark-forge/briefs/build-core.md
- gives: core_commit, core_tests

## build-ui (agent)
- helper: builder
- after: approve-plan
- needs: plan_path
- brief: .jspark-forge/briefs/build-ui.md
- gives: ui_commit

## tasks (parallel)
- steps: build-core, build-ui

<!-- Optional, for a long run (remove what you do not need):
     "- before: free memory 4 GB", "- before: port 5432 open", "- before: container app-db running": checked before the
     check starts, so it does not fail late.
     "- retry: <your test tool's command that runs only what failed>" (for example "npx playwright test --last-failed"
     or "pytest --lf"): a failing run then repeats only what failed, and the full command must pass once more. -->
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
