#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createChildLogger } from "./core/logger.js";
import { FigmaWebSocketServer } from "./core/websocket-server.js";
import { WebSocketConnector } from "./core/websocket-connector.js";
import type { IFigmaConnector } from "./core/figma-connector.js";
import { FigmaAPI } from "./core/figma-api.js";
import { registerFigmaAPITools } from "./core/figma-tools.js";
import { registerDesignCodeTools } from "./core/design-code-tools.js";
import { registerCommentTools } from "./core/comment-tools.js";
import { registerDesignSystemTools } from "./core/design-system-tools.js";
import { FigJamClient } from "./figjam-api/figjamClient.js";
import { registerFigJamTools } from "./server/register-figjam-tools.js";
import {
	DEFAULT_FIGJAM_WS_PORT,
	getFigJamPortRange,
	advertiseFigJamPort,
	unadvertiseFigJamPort,
	registerFigJamPortCleanup,
	cleanupStaleFigJamPortFiles,
	discoverActiveFigJamInstances,
} from "./server/figjam-port-discovery.js";
import { installGuardedToolWrapper } from "./core/guarded-tool-wrapper.js";

const logger = createChildLogger({ component: "figjam-local-server" });

class LocalFigJamMCP {
	private server: McpServer;
	private wsServer: FigmaWebSocketServer | null = null;
	private wsPreferredPort = DEFAULT_FIGJAM_WS_PORT;
	private wsActualPort: number | null = null;
	private connector: IFigmaConnector | null = null;
	private figjamClient: FigJamClient | null = null;
	private figmaAPI: FigmaAPI | null = null;
	private variablesCache: Map<string, { data: any; timestamp: number }> = new Map();

	constructor() {
		this.server = new McpServer(
			{
				name: "FigJam Console MCP (Local)",
				version: "0.1.0",
			},
			{
				instructions:
					"This MCP server targets FigJam boards only. Open the FigJam Desktop Bridge plugin to enable tool execution.",
			},
		);
	}

	private async startWebSocketBridge(): Promise<void> {
		if (this.wsServer) return;

		cleanupStaleFigJamPortFiles();

		const preferred = Number.parseInt(
			process.env.FIGJAM_WS_PORT || `${DEFAULT_FIGJAM_WS_PORT}`,
			10,
		);
		this.wsPreferredPort = Number.isFinite(preferred) ? preferred : DEFAULT_FIGJAM_WS_PORT;

		const ports = getFigJamPortRange(this.wsPreferredPort);
		let lastError: unknown = null;

		for (const port of ports) {
			try {
				const wsServer = new FigmaWebSocketServer({ port, host: "localhost" });
				await wsServer.start();
				this.wsServer = wsServer;
				this.wsActualPort = port;

				advertiseFigJamPort(port, "localhost");
				registerFigJamPortCleanup(port);

				logger.info({ preferredPort: this.wsPreferredPort, actualPort: port }, "FigJam WebSocket bridge started");
				return;
			} catch (error) {
				lastError = error;
			}
		}

		const active = discoverActiveFigJamInstances(this.wsPreferredPort);
		throw new Error(
			`Failed to start FigJam WebSocket bridge on ports ${ports[0]}-${ports[ports.length - 1]}. ` +
				`Detected ${active.length} active FigJam instance(s). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
		);
	}

	private async getConnector(): Promise<IFigmaConnector> {
		await this.startWebSocketBridge();

		if (!this.wsServer || !this.wsServer.isClientConnected()) {
			const wsPort = this.wsActualPort || this.wsPreferredPort;
			throw new Error(
				`No FigJam Desktop Bridge client connected on ws://localhost:${wsPort}. ` +
					"Open a FigJam board and run the FigJam Desktop Bridge plugin.",
			);
		}

		const connector = new WebSocketConnector(this.wsServer);
		await connector.initialize();
		this.connector = connector;
		return connector;
	}

	private async getFigJamClient(): Promise<FigJamClient> {
		if (!this.figjamClient) {
			this.figjamClient = new FigJamClient(() => this.getConnector());
		}
		return this.figjamClient;
	}

	private async getFigmaAPI(): Promise<FigmaAPI> {
		if (!this.figmaAPI) {
			const accessToken = process.env.FIGMA_ACCESS_TOKEN;
			if (!accessToken) {
				throw new Error(
					"FIGMA_ACCESS_TOKEN not configured. Set it as an environment variable.",
				);
			}
			this.figmaAPI = new FigmaAPI({ accessToken });
		}
		return this.figmaAPI;
	}

	private getCurrentFileUrl(): string | null {
		const fileInfo = this.wsServer?.getConnectedFileInfo();
		if (!fileInfo?.fileKey) return null;
		// Build a URL compatible with upstream extractFileKey() helpers.
		return `https://www.figma.com/board/${fileInfo.fileKey}/FigJam-Board`;
	}

	private registerStatusTools(): void {
		this.server.tool("figjam_get_status", "Get FigJam bridge and MCP connection status.", {}, async () => {
			const connectedFiles = this.wsServer?.getConnectedFiles() || [];
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							mode: "local",
							connected: Boolean(this.wsServer?.isClientConnected()),
							websocket: {
								serverRunning: Boolean(this.wsServer),
								activePort: this.wsActualPort,
								preferredPort: this.wsPreferredPort,
								connectedFiles: connectedFiles.length,
							},
							files: connectedFiles,
							ready: Boolean(this.wsServer?.isClientConnected()),
							hint: this.wsServer?.isClientConnected()
								? "Bridge connected."
								: "Open FigJam Desktop Bridge in a FigJam board.",
						}),
					},
				],
			};
		});

		this.server.tool(
			"figjam_list_open_files",
			"List all files currently connected through the FigJam Desktop Bridge.",
			{},
			async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							files: this.wsServer?.getConnectedFiles() || [],
						}),
					},
				],
			}),
		);

		this.server.tool(
			"figjam_set_active_file",
			"Set the active connected FigJam file by file key.",
			{
				fileKey: z.string().min(1).describe("Figma file key of the connected FigJam board"),
			},
			async ({ fileKey }) => {
				const switched = this.wsServer?.setActiveFile(fileKey) || false;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								success: switched,
								fileKey,
								message: switched
									? "Active FigJam file switched"
									: "File key is not connected",
							}),
						},
					],
					isError: !switched,
				};
			},
		);
	}

	private registerTools(): void {
		installGuardedToolWrapper(this.server, {
			getConnectedFileInfo: () => this.wsServer?.getConnectedFileInfo() || null,
			getCurrentUrl: () => this.getCurrentFileUrl(),
			getDesktopConnector: () => this.getConnector(),
		});

		this.registerStatusTools();

		// Upstream parity tool surface (guard layer handles FigJam capability gating).
		registerFigmaAPITools(
			this.server,
			() => this.getFigmaAPI(),
			() => this.getCurrentFileUrl(),
			undefined,
			undefined,
			undefined,
			this.variablesCache,
			undefined,
			() => this.getConnector(),
		);
		registerDesignCodeTools(
			this.server,
			() => this.getFigmaAPI(),
			() => this.getCurrentFileUrl(),
			this.variablesCache,
			undefined,
			() => this.getConnector(),
		);
		registerCommentTools(
			this.server,
			() => this.getFigmaAPI(),
			() => this.getCurrentFileUrl(),
		);
		registerDesignSystemTools(
			this.server,
			() => this.getFigmaAPI(),
			() => this.getCurrentFileUrl(),
			this.variablesCache,
		);

		// FigJam-native tools remain additive.
		registerFigJamTools(this.server, () => this.getFigJamClient());
	}

	async start(): Promise<void> {
		await this.startWebSocketBridge();
		this.registerTools();
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		logger.info("FigJam MCP server started on stdio transport");
	}

	async stop(): Promise<void> {
		try {
			if (this.wsServer) {
				await this.wsServer.stop();
			}
		} finally {
			if (this.wsActualPort) {
				unadvertiseFigJamPort(this.wsActualPort);
			}
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const server = new LocalFigJamMCP();

	server.start().catch((error) => {
		logger.error({ error }, "Failed to start FigJam MCP server");
		process.exit(1);
	});

	const shutdown = async () => {
		await server.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

export { LocalFigJamMCP };
