# Graph: documents
- max_parallel: 1

<!-- A document from research to publication. /jspark-forge:build copies it to .jspark-forge/graphs/<name>.md; then change the title to "# Graph: <name>". Builders commit their step's work on the current branch (no merge, no push): the review step needs those commits. -->
<!-- Optional: "- lock: <name>" here lets this graph run beside graphs that carry another lock name. With no lock line it runs alone: its helper steps and checks never overlap another graph's (use that when test runs share a database). -->

## research (agent)
- helper: planner
- brief: .jspark-forge/briefs/research.md
- gives: notes_path

## draft (agent)
- helper: builder
- needs: notes_path
- brief: .jspark-forge/briefs/draft.md
- gives: draft_path

## review (agent)
- helper: reviewer
- needs: draft_path
- gives: review_notes

## final (agent)
- helper: builder
- needs: draft_path, review_notes
- gives: final_path

## publish (human)
- after: final
- ahead: no
- say: Read the final document and publish it, then reply DONE publish.
