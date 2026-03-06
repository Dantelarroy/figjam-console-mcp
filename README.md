# FigJam Console MCP

A deterministic MCP server for managing FigJam boards programmatically.

## Overview

FigJam Console MCP provides a stable MCP runtime for creating, querying, and organizing FigJam boards through explicit, deterministic tool contracts.

This repository is focused on:
- FigJam bridge + WebSocket connectivity,
- deterministic execution and capability guarding,
- workflow and research-board operations on top of board primitives,
- spec-driven delivery with contract and smoke validation.

## Key Capabilities

### Infrastructure
- FigJam bridge plugin (`figjam-desktop-bridge`)
- WebSocket ↔ MCP server runtime
- Capability guard based on `editorType`

### Board primitives
- `createSticky`
- `createConnector`
- `createText`
- `createSection`
- `getBoardNodes`
- `getStickies`
- `getConnections`

### Workflow tools
- `bulkCreateStickies`
- `findNodes`
- `createCluster`
- `summarizeBoard`
- `autoLayoutBoard`

### Research workspace tools
- `ingestResearchNotes`
- `createReferenceWall`
- `organizeByTheme`
- `linkByRelation`
- `generateResearchBoard`

## Tool Catalog (What Each Tool Does)

### Connection and runtime

| Tool | What it does |
|---|---|
| `figjam_get_status` | Returns bridge/server connection status, active file info, and health summary. |
| `figjam_list_open_files` | Lists currently connected FigJam files through the bridge. |
| `figjam_set_active_file` | Sets the active connected file for subsequent tool execution. |

### Board primitives

| Tool | What it does |
|---|---|
| `createSticky` | Creates a sticky note (`text`, optional position/size). |
| `updateSticky` | Updates sticky content and/or geometry by `nodeId`. |
| `deleteSticky` | Deletes a sticky by `nodeId`. |
| `createShape` | Creates `rectangle`, `circle`, or `diamond` (optional text). |
| `createConnector` | Creates a connector between `fromNodeId` and `toNodeId`. |
| `createText` | Creates a text node with optional position/font size. |
| `createSection` | Creates a section container in the board. |
| `getBoardNodes` | Returns all board nodes for the active page. |
| `getStickies` | Returns sticky-only subset of board nodes. |
| `getConnections` | Returns connector-only subset of board nodes. |

### Workflow tools (deterministic composition)

| Tool | What it does |
|---|---|
| `bulkCreateStickies` | Batch-creates many stickies using deterministic placement (`as_provided`/`grid`). |
| `findNodes` | Finds nodes by exact filters/query, bbox, sort, pagination. |
| `createCluster` | Creates a titled cluster (section/title/stickies) and optional sequential connectors. |
| `summarizeBoard` | Returns structural counts/connectivity summary (no AI inference). |
| `autoLayoutBoard` | Repositions target nodes with deterministic modes (`grid`, `compact`, `swimlanes`). |

### Research workspace tools (deterministic)

| Tool | What it does |
|---|---|
| `ingestResearchNotes` | Ingests structured research notes into stickies with deterministic formatting/placement. |
| `createReferenceWall` | Builds grouped references wall (by kind or single-grid) with stable layout rules. |
| `organizeByTheme` | Creates theme clusters from explicit refs/queries (no semantic inference). |
| `linkByRelation` | Creates connectors between explicit node refs/queries with dedupe options. |
| `generateResearchBoard` | End-to-end deterministic scaffold: sections + notes + references + optional links/layout. |

### Upstream compatibility surface (guarded)

This repository keeps broad upstream MCP tool parity for compatibility.  
In a FigJam runtime, tools that require Figma Design-only capabilities are registered but blocked by the capability guard and return a structured `CAPABILITY_NOT_SUPPORTED` error (instead of mutating data incorrectly).

Representative blocked families in FigJam:
- variables/tokens tools (`figma_get_variables`, variable CRUD, modes/collections)
- components/instances tools
- design-system extraction/audit tools
- design-code parity/doc generation tools that depend on Design-only data

## Architecture

Main layers:

1. MCP server layer
   - Local entrypoints in `src/local.ts` and `src/figjam-local.ts`
   - Tool registration in `src/server/`

2. Bridge and transport layer
   - Plugins in `figjam-desktop-bridge/` and `figma-desktop-bridge/`
   - Runtime transport/state in `src/core/websocket-server.ts`

3. Tooling layer
   - Primitives in `src/tools/`
   - FigJam API wrapper in `src/figjam-api/figjamClient.ts`

4. Workflow and research layers
   - Workflow tools in `src/tools/workflows.ts`
   - Research tools in `src/tools/research-workspace.ts`

5. Next architecture milestone
   - DBI v1 deterministic board indexing (stable identity, metadata, alias-based resolution)

## Repository Structure

```text
src/
  core/                    # transport, connector, capability guard, shared runtime
  tools/                   # primitives + workflow + research workspace tools
  server/                  # server setup and tool registration
  figjam-api/              # FigJam client wrapper
tests/                     # contract, integration, policy, and regression tests
docs/
  agent-playbooks/         # spec-driven process templates
figjam-desktop-bridge/     # FigJam bridge plugin
figma-desktop-bridge/      # shared bridge runtime support
```

## Quick Start

### Install dependencies

```bash
npm install
```

### Run FigJam MCP server

```bash
npm run dev:figjam
```

### Connect the FigJam bridge

1. Open FigJam Desktop.
2. Import `figjam-desktop-bridge/manifest.json` as a development plugin.
3. Run the plugin in your board.
4. Confirm WebSocket handshake (`GET_FILE_INFO`) and active connection.

### Run tests

```bash
npm test
```

## How To Use This MCP (Detailed)

### 1. Start the server

```bash
npm run dev:figjam
```

Default bridge endpoint: `ws://localhost:9323`.

### 2. Connect a live FigJam board

1. Open a FigJam board in Figma Desktop.
2. Run the development plugin from `figjam-desktop-bridge/manifest.json`.
3. Keep the plugin window open.
4. Confirm handshake in logs:
   - plugin sends `GET_FILE_INFO`
   - server shows file connected (`connectedFiles: 1`)

### 3. Connect from your MCP client

Use your MCP client (Codex/Claude) against this repository server process.

For clients that use local commands, point to:

```bash
npm run dev:figjam
```

For clients that use WebSocket bridge status, use:

```text
ws://localhost:9323
```

#### Claude Desktop (stdio MCP)

Edit Claude Desktop config:

`~/Library/Application Support/Claude/claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "figjam-console-mcp": {
      "command": "npm",
      "args": ["run", "dev:figjam"],
      "cwd": "/absolute/path/to/figjam-console-mcp"
    }
  }
}
```

Then restart Claude Desktop.

#### Codex CLI (stdio MCP)

From anywhere:

```bash
codex mcp add figjam-console-mcp -- \
  /bin/zsh -lc 'cd /absolute/path/to/figjam-console-mcp && npm run dev:figjam'
```

To verify:

```bash
codex mcp list
```

### 4. Run a minimal smoke sequence

Run these calls in order once the bridge is connected:

1. `figjam_get_status`
2. `createSticky`
3. `createShape`
4. `createConnector`
5. `getBoardNodes`

Expected behavior:
- status reports active connection,
- created nodes appear in the board,
- read tools return the created nodes.

### 5. Use higher-level deterministic workflows

After primitive validation, use workflow layers:

- Workflow tools:
  - `bulkCreateStickies`
  - `findNodes`
  - `createCluster`
  - `summarizeBoard`
  - `autoLayoutBoard`
- Research workspace tools:
  - `ingestResearchNotes`
  - `createReferenceWall`
  - `organizeByTheme`
  - `linkByRelation`
  - `generateResearchBoard`

## Development Workflow

This repository follows a spec-driven process:

- `AGENTS.md`
- `docs/agent-playbooks/spec-driven-workflow.md`
- `docs/agent-playbooks/milestone-template.md`
- `docs/agent-playbooks/validation-template.md`
- `docs/agent-playbooks/change-request-template.md`

Default phase order:

`validate -> analyze -> specify -> plan -> implement -> validate`

## Roadmap

Source of truth: Notion Kanban `FigJam Console MCP — Product Roadmap`  
https://www.notion.so/31b2c91486408127a4f6cb425e1a3f2c

### Completed

- `Epic: Infrastructure Stabilization and Guard Layer` (P0/P1)
  - Bridge connection model stabilized (`GET_FILE_INFO`, active file resolution)
  - Capability guard implemented (`editorType`) with standardized `CAPABILITY_NOT_SUPPORTED`
  - Guard coverage tests and policy audit added
- `Epic: Workflow Tools v1` (P1)
  - `bulkCreateStickies`, `findNodes`, `createCluster`, `summarizeBoard`, `autoLayoutBoard`
- `Epic: Research Workspace Tools v1` (P1)
  - `ingestResearchNotes`, `createReferenceWall`, `organizeByTheme`, `linkByRelation`, `generateResearchBoard`
- `Epic: Documentation and Onboarding` (P1/P2)
  - MCP setup docs, tool catalog, and repo-local agent playbooks

### In Progress

- `Epic: DBI v1 Implementation` (P0)
  - `DBI v1 Phase 1 — Indexing and Metadata`
  - Active subtasks include:
    - pluginData metadata helpers
    - `figjam_index_board` and `getBoardIndex`
    - deterministic cache and ordering guarantees

### Next

- `DBI v1 Phase 2 — Upsert and Alias Resolution` (P0/P1)
  - Implement `figjam_upsert_artifact` with deterministic target/create/patch precedence
  - Add alias collision handling and stable alias resolution helpers
  - Integrate DBI metadata writes into node creation paths
- `Epic: Reliability and Observability` (P1)
  - production smoke matrix + automation harness
  - pass/fail reporting with raw MCP payload references

### Backlog

- `DBI v1 Phase 3 — Organization + Validation` (P1)
  - move organization flows to DBI source-of-truth resolution
  - alias-first relation/organization paths
  - screenshot checks as complementary visual QA (not source-of-truth)
- `Epic: Screenshot Validation Layer` (P2)
  - optional visual verification artifacts after deterministic board mutations
- `Epic: Repo Cleanup and Productization` (P2)
  - release checklist, quality gates, and rebase-safe release process

### Blocked

- `Task: Confirm release branch/tag policy for production milestones` (P2)
  - dependency: explicit decision on release cadence and ownership

### DBI v1 Target Sequence

1. Phase 1: deterministic board index + metadata schema + cache + contract tests.
2. Phase 2: upsert + alias resolution + metadata writes on creation paths.
3. Phase 3: DBI-driven organization tools + screenshot validation as secondary safety layer.

## License

MIT — see [LICENSE](LICENSE).
