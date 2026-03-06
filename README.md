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

Current roadmap focus:
- DBI v1 deterministic board indexing
- alias-based deterministic resolution
- screenshot validation as complementary visual QA
- reliability and observability hardening

## License

MIT — see [LICENSE](LICENSE).
