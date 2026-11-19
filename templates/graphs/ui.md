# Graph: ui
- max_parallel: 1

<!--
A screen or feature with a user interface, built so it is designed, approved, built, checked in a browser and reviewed.
Before running it, install the companions JSPARK Forge names in projects with a front end (frontend-design, Playwright
MCP, and shadcn for React), and fill in the product's brand skill (templates/brand-skill.md).
The screenshot check needs a Playwright test at tests/ui/<name>.spec.ts that opens the screen and compares it with the
approved look (toHaveScreenshot), plus `npx playwright install` once.
-->

## direction (agent)
- helper: planner
- brief: .jspark-forge/briefs/ui-direction.md
- gives: direction_path

## approve-look (human)
- after: direction
- say: Open the design direction (and any mockup it links), check it against your brand, and reply DONE approve-look when the look is right; ask for changes first if not.

## build (agent)
- helper: builder
- after: approve-look
- needs: direction_path
- brief: .jspark-forge/briefs/ui-build.md
- gives: ui_commit

## screens (gate)
- after: build
- run: npx playwright test tests/ui

## design-review (agent)
- helper: reviewer
- after: screens
- needs: direction_path, ui_commit
- brief: .jspark-forge/briefs/ui-review.md
- gives: review_path

## approve-ui (human)
- after: design-review
- say: Read the design review, open the screens yourself, and reply DONE approve-ui to accept the UI.
