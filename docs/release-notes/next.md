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

## Fixed: a trust message is never lost in silence

`TRUST GRAPH <name>` used to do nothing, and say nothing, when it was sent before `graph start` had asked for it.

- Sent early, for a graph that exists and is valid: the graph is trusted as it is now, and you are shown the
  commands, checks and human steps you just trusted.
- A graph that does not exist or is not valid: one line says so.
- Close but not exact (a missing letter, a full stop, extra words): nothing is trusted, and you are told the exact
  text to send.
- Spaces before or after the message are fine.
- Unchanged: if the commands changed after `graph start` showed them, the trust is refused and you are asked to look
  again.

## New: a second graph can run while the first waits for you

`graph start` used to refuse a new graph while another one was open, even when that one was only waiting for you.

- A graph that is waiting at a human step no longer blocks another graph from starting or running.
- Helper steps and checks of two graphs still never run at the same moment. A step that has to wait is "not
  started", nothing fails, and you are told which graph and step it waits for.
- To say two graphs are safe to run side by side, give each a header line with a different name, for example
  `- lock: database` in one and `- lock: docs` in the other. Graphs with the same lock name wait for each other. A
  graph with no lock line runs alone, as before. Adding or changing the line needs your `TRUST GRAPH` again.
- `graph status` with no name lists every open graph and what each is waiting for.
- The session-start summary and the handoff name every open graph.
- `DONE <step>` works as before when one graph waits at that step. When two graphs wait at a step with the same
  name, you are asked to send `DONE <graph> <step>`; nothing is completed on a guess.

## Smaller changes

- **Status words mean one thing each.** "running" is said only while a process JSPARK Forge started is alive.
  A check that was handed out and that nobody is running is "waiting to be run". A check whose command was stopped
  before it ended (by hand, by the time limit of one tool call, or because the check runner was killed) is
  "interrupted": nothing is recorded as failed, and it runs again. A check is "failed" only on a real exit code. A
  helper step that was handed out is "handed to a helper".
- **A step is named once.** A step called `gate` of kind gate (as in the templates) reads "Step gate failed", not
  "Step gate (gate) failed". Other steps keep their kind: "Step checks (gate)".
