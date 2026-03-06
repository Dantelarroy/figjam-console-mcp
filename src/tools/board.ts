import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, fail } from "../server/figjam-tooling.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";

export function registerBoardTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"getBoardNodes",
		"List all nodes from the current FigJam board page.",
		{},
		async () => {
			try {
				const client = await getClient();
				const nodes = await client.getBoardNodes();
				return ok({ nodes, count: nodes.length });
			} catch (error) {
				return fail(error, "Failed to fetch board nodes");
			}
		},
	);

	server.tool(
		"getStickies",
		"List sticky notes from the current FigJam page.",
		{},
		async () => {
			try {
				const client = await getClient();
				const stickies = await client.getStickies();
				return ok({ stickies, count: stickies.length });
			} catch (error) {
				return fail(error, "Failed to fetch stickies");
			}
		},
	);

	server.tool(
		"getConnections",
		"List connector nodes from the current FigJam page.",
		{},
		async () => {
			try {
				const client = await getClient();
				const connections = await client.getConnections();
				return ok({ connections, count: connections.length });
			} catch (error) {
				return fail(error, "Failed to fetch connections");
			}
		},
	);
}
