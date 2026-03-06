import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerSectionTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createSection",
		"Create a section in a FigJam board.",
		{
			name: z.string().optional().describe("Section name"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			width: z.number().optional().describe("Width"),
			height: z.number().optional().describe("Height"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const section = await client.createSection(input);
				return ok({ section });
			} catch (error) {
				return fail(error, "Failed to create section");
			}
		},
	);
}
