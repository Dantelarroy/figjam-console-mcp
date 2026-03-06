# FigJam MCP Quickstart

This repository now includes a FigJam-specific MCP local server entrypoint.

## 1) Run the FigJam MCP server

From the repository root:

```bash
npm install
npm run dev:figjam
```

Expected startup:
- MCP server on stdio
- WebSocket bridge on `ws://localhost:9323` (fallback range `9323-9332`)

## 2) Install the FigJam Desktop Bridge plugin

In FigJam Desktop:
1. Open a FigJam board.
2. Go to `Plugins -> Development -> Import plugin from manifest...`
3. Select:

```text
figjam-desktop-bridge/manifest.json
```

4. Run `FigJam Desktop Bridge` and keep it open.

The plugin scans `ws://localhost:9323` through `ws://localhost:9332` and connects to the active FigJam MCP server instance.

## 3) Connect Claude Code / Codex

Configure your MCP client to launch this server command:

```bash
npm run dev:figjam
```

Then verify connectivity with tool calls:
- `figjam_get_status`
- `figjam_list_open_files`

If status is disconnected:
- ensure the plugin is open on a FigJam board (not a Figma design file)
- confirm local server is running
- check that port `9323` is available or use fallback ports `9324-9332`
