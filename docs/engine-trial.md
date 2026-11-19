# JSPARK Forge v0.3: code map engine trial

Status: desk research done 2026-11-20 (official repos and docs, GitHub API); nothing installed yet. The hands-on trial on
Windows comes next, with the owner's go-ahead (it installs a third-party program). Spec: [`spec.md`](spec.md) section 5.4
("integrate, don't build"); criteria there.

## Candidates (as of 2026-11-20)

| | codebase-memory-mcp (DeusData) | CodeGraph (colbymchenry) | Graphify | Serena (oraios) |
|---|---|---|---|---|
| Licence | MIT | MIT | Apache-2.0 (check LICENSE; one source said MIT) | GPL-3.0 app (MIT only for its LSP library) |
| Activity | commit 2026-11-19; v0.12.1 2026-10-16 | commit 2026-11-19; v1.6.3 2026-11-17 | commit 2026-11-17; v0.9.112 | commit 2026-11-19; v2.1.0 |
| MCP | yes, 17 tools | yes, one tool by default (more via `CODEGRAPH_MCP_TOOLS`) | optional; a Claude Code skill first | yes |
| Windows | native, `install.ps1`, no compiler; unsigned binary (SmartScreen) | native, `install.ps1`, bundled runtime | Python 3.10+ | not documented; needs uv and language servers |
| Local only | yes; no telemetry stated | yes, but anonymous telemetry on unless `CODEGRAPH_TELEMETRY=0` | code local; docs and images use cloud vision | not stated |
| Index | `~/.cache/codebase-memory-mcp/` (SQLite) | `.codegraph/codegraph.db` per project | `graphify-out/graph.json` | none (live language servers) |
| Refresh | background watcher; `index_status`, `check_index_coverage` | file watcher, 2 s debounce, ~0.3 s per edit; `codegraph status` | `--watch`, post-commit hook | live |
| "What breaks" | `detect_changes` (git diff → affected symbols), `trace_path` | `codegraph_explore` (call paths, impact) | `path`, `explain` | references only |
| SQL / Prisma | grammars listed; tables as graph nodes unverified | not mentioned | not mentioned | no |

## Ranking against spec 5.4

1. **codebase-memory-mcp**: MIT, native Windows without a compiler, no telemetry, the full query set (`search_graph`,
   `trace_path`, `detect_changes`, `get_architecture`, `get_file_outline`), and the only first-class freshness API
   (`index_status`, `check_index_coverage`). Watch: it has `manage_adr`, which overlaps with decision memory (v0.2).
2. **CodeGraph**: fastest refresh and a staleness banner; telemetry must be switched off; single default tool.
3. Graphify (skill-first, cloud vision for documents). 4. Serena (GPL application: never bundled).

## What JSPARK Forge needs from the engine (v0.3 design input)

- **Detection:** the engine's MCP entry or binary; none found → map features off, everything else works (spec 5.4).
- **"As of <commit>":** no engine records the commit its index was built from. JSPARK Forge records `HEAD` itself when a
  refresh finishes and compares it with the current `HEAD`; it also asks the engine's own status (`index_status`,
  `check_index_coverage`; CodeGraph: pending files).
- **Schema layer:** keep JSPARK Forge's own small reader for SQL migrations and Prisma; it is unproven that either engine
  turns tables and relations into nodes.
- **Decisions layer:** a map answer about a file lists the decisions that touch it (v0.2 `Touches:` matching).

## Not verified yet (the hands-on trial checks these)

The exact install line into Claude Code for each; real Windows install and first index time on a ~50k-line repo;
incremental refresh time after an edit and after a commit; index size; whether SQL and Prisma become tables and
relations; codebase-memory-mcp's daemon behaviour; Serena on Windows.
