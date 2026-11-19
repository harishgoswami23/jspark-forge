---
name: upgrade
description: Use when the user runs /jspark-forge:upgrade to update JSPARK Forge to the latest version.
disable-model-invocation: true
---
Update JSPARK Forge. Its project files (.jspark-forge/) and the user's settings are not touched by an update.

1. Say in one line: "This updates JSPARK Forge (and superpowers with it) from the JSPARK Forge marketplace. Go ahead? (yes / no)"
   and wait. Stop on anything but yes.
2. Run `claude plugin marketplace update jspark-forge`, then `claude plugin update jspark-forge@jspark-forge`.
   Show any error as it is and stop.
3. Tell the user in two lines: the update applies after Claude Code restarts; after the restart, run
   /jspark-forge:doctor to check it.
