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
			alias: z.string().optional().describe("Deterministic alias"),
			containerId: z.string().optional().describe("Structural container id"),
			groupId: z.string().optional().describe("Logical group id"),
			sourceUrl: z.string().optional().describe("Source URL"),
			role: z.string().optional().describe("Artifact role"),
			metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
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
