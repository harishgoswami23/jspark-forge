# Graph: software
- max_parallel: 2
- min_free_memory_mb: 1500

<!-- A feature from spec to release. Copy with /jspark-forge:new-graph software <name>, then edit the briefs and checks. -->

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
