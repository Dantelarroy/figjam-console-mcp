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
