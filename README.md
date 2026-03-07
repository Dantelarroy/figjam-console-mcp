# FigJam Console MCP

A deterministic MCP server for managing FigJam boards programmatically.

## Overview

FigJam Console MCP provides a stable MCP runtime for creating, querying, and organizing FigJam boards through explicit, deterministic tool contracts.

This repository is focused on:
- FigJam bridge + WebSocket connectivity,
- deterministic execution and capability guarding,
- workflow and research-board operations on top of board primitives,
- spec-driven delivery with contract and smoke validation.

## Product Purpose (Source of Truth)

This MCP is a **visual state layer** for an AI agent working with FigJam.

- The agent does research, analysis, web browsing, screenshot capture, and strategy.
- This MCP renders that output into FigJam, reads structured board state, and organizes it deterministically.

In short:
- agent decides,
- MCP render/read/organize,
- FigJam stores live visual state.

### What the MCP does not do

By design, this MCP does **not**:
- perform web research on its own,
- scrape or summarize external sources on its own,
- do semantic clustering autonomously,
- decide creative/research strategy autonomously.

Those responsibilities stay in the agent layer. This MCP only executes deterministic board operations.

## Key Capabilities

### Infrastructure
- FigJam bridge plugin (`figjam-desktop-bridge`)
- WebSocket ↔ MCP server runtime
- Capability guard based on `editorType`

### Board primitives
- `createSticky`
- `createLink` (native card preview)
- `captureWebImage`
- `insertLocalImage`
- `createImageReference`
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

### DBI tools
- `figjam_index_board`
- `getBoardIndex`
- `figjam_upsert_artifact`
- `figjam_organize_by_alias`
- `figjam_validate_board_index`

### Visual state tools
- `figjam_render_reference_card`
- `figjam_render_reference_set`
- `figjam_read_board_state`
- `figjam_get_artifact_collection`
- `figjam_relocate_artifacts`
- `figjam_delete_artifacts`
- `figjam_bulk_upsert_artifacts`
- `figjam_get_board_graph`
- `figjam_move_collection`
- `figjam_archive_collection`
- `figjam_apply_layout_to_collection`
- `figjam_export_board_snapshot`
- `figjam_import_reference_bundle`

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
| `createLink` | Creates a native `LINK_UNFURL` card when rich metadata is available; otherwise falls back deterministically to a grouped reference card (clickable native link title + screenshot preview). |
| `captureWebImage` | Captures a deterministic web screenshot to local disk (`selector`, ordered `selectors`, or explicit clip). |
| `insertLocalImage` | Inserts a local image file (`png/jpg/jpeg/webp`) into FigJam as deterministic artifact with optional alias/metadata. |
| `createImageReference` | Creates a structured image-reference artifact (image + deterministic metadata/alias for retrieval workflows). |
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

### DBI v1 tools (deterministic board state layer)

| Tool | What it does |
|---|---|
| `figjam_index_board` | Builds a deterministic board index snapshot (artifacts/containers/connectors, aliases, collisions, metadata). |
| `getBoardIndex` | Returns cached index when available (`refresh=false`) or rebuilds fresh (`refresh=true`). |
| `figjam_upsert_artifact` | Deterministic create/update by `nodeId` or alias with explicit precedence (`target` > `create`) and structured errors. |
| `figjam_organize_by_alias` | Moves artifacts by alias using deterministic layout (`grid`/`column`) and optional metadata updates (`groupId`/`containerId`). |
| `figjam_validate_board_index` | Validates index integrity (required aliases, collisions, connector endpoints) and returns deterministic visual validation targets. |

### Visual state tools (render/read/organize/serialize)

| Tool | What it does |
|---|---|
| `figjam_render_reference_card` | Renders one deterministic reference artifact (native link card, fallback link+image, or fallback sticky) plus optional note and connector. |
| `figjam_render_reference_set` | Batch-renders reference cards with deterministic placement (`grid`/`column`) and partial failure reporting. |
| `figjam_read_board_state` | Returns structured board-state payload with deterministic ordering and optional grouping. |
| `figjam_get_artifact_collection` | Retrieves collections via explicit selectors (`alias`, `nodeId`, `groupId`, `containerId`, `role`, `type`). |
| `figjam_relocate_artifacts` | Repositions selected artifacts deterministically (`grid` or `offset`), with optional metadata reassignment. |
| `figjam_delete_artifacts` | Deletes selected artifacts deterministically with dry-run and partial-failure controls. |
| `figjam_bulk_upsert_artifacts` | Bulk create/update pipeline with explicit precedence (`target` first, then `create`) and deterministic result envelope. |
| `figjam_get_board_graph` | Exports deterministic graph view (nodes + connector/containment edges). |
| `figjam_move_collection` | Moves selected collections with absolute/offset strategies and optional target group/container assignment. |
| `figjam_archive_collection` | Archives selected collections by deterministic metadata mutation (`groupId`, `role`, archive flags). |
| `figjam_apply_layout_to_collection` | Applies deterministic layout rules to a selected collection. |
| `figjam_export_board_snapshot` | Exports versioned deterministic board snapshot for agent-side state reasoning and persistence. |
| `figjam_import_reference_bundle` | Imports a deterministic reference bundle (optional heading + references) with layout and error controls. |

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

For full visual-state smoke coverage (new tools), run:

1. `figjam_bulk_upsert_artifacts`
2. `figjam_get_board_graph`
3. `figjam_move_collection` (dryRun first)
4. `figjam_apply_layout_to_collection` (dryRun first)
5. `figjam_archive_collection` (dryRun first)
6. `figjam_export_board_snapshot`
7. `figjam_import_reference_bundle`
8. `figjam_delete_artifacts` (dryRun first)

### 4.1 Web screenshot to FigJam image flow

Use Playwright from the agent side to capture a local screenshot, then insert it with MCP:

1. Capture image with Playwright and save it locally (for example `/tmp/bear-1.png`).
2. Call `insertLocalImage` with that local path and board position.
3. Optional: call `createImageReference` to attach structured alias/metadata in one step.

This keeps MCP deterministic: browser automation stays in the agent, board rendering/state stays in FigJam MCP.

## Recent Updates

- Added robust `createLink` fallback path: if rich unfurl metadata is missing, render a clickable native text link plus deterministic web screenshot preview.
- Added deterministic error contract for non-rich link previews (no silent fallback to sticky/text).
- Fixed bridge reconnection flapping in both bridge UIs (`figjam-desktop-bridge` and `figma-desktop-bridge`) by removing only the closed socket instance instead of all sockets for a port.
- Live smoke validated insertion of 10 link cards in a connected board.
- Added visual-state layer tools (render/read/organize/serialize), bringing FigJam tool surface to 42 registered tools.
- Connected smoke validated visual-state tools with deterministic fallback when native link previews lack rich metadata.

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
- `Epic: DBI v1 Implementation` (P0/P1)
  - `DBI v1 Phase 1` completed:
    - `figjam_index_board`, `getBoardIndex`, deterministic index schema/cache
    - pluginData metadata model and deterministic ordering contracts
  - `DBI v1 Phase 2` completed:
    - `figjam_upsert_artifact`
    - alias-based target resolution + collision handling
    - metadata-aware primitive writes
  - `DBI v1 Phase 3 foundations` completed:
    - `figjam_organize_by_alias`
    - `figjam_validate_board_index`
    - contract coverage for organization/validation path
- `Epic: Workflow Tools v1` (P1)
  - `bulkCreateStickies`, `findNodes`, `createCluster`, `summarizeBoard`, `autoLayoutBoard`
- `Epic: Research Workspace Tools v1` (P1)
  - `ingestResearchNotes`, `createReferenceWall`, `organizeByTheme`, `linkByRelation`, `generateResearchBoard`
- `Epic: Documentation and Onboarding` (P1/P2)
  - MCP setup docs, tool catalog, and repo-local agent playbooks

### In Progress

- `Epic: Visual State Layer (Render + Read + Organize + Serialize)` (P0)
  - Shift from “tool collection” to deterministic board-state product model
  - Active focus:
    - richer artifact render contracts (links/images/notes/tags with metadata)
    - deterministic board serialization for agent reasoning loops
    - DBI-first organization as default path

### Next

- `DBI v1 Phase 3 — hardening` (P1)
  - integrate DBI organization tools with existing workflow/research tools
  - add connected smoke suites for alias organization and validation loops
  - add deterministic move/validation snapshots in CI artifacts
- `Epic: Reliability and Observability` (P1)
  - production smoke matrix + automation harness
  - pass/fail reporting with raw MCP payload references

### Backlog

- `Task: Deterministic Board Serialization API` (P0)
  - stable export shape for artifacts/containers/connectors/relations/metadata
  - explicit schema versioning for agent-side consumers
- `Task: Rich Render Layer for references` (P0)
  - deterministic creation/update of link/image/reference cards with explicit metadata fields
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
3. Phase 3: DBI-driven organization/validation integration across workflow and research layers.

## License

MIT — see [LICENSE](LICENSE).
