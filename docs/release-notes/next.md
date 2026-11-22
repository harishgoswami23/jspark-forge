# JSPARK Forge: next release (not released yet)

*Build graphs that keep going while you are away.*

Changes made after v0.7.0. The version number and the date are set at release.

## Where this came from

Running JSPARK Forge on another project: a build stopped for hours at a plan approval because nobody was there, a
typed trust message was lost without a word, and a small trial graph could not run while the main build waited.

## New: approve a human step ahead of time

You can give your decision on a human step before the build gets to it, so the build does not stop and wait.

- Send this as your whole message: `APPROVE AHEAD <graph> <step>`
- It is accepted when the graph is valid, you have trusted it, and the step is a human step the build has not
  reached yet.
- When the build reaches the step, it is completed by itself. The record says "approved ahead by the person at
  <time>" and shows the step's instruction, so it is clear what was approved without being read at the time.
- A step marked `- ahead: no` in the graph file can never be approved ahead. The templates mark every release step
  this way; plan approvals and spike decisions can be approved ahead.
- The approval is cancelled, and you are told, if the graph's steps change or the run is stopped.
- Withdraw it with `CANCEL APPROVAL <graph> <step>`.
- `graph status <name>` shows which steps are approved ahead.
- Only your own typed message counts. Claude and its helpers cannot give this approval: a sentence that contains the
  words, a quotation in a helper's report, text in a file or a command do not count.
- `DONE <step>` sent too early now tells you about `APPROVE AHEAD`.

JSPARK Forge still never decides a human step. You decide; it records that you decided early.
