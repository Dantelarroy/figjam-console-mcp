import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerShapeTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createShape",
		"Create a FigJam shape (rectangle, circle, diamond).",
		{
			type: z.enum(["rectangle", "circle", "diamond"]).describe("Shape type"),
			text: z.string().optional().describe("Optional text content"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			width: z.number().optional().describe("Width"),
			height: z.number().optional().describe("Height"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const shape = await client.createShape(input);
				return ok({ shape });
			} catch (error) {
				return fail(error, "Failed to create shape");
			}
		},
	);
}
