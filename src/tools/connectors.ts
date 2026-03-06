import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerConnectorTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createConnector",
		"Create a connector between two FigJam nodes.",
		{
			fromNodeId: z.string().min(1).describe("Source node id"),
			toNodeId: z.string().min(1).describe("Target node id"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const connector = await client.createConnector(input);
				return ok({ connector });
			} catch (error) {
				return fail(error, "Failed to create connector");
			}
		},
	);
}
