# FigJam Desktop Bridge

Bridge plugin for connecting a live FigJam board to the local MCP server over WebSocket.

## Purpose

This plugin is the runtime bridge used by `dev:figjam`.
It exposes the current FigJam file context and forwards MCP commands/results between the board and the local server.

## What It Does

- Connects to local MCP WebSocket (`ws://localhost:9323` default)
- Sends `GET_FILE_INFO` handshake
- Keeps connection alive and auto-reconnects
- Forwards supported FigJam operations (stickies, shapes, connectors, text, sections, board reads)

## What It Does Not Do

- It is **not** a design-system plugin
- It does **not** depend on Variables API in FigJam mode
- It does **not** expose enterprise-only Figma Design features

## Install

1. Open FigJam Desktop.
2. Plugins -> Development -> Import plugin from manifest.
3. Select `figjam-desktop-bridge/manifest.json`.
4. Run `FigJam Desktop Bridge` in your board.

## Run With Server

From repo root:

```bash
npm install
npm run dev:figjam
```

Then run the plugin in the board and confirm logs show:

- WebSocket connected
- `GET_FILE_INFO` sent
- file connected in server logs

## Troubleshooting

- If connection fails, verify server is running and port `9323` is free.
- If plugin shows stale state, close and reopen the plugin window.
- If multiple local servers exist, ensure plugin and server use the same port range.
