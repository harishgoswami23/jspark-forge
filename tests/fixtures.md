# Test fixtures

| Fixture | Used by | Source | Licence | Size |
|---|---|---|---|---|
| fastify v4.28.1, commit `94068edf593534d9c1b6b4edf71ecd55ff4b3124` | kill-and-resume ship-gate test (`tests/integration/kill-resume.it.js`) | https://github.com/fastify/fastify (shallow clone of the tag) | MIT | 68,137 lines of JS/TS, 371 files |

The fixture is cloned into a temporary folder by the test, never committed here, and none of its code is installed
or run (no `npm install`): Claude only reads and writes plain files in it.
