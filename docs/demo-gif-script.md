# Demo GIF: kill a session mid-task, reopen, carry on

The one thing a stranger needs to see. About 30 seconds. No voice, no music. The words on screen do the work.

**File to make:** `assets/demo-resume.gif` (README slot is ready: see "After recording").

## What it must show

One idea only: *the window closed in the middle of the work, and nothing had to be explained again.*
Not the block list, not decisions, not build graphs.

## Set up before recording (5 minutes)

1. A small throwaway project, so nothing private is on screen:
   - a new folder, `git init`, one file, one commit;
   - JSPARK Forge installed (it is, if Claude Code has it).
2. Terminal: font size 18 or larger, window about 100 columns by 28 lines, a dark theme, nothing else on screen.
3. Hide anything personal: the folder path should be short (for example `C:\demo\invoice-app`), no email or account
   name in the status line.
4. A recorder that makes a GIF: ScreenToGif (Windows, free) is enough. Record the terminal window only.

## The shots

| # | Seconds | What you do | What the viewer sees |
|---|---|---|---|
| 1 | 0–6 | In Claude Code, type: `Add a monthly totals report to the invoice app. Start with the data function, then the page.` | Claude starts work and edits a file or two. |
| 2 | 6–10 | While Claude is still working, close the terminal window (the X button). | The window disappears mid-task. This is the "kill". |
| 3 | 10–13 | Open a new terminal in the same folder and type `claude`. | A fresh session. |
| 4 | 13–20 | Wait. Do not type. | JSPARK Forge's line: *last time you were on "Add a monthly totals report…", step …. Say 'continue' or tell me what to do instead.* |
| 5 | 20–23 | Type: `continue` | |
| 6 | 23–30 | Wait. | Claude says in a few lines where the work stood, checks what was half done, and goes on with the next file. |

Stop the recording as soon as Claude starts the next edit. The last frame should hold for 2 seconds.

## Captions (add in the recorder, one at a time, bottom of the frame)

- Shot 2: **The window closes mid-task.**
- Shot 4: **New session. Nothing explained again.**
- Shot 6: **It carries on from the same step.**

## Rules for the edit

- Cut the waiting: speed up or trim the seconds where nothing moves, so the whole thing is 30 seconds or less.
- Under 5 MB, about 900 pixels wide, 10 frames a second is enough.
- No zoom effects, no cursor highlights.
- Check every frame for a path, name, email or key before saving.

## After recording

1. Save the file as `assets/demo-resume.gif`.
2. Tell Claude "the demo GIF is in assets". Claude then switches on the line in `README.md` that is waiting for it
   (line 23, now a comment) and checks it shows on GitHub.

## If the take goes wrong

- **Claude finishes before you close the window:** give it a longer task, or close sooner. The point is "mid-task".
- **No JSPARK Forge line at the new start:** the session was closed before anything was saved. Let Claude edit at
  least one file before closing.
- **It asks "Continue?" a second time after you typed `continue`:** that is the bug v0.6.2 fixed. Check the plugin
  version with `/jspark-forge:doctor` and tell Claude: this recording is also the real test of that fix.
