import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerTextTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createText",
		"Create a text node in a FigJam board.",
		{
			text: z.string().min(1).describe("Text content"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			fontSize: z.number().optional().describe("Font size"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const node = await client.createText(input);
				return ok({ textNode: node });
			} catch (error) {
				return fail(error, "Failed to create text node");
			}
		},
	);
}
