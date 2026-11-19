# Graph: documents
- max_parallel: 1

<!-- A document from research to publication. Copy with /jspark-forge:new-graph documents <name>. -->

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
- say: Read the final document and publish it, then reply DONE publish.
